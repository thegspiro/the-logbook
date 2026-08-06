"""
Tamper-Proof Audit Logging System

Implements blockchain-inspired hash chain for immutable audit logs
with cryptographic integrity verification.
"""

import gzip
import hashlib
import hmac
import json
import os
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from loguru import logger
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.audit import AuditLog, AuditLogCheckpoint

# Current hash-chain algorithm version. Version 1 was an *unkeyed* SHA-256 hash,
# which is tamper-EVIDENT but not tamper-PROOF: anyone able to write audit rows
# could recompute a fully valid chain. Version 2 keys the chain with HMAC-SHA256
# so forging the chain requires the signing key, not just DB write access.
# Version 3 additionally includes organization_id in the hash input, making
# tenant attribution tamper-proof for new rows (v1/v2 rows predate the column
# and verify without it — the backfilled column is scoping metadata there).
_CURRENT_HASH_VERSION = 3
_KEYED_MIN_VERSION = 2
_LEGACY_HASH_VERSION = 1


def _get_audit_signing_key() -> str:
    """Return the HMAC key for the audit chain.

    Prefers a dedicated ``AUDIT_LOG_SIGNING_KEY`` (ideally stored outside the
    app database) and falls back to ``SECRET_KEY``. Either way the key lives in
    application config/secrets, never in the audit tables, so a DB-only attacker
    cannot forge the chain.
    """
    return settings.AUDIT_LOG_SIGNING_KEY or settings.SECRET_KEY


class AuditLogger:
    """
    Tamper-proof audit logger with cryptographic hash chains
    """

    @staticmethod
    def _normalize_timestamp(ts) -> str:
        """Normalize a timestamp to a consistent ISO format string for hashing."""
        if isinstance(ts, str):
            return ts
        if isinstance(ts, datetime):
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=UTC)
            # The timestamp column is DATETIME with no fractional-second
            # precision, so MySQL truncates microseconds on store. The old code
            # only padded the *format* to 6 places (timespec='microseconds') but
            # kept the real microseconds at write time — so the string hashed at
            # write (e.g. ...:56.123456) never matched the value read back at
            # verify (...:56.000000), producing spurious "hash mismatch" errors.
            # Zero the microseconds so write and verify hash the identical value.
            # (timestamp_nanos is also in the hash and preserves sub-second
            # ordering losslessly.)
            return (
                ts.astimezone(UTC)
                .replace(microsecond=0)
                .isoformat(timespec="microseconds")
            )
        return str(ts)

    @staticmethod
    def calculate_hash(
        log_data: dict[str, Any],
        previous_hash: str,
        version: int = _CURRENT_HASH_VERSION,
    ) -> str:
        """
        Calculate the integrity hash for a log entry.

        Creates a deterministic hash from log entry data and the previous hash,
        forming a blockchain-inspired chain. ``version`` selects the algorithm:

        - ``3`` (default): keyed HMAC-SHA256 with organization_id in the
          hash input — tenant attribution is tamper-proof.
        - ``2``: keyed HMAC-SHA256 without organization_id (rows written
          before the column existed).
        - ``1``: legacy unkeyed SHA-256, retained ONLY to verify entries written
          before the keyed upgrade. Never used for new entries.
        """
        # json.dumps with sort_keys produces identical output regardless of
        # Python dict insertion order or MySQL JSON key reordering.
        event_data = log_data.get("event_data", {})
        event_data_str = json.dumps(event_data, sort_keys=True, default=str)

        fields = [
            str(log_data.get("timestamp", "")),
            str(log_data.get("timestamp_nanos", "")),
            str(log_data.get("event_type", "")),
            str(log_data.get("user_id", "")),
            str(log_data.get("ip_address", "")),
            event_data_str,
            previous_hash,
        ]
        # v3 adds organization_id; older rows predate the column and their
        # stored hashes must keep verifying byte-identically without it.
        if version >= 3:
            fields.insert(4, str(log_data.get("organization_id", "")))
        data_string = "|".join(fields)

        if version >= _KEYED_MIN_VERSION:
            return hmac.new(
                _get_audit_signing_key().encode(),
                data_string.encode(),
                hashlib.sha256,
            ).hexdigest()

        # Legacy unkeyed SHA-256 (version 1) — verification of old rows only.
        return hashlib.sha256(data_string.encode()).hexdigest()

    def _build_hash_data(self, log: AuditLog) -> dict[str, Any]:
        """Build the dict used as input to calculate_hash from a DB row.

        Centralised so that create, verify, and rehash all hash the same
        fields in the same order — preventing the class of drift bug where
        one callsite includes a field and another does not.
        """
        return {
            "timestamp": self._normalize_timestamp(log.timestamp),
            "timestamp_nanos": log.timestamp_nanos,
            "event_type": log.event_type,
            "event_category": log.event_category,
            "severity": (
                log.severity.value if hasattr(log.severity, "value") else log.severity
            ),
            "user_id": log.user_id,
            "organization_id": getattr(log, "organization_id", None),
            "ip_address": log.ip_address,
            "event_data": log.event_data,
        }

    async def create_log_entry(
        self,
        db: AsyncSession,
        event_type: str,
        event_category: str,
        severity: str,
        event_data: dict[str, Any],
        user_id: str | None = None,
        username: str | None = None,
        session_id: str | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
        geo_location: dict[str, Any] | None = None,
        organization_id: str | None = None,
    ) -> AuditLog | None:
        """
        Create a new tamper-proof audit log entry

        Each entry contains:
        - Event details
        - User/session information
        - Previous entry's hash (forming the chain)
        - Current entry's hash (calculated from all data + previous hash)
        """
        try:
            # Use a savepoint (nested transaction) so that audit log failures
            # don't roll back the caller's transaction
            async with db.begin_nested():
                # Stamp the owning tenant. Callers may pass it explicitly;
                # otherwise resolve it from the acting user so the vast
                # majority of events are org-attributed without touching
                # every callsite. Events with neither stay platform-level.
                if organization_id is None and user_id is not None:
                    from app.models.user import User

                    org_result = await db.execute(
                        select(User.organization_id).where(User.id == str(user_id))
                    )
                    organization_id = org_result.scalar_one_or_none()
                if organization_id is not None:
                    organization_id = str(organization_id)

                # Get the last log entry to get previous hash
                result = await db.execute(
                    select(AuditLog).order_by(AuditLog.id.desc()).limit(1)
                )
                last_log = result.scalar_one_or_none()
                previous_hash = last_log.current_hash if last_log else "0" * 64

                # Create log entry data. Microseconds are zeroed on the STORED
                # value, not just in the hash input: MySQL DATETIME(0) ROUNDS
                # fractional seconds on insert, so storing 12.7s would read
                # back as 13s and fail verification about half the time.
                # timestamp_nanos preserves sub-second ordering losslessly.
                timestamp = datetime.now(UTC).replace(microsecond=0)
                timestamp_nanos = time.time_ns()

                log_data = {
                    "timestamp": self._normalize_timestamp(timestamp),
                    "timestamp_nanos": timestamp_nanos,
                    "event_type": event_type,
                    "event_category": event_category,
                    "severity": (
                        severity.value if hasattr(severity, "value") else severity
                    ),
                    "user_id": user_id,
                    "organization_id": organization_id,
                    "ip_address": ip_address,
                    "event_data": event_data,
                }

                # Calculate current hash with the keyed (HMAC) algorithm.
                current_hash = self.calculate_hash(
                    log_data, previous_hash, _CURRENT_HASH_VERSION
                )

                # Create log entry
                log_entry = AuditLog(
                    timestamp=timestamp,
                    timestamp_nanos=timestamp_nanos,
                    event_type=event_type,
                    event_category=event_category,
                    severity=severity,
                    user_id=user_id,
                    organization_id=organization_id,
                    username=username,
                    session_id=session_id,
                    ip_address=ip_address,
                    user_agent=user_agent,
                    geo_location=geo_location,
                    event_data=event_data,
                    previous_hash=previous_hash,
                    current_hash=current_hash,
                    hash_version=_CURRENT_HASH_VERSION,
                )

                db.add(log_entry)
                await db.flush()
                await db.refresh(log_entry)

            return log_entry

        except Exception as e:
            logger.error(f"Failed to create audit log: {e}")
            # Don't re-raise - audit log failures should not break the caller's
            # operation. The savepoint rollback already undid the audit changes
            # without affecting the outer transaction.
            return None

    async def verify_integrity(
        self,
        db: AsyncSession,
        start_id: int | None = None,
        end_id: int | None = None,
    ) -> dict[str, Any]:
        """
        Verify the integrity of the audit log chain

        Returns:
            Dict with verification results including:
            - verified: bool - whether integrity check passed
            - total_checked: int - number of entries checked
            - errors: List - any integrity violations found
        """
        # Build query
        query = select(AuditLog).order_by(AuditLog.id)

        if start_id:
            query = query.where(AuditLog.id >= start_id)
        if end_id:
            query = query.where(AuditLog.id <= end_id)

        result = await db.execute(query)
        logs = result.scalars().all()

        if not logs:
            return {
                "verified": True,
                "total_checked": 0,
                "first_id": None,
                "last_id": None,
                "errors": [],
            }

        results = {
            "verified": True,
            "total_checked": len(logs),
            "first_id": logs[0].id,
            "last_id": logs[-1].id,
            "errors": [],
        }

        # Verify each log entry. Each row is verified under ITS OWN recorded
        # algorithm version so pre-upgrade (legacy SHA-256) rows still pass while
        # new rows are checked with keyed HMAC.
        #
        # No-downgrade guard: once the chain has produced any keyed (v2) entry,
        # every later entry must also be keyed. Otherwise an attacker with DB
        # write access could rewrite the tail as forgeable legacy (v1) rows and
        # still present a self-consistent chain. ``max_version_seen`` tracks the
        # high-water mark; a lower-versioned row after it is treated as tamper.
        max_version_seen = _LEGACY_HASH_VERSION
        for i, log in enumerate(logs):
            row_version = log.hash_version or _LEGACY_HASH_VERSION
            log_data = self._build_hash_data(log)
            calculated_hash = self.calculate_hash(
                log_data, log.previous_hash, row_version
            )

            if row_version < max_version_seen:
                results["verified"] = False
                results["errors"].append(
                    {
                        "log_id": log.id,
                        "error": (
                            "Hash version downgrade - entry uses an older, "
                            "unkeyed algorithm than earlier entries"
                        ),
                        "row_version": row_version,
                        "expected_min_version": max_version_seen,
                    }
                )
            max_version_seen = max(max_version_seen, row_version)

            # Check if hash matches
            if calculated_hash != log.current_hash:
                results["verified"] = False
                results["errors"].append(
                    {
                        "log_id": log.id,
                        "error": "Hash mismatch - log entry has been tampered with",
                        "expected_hash": log.current_hash,
                        "calculated_hash": calculated_hash,
                    }
                )

            # Check chain integrity (except for first entry)
            if i > 0:
                previous_log = logs[i - 1]
                if log.previous_hash != previous_log.current_hash:
                    results["verified"] = False
                    results["errors"].append(
                        {
                            "log_id": log.id,
                            "error": "Chain broken - previous hash does not match",
                            "expected_previous": log.previous_hash,
                            "actual_previous": previous_log.current_hash,
                        }
                    )
            elif start_id is None:
                # Anchor the very first row to the genesis value. Without this,
                # deleting rows from the HEAD of the chain leaves a tail that is
                # internally consistent and still "verifies" — the new first
                # row's previous_hash (pointing at a now-deleted row) is never
                # checked. Only enforce when verifying from the chain start
                # (start_id is None); a windowed check legitimately starts mid-
                # chain. A head that links to an attested retention-archival
                # boundary (see archive_expired_logs) is the one sanctioned
                # alternative to genesis.
                if log.previous_hash != "0" * 64 and not (
                    await self._is_archived_boundary(db, log.id, log.previous_hash)
                ):
                    results["verified"] = False
                    results["errors"].append(
                        {
                            "log_id": log.id,
                            "error": (
                                "Chain head missing - first entry does not link "
                                "to the genesis hash or an attested archival "
                                "boundary (entries may have been removed from "
                                "the start of the chain)"
                            ),
                            "expected_previous": "0" * 64,
                            "actual_previous": log.previous_hash,
                        }
                    )

        # SEC-2 (tail-truncation): the genesis anchor above detects deletion from
        # the HEAD of the chain, but deleting the NEWEST rows leaves a chain that
        # is still internally consistent and anchored to genesis, so it would
        # otherwise "verify". A non-archival checkpoint attests that entries
        # existed up to its ``last_log_id``; if the chain now ends before that,
        # those attested rows were removed. Only meaningful for a full-chain
        # verify (no explicit ``end_id`` window) — a windowed check legitimately
        # stops early. Archival checkpoints (``archived_at`` set) purge the OLD
        # head range, not the tail, so they are excluded here.
        if end_id is None and logs:
            current_max_id = logs[-1].id
            cp_result = await db.execute(
                select(AuditLogCheckpoint)
                .where(AuditLogCheckpoint.archived_at.is_(None))
                .order_by(AuditLogCheckpoint.last_log_id.desc())
                .limit(1)
            )
            latest_cp = cp_result.scalar_one_or_none()
            if latest_cp and latest_cp.last_log_id > current_max_id:
                results["verified"] = False
                results["errors"].append(
                    {
                        "error": (
                            "Chain tail truncated - checkpoint attests entries "
                            f"up to id {latest_cp.last_log_id} but the chain now "
                            f"ends at {current_max_id} (entries may have been "
                            "removed from the end of the chain)"
                        ),
                        "checkpoint_last_log_id": latest_cp.last_log_id,
                        "chain_last_id": current_max_id,
                    }
                )

        return results

    async def rehash_chain(self, db: AsyncSession) -> int:
        """
        Recompute and store correct hashes for the entire audit log chain.

        This is needed when a bug caused creation-time hashes to differ from
        verification-time hashes (e.g. timestamp timezone or None handling).
        The log data itself is unchanged — only the stored hashes are corrected.

        Returns the number of entries rehashed.
        """
        result = await db.execute(select(AuditLog).order_by(AuditLog.id))
        logs = result.scalars().all()

        if not logs:
            return 0

        # This tool exists ONLY to repair the historical legacy (v1, unkeyed)
        # hash-computation bug. A keyed (v2) row's stored hash is authoritative
        # evidence: the server holds the HMAC signing key, so recomputing a v2
        # hash from the row's *current* event_data and overwriting it would
        # launder a DB-level tamper into a valid keyed chain. Therefore we NEVER
        # rewrite a keyed row here. Instead we recompute it and, if it does not
        # match what is stored, fail closed (raise) so the operator investigates
        # a real integrity signal rather than silently laundering it. Legacy
        # rows — which predate keying and cannot be forged into the keyed
        # scheme without the key — are the only rows this recovery path repairs.
        previous_hash = "0" * 64
        count = 0
        for log in logs:
            row_version = log.hash_version or _LEGACY_HASH_VERSION

            if row_version >= _KEYED_MIN_VERSION:
                # Keyed row: verify against its stored hash, never overwrite it.
                log_data = self._build_hash_data(log)
                expected = self.calculate_hash(log_data, previous_hash, row_version)
                if expected != log.current_hash:
                    raise ValueError(
                        "Refusing to rehash: keyed audit entry "
                        f"{log.id} does not match its stored hash. This is a "
                        "genuine integrity signal (tamper or a bug in keyed "
                        "hashing), not a legacy-hash mismatch — rehash will not "
                        "overwrite it. Investigate via the integrity report."
                    )
                # Chain forward from the authoritative stored hash.
                previous_hash = log.current_hash
                continue

            # Legacy (v1) row: safe to repair the known computation bug.
            log_data = self._build_hash_data(log)
            correct_hash = self.calculate_hash(log_data, previous_hash, row_version)
            if log.previous_hash != previous_hash or log.current_hash != correct_hash:
                log.previous_hash = previous_hash
                log.current_hash = correct_hash
                count += 1
            previous_hash = correct_hash

        if count > 0:
            await db.flush()
            logger.info(f"Rehashed {count} legacy audit log entries to fix hash chain")

        return count

    def serialize_row(self, row: AuditLog) -> dict[str, Any]:
        """Full serialization of an audit row, chain hashes included, for
        export surfaces (retention archives, off-host shipping). Keeping one
        serializer prevents drift between the two record formats."""
        return {
            "id": row.id,
            "timestamp": self._normalize_timestamp(row.timestamp),
            "timestamp_nanos": row.timestamp_nanos,
            "event_type": row.event_type,
            "event_category": row.event_category,
            "severity": (
                row.severity.value if hasattr(row.severity, "value") else row.severity
            ),
            "user_id": row.user_id,
            "organization_id": getattr(row, "organization_id", None),
            "ip_address": row.ip_address,
            "user_agent": getattr(row, "user_agent", None),
            "event_data": row.event_data,
            "previous_hash": row.previous_hash,
            "current_hash": row.current_hash,
            "hash_version": row.hash_version,
        }

    @staticmethod
    def compute_archive_attestation(
        first_log_id: int, last_log_id: int, last_log_hash: str
    ) -> str:
        """Keyed HMAC attesting that a checkpoint range was legitimately
        archived by the retention job. Kept out of the checkpoint's own
        unkeyed checkpoint_hash on purpose: DB write access must not be
        enough to sanction a head deletion."""
        data = f"audit-archive|{first_log_id}|{last_log_id}|{last_log_hash}"
        return hmac.new(
            _get_audit_signing_key().encode(), data.encode(), hashlib.sha256
        ).hexdigest()

    async def _is_archived_boundary(
        self, db: AsyncSession, head_id: int, previous_hash: str
    ) -> bool:
        """Whether the current chain head legitimately follows an archived
        (exported-and-purged) range: some checkpoint below the head must
        record this exact boundary hash with a valid keyed attestation."""
        result = await db.execute(
            select(AuditLogCheckpoint)
            .where(AuditLogCheckpoint.archived_at.isnot(None))
            .where(AuditLogCheckpoint.last_log_hash == previous_hash)
            .where(AuditLogCheckpoint.last_log_id < head_id)
        )
        for cp in result.scalars().all():
            expected = self.compute_archive_attestation(
                cp.first_log_id, cp.last_log_id, cp.last_log_hash
            )
            if cp.archive_attestation and hmac.compare_digest(
                cp.archive_attestation, expected
            ):
                return True
        return False

    async def archive_expired_logs(
        self,
        db: AsyncSession,
        retention_days: int,
        archive_dir: str,
    ) -> dict[str, Any]:
        """
        Enforce the audit retention period: export rows older than
        ``retention_days`` to a gzipped JSONL archive, then purge them.

        Safety properties:
        - Only checkpoint-covered ranges are purged, and only whole
          checkpoint ranges — their Merkle roots stay in the DB as an index
          to the exported archive, so old entries remain provable offline.
        - The range must pass integrity verification immediately before
          export; a chain that doesn't verify is never purged.
        - The boundary checkpoint records the last purged row's chain hash
          plus a keyed attestation, so verification of the surviving chain
          still passes — and unsanctioned deletions still fail.
        """
        results: dict[str, Any] = {
            "purged_entries": 0,
            "archive_file": None,
            "purge_start_id": None,
            "purge_end_id": None,
            "skipped_reason": None,
        }
        cutoff = datetime.now(UTC) - timedelta(days=retention_days)

        head_result = await db.execute(select(AuditLog).order_by(AuditLog.id).limit(1))
        head = head_result.scalar_one_or_none()
        if head is None:
            results["skipped_reason"] = "no audit rows"
            return results

        # Walk contiguous checkpoints from the head; a range qualifies only
        # if its newest covered row is already past retention.
        cp_result = await db.execute(
            select(AuditLogCheckpoint)
            .where(AuditLogCheckpoint.last_log_id >= head.id)
            .order_by(AuditLogCheckpoint.first_log_id)
        )
        purge_end: int | None = None
        boundary_cp: AuditLogCheckpoint | None = None
        expected_next = head.id
        for cp in cp_result.scalars().all():
            if cp.first_log_id > expected_next:
                break  # gap in checkpoint coverage — nothing beyond is safe
            newest_ts = (
                await db.execute(
                    select(func.max(AuditLog.timestamp))
                    .where(AuditLog.id >= cp.first_log_id)
                    .where(AuditLog.id <= cp.last_log_id)
                )
            ).scalar()
            if newest_ts is not None:
                if newest_ts.tzinfo is None:
                    newest_ts = newest_ts.replace(tzinfo=UTC)
                if newest_ts >= cutoff:
                    break
                purge_end = cp.last_log_id
                boundary_cp = cp
            expected_next = max(expected_next, cp.last_log_id + 1)

        if purge_end is None or boundary_cp is None:
            results["skipped_reason"] = "no checkpoint-covered rows past retention"
            return results

        integrity = await self.verify_integrity(db, end_id=purge_end)
        if not integrity["verified"]:
            results["skipped_reason"] = (
                "integrity verification failed - refusing to purge"
            )
            logger.error(
                f"Audit retention purge aborted: range {head.id}-{purge_end} "
                "failed integrity verification"
            )
            return results

        rows = (
            (
                await db.execute(
                    select(AuditLog)
                    .where(AuditLog.id <= purge_end)
                    .order_by(AuditLog.id)
                )
            )
            .scalars()
            .all()
        )
        last_row = rows[-1]

        os.makedirs(archive_dir, exist_ok=True)
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        filename = f"audit_archive_{rows[0].id:012d}-{purge_end:012d}_{stamp}.jsonl.gz"
        archive_path = os.path.join(archive_dir, filename)
        with gzip.open(archive_path, "wt", encoding="utf-8") as fh:
            for row in rows:
                fh.write(
                    json.dumps(self.serialize_row(row), sort_keys=True, default=str)
                    + "\n"
                )

        boundary_cp.archived_at = datetime.now(UTC)
        boundary_cp.last_log_hash = last_row.current_hash
        boundary_cp.archive_attestation = self.compute_archive_attestation(
            boundary_cp.first_log_id,
            boundary_cp.last_log_id,
            last_row.current_hash,
        )

        await db.execute(delete(AuditLog).where(AuditLog.id <= purge_end))
        await db.flush()

        results["purged_entries"] = len(rows)
        results["archive_file"] = archive_path
        results["purge_start_id"] = rows[0].id
        results["purge_end_id"] = purge_end
        logger.info(
            f"Audit retention: exported and purged {len(rows)} entries "
            f"({rows[0].id}-{purge_end}) to {archive_path}"
        )
        return results

    async def create_checkpoint(
        self,
        db: AsyncSession,
        first_log_id: int,
        last_log_id: int,
    ) -> AuditLogCheckpoint:
        """
        Create an integrity checkpoint for a range of audit logs

        This provides a cryptographic snapshot that can be used
        to verify integrity of historical logs.
        """
        # Get all logs in range
        result = await db.execute(
            select(AuditLog)
            .where(AuditLog.id >= first_log_id)
            .where(AuditLog.id <= last_log_id)
            .order_by(AuditLog.id)
        )
        logs = result.scalars().all()

        if not logs:
            raise ValueError("No logs found in specified range")

        # Calculate Merkle root (simplified - hash of all hashes)
        all_hashes = "".join([log.current_hash for log in logs])
        merkle_root = hashlib.sha256(all_hashes.encode()).hexdigest()

        # Create checkpoint hash
        checkpoint_data = f"{first_log_id}|{last_log_id}|{len(logs)}|{merkle_root}"
        checkpoint_hash = hashlib.sha256(checkpoint_data.encode()).hexdigest()

        # Create checkpoint
        checkpoint = AuditLogCheckpoint(
            first_log_id=first_log_id,
            last_log_id=last_log_id,
            total_entries=len(logs),
            merkle_root=merkle_root,
            checkpoint_hash=checkpoint_hash,
        )

        db.add(checkpoint)
        await db.flush()
        await db.refresh(checkpoint)

        logger.info(f"Created checkpoint for logs {first_log_id}-{last_log_id}")

        return checkpoint


# Global audit logger instance
audit_logger = AuditLogger()


# Convenience function for logging events
async def log_event(
    db: AsyncSession,
    event_type: str,
    event_data: dict[str, Any],
    event_category: str = "general",
    severity: str = "info",
    **kwargs,
):
    """
    Convenience function to log an event

    Usage:
        await log_event(
            db,
            "user_login",
            {"username": "john.doe"},
            event_category="auth",
            severity="INFO",
            user_id=user.id,
            ip_address=get_client_ip(request),
        )

    Always resolve the IP with ``get_client_ip`` (app.core.security_middleware)
    rather than ``request.client.host``: behind the production nginx proxy the
    peer address is the proxy, so the raw value records one internal IP for
    every user and the audit trail carries no usable attribution.
    """
    return await audit_logger.create_log_entry(
        db=db,
        event_type=event_type,
        event_category=event_category,
        severity=severity,
        event_data=event_data,
        **kwargs,
    )


# Alias for consistency with auth service
async def log_audit_event(
    db: AsyncSession,
    event_type: str,
    event_category: str,
    severity: str,
    event_data: dict[str, Any],
    **kwargs,
):
    """
    Log an audit event (alias for log_event with different parameter order)
    """
    return await audit_logger.create_log_entry(
        db=db,
        event_type=event_type,
        event_category=event_category,
        severity=severity,
        event_data=event_data,
        **kwargs,
    )


async def verify_audit_log_integrity(
    db: AsyncSession,
    start_id: int | None = None,
    end_id: int | None = None,
) -> dict[str, Any]:
    """
    Verify the integrity of the audit log chain.

    This is a critical zero-trust function that should be called:
    - On application startup
    - Periodically via scheduled tasks
    - On-demand via admin API

    Args:
        db: Database session
        start_id: Optional start ID for range verification
        end_id: Optional end ID for range verification

    Returns:
        Verification result with status and any detected issues
    """
    result = await audit_logger.verify_integrity(db, start_id, end_id)

    # Log the verification itself
    await audit_logger.create_log_entry(
        db=db,
        event_type="audit_integrity_check",
        event_category="security",
        severity="critical" if not result["verified"] else "info",
        event_data={
            "verified": result["verified"],
            "total_checked": result["total_checked"],
            "first_id": result.get("first_id"),
            "last_id": result.get("last_id"),
            "errors_found": len(result.get("errors", [])),
        },
    )

    if not result["verified"]:
        logger.critical(
            f"AUDIT LOG INTEGRITY FAILURE: {len(result['errors'])} issues detected"
        )
        for error in result["errors"]:
            logger.critical(f"  - Log ID {error['log_id']}: {error['error']}")

    return result


async def get_audit_log_status(db: AsyncSession) -> dict[str, Any]:
    """
    Get current audit log status and statistics.

    Returns:
        Status information including total entries, latest entry, and last checkpoint
    """
    # Get total count
    result = await db.execute(select(func.count(AuditLog.id)))
    total_count = result.scalar()

    # Get latest entry
    result = await db.execute(select(AuditLog).order_by(AuditLog.id.desc()).limit(1))
    latest_entry = result.scalar_one_or_none()

    # Get latest checkpoint
    result = await db.execute(
        select(AuditLogCheckpoint).order_by(AuditLogCheckpoint.id.desc()).limit(1)
    )
    latest_checkpoint = result.scalar_one_or_none()

    return {
        "total_entries": total_count,
        "latest_entry": (
            {
                "id": latest_entry.id if latest_entry else None,
                "timestamp": (
                    latest_entry.timestamp.isoformat() if latest_entry else None
                ),
                "event_type": latest_entry.event_type if latest_entry else None,
                "current_hash": latest_entry.current_hash if latest_entry else None,
            }
            if latest_entry
            else None
        ),
        "latest_checkpoint": (
            {
                "id": latest_checkpoint.id if latest_checkpoint else None,
                "checkpoint_time": (
                    latest_checkpoint.checkpoint_time.isoformat()
                    if latest_checkpoint
                    else None
                ),
                "first_log_id": (
                    latest_checkpoint.first_log_id if latest_checkpoint else None
                ),
                "last_log_id": (
                    latest_checkpoint.last_log_id if latest_checkpoint else None
                ),
                "merkle_root": (
                    latest_checkpoint.merkle_root if latest_checkpoint else None
                ),
            }
            if latest_checkpoint
            else None
        ),
    }

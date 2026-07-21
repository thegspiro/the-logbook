"""
Tamper-Proof Audit Logging System

Implements blockchain-inspired hash chain for immutable audit logs
with cryptographic integrity verification.
"""

import hashlib
import hmac
import json
import time
from datetime import UTC, datetime
from typing import Any

from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.audit import AuditLog, AuditLogCheckpoint

# Current hash-chain algorithm version. Version 1 was an *unkeyed* SHA-256 hash,
# which is tamper-EVIDENT but not tamper-PROOF: anyone able to write audit rows
# could recompute a fully valid chain. Version 2 keys the chain with HMAC-SHA256
# so forging the chain requires the signing key, not just DB write access.
_CURRENT_HASH_VERSION = 2
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

        - ``2`` (default): keyed HMAC-SHA256 — forging the chain requires the
          signing key, not merely DB write access.
        - ``1``: legacy unkeyed SHA-256, retained ONLY to verify entries written
          before the keyed upgrade. Never used for new entries.
        """
        # json.dumps with sort_keys produces identical output regardless of
        # Python dict insertion order or MySQL JSON key reordering.
        event_data = log_data.get("event_data", {})
        event_data_str = json.dumps(event_data, sort_keys=True, default=str)

        data_string = "|".join(
            [
                str(log_data.get("timestamp", "")),
                str(log_data.get("timestamp_nanos", "")),
                str(log_data.get("event_type", "")),
                str(log_data.get("user_id", "")),
                str(log_data.get("ip_address", "")),
                event_data_str,
                previous_hash,
            ]
        )

        if version >= _CURRENT_HASH_VERSION:
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
                # Get the last log entry to get previous hash
                result = await db.execute(
                    select(AuditLog).order_by(AuditLog.id.desc()).limit(1)
                )
                last_log = result.scalar_one_or_none()
                previous_hash = last_log.current_hash if last_log else "0" * 64

                # Create log entry data
                timestamp = datetime.now(UTC)
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

        # Rehash each row under its own stored version so this recovery tool does
        # not silently re-baseline legacy rows into the keyed scheme (or vice
        # versa). Because v2 hashing requires the signing key, an attacker
        # without it cannot use this path to forge a valid keyed chain.
        previous_hash = "0" * 64
        count = 0
        for log in logs:
            row_version = log.hash_version or _LEGACY_HASH_VERSION
            log_data = self._build_hash_data(log)
            correct_hash = self.calculate_hash(log_data, previous_hash, row_version)
            if log.previous_hash != previous_hash or log.current_hash != correct_hash:
                log.previous_hash = previous_hash
                log.current_hash = correct_hash
                count += 1
            previous_hash = correct_hash

        if count > 0:
            await db.flush()
            logger.info(f"Rehashed {count} audit log entries to fix hash chain")

        return count

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
            ip_address=request.client.host,
        )
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

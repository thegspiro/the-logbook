"""
Tamper-Proof Audit Logging System

Implements blockchain-inspired hash chain for immutable audit logs
with cryptographic integrity verification.
"""

import asyncio
import gzip
import hashlib
import hmac
import json
import os
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from loguru import logger
from sqlalchemy import Connection, case, delete, event, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import set_committed_value

from app.core.config import settings
from app.models.audit import (
    AuditChainHead,
    AuditLog,
    AuditLogCheckpoint,
    AuditShipState,
)

# Current hash-chain algorithm version. Version 1 was an *unkeyed* SHA-256 hash,
# which is tamper-EVIDENT but not tamper-PROOF: anyone able to write audit rows
# could recompute a fully valid chain. Version 2 keys the chain with HMAC-SHA256
# so forging the chain requires the signing key, not just DB write access.
# Version 3 additionally includes organization_id in the hash input, making
# tenant attribution tamper-proof for new rows (v1/v2 rows predate the column
# and verify without it — the backfilled column is scoping metadata there).
# Version 4 additionally includes event_category and severity: neither was
# covered by any prior version despite both being read back into the hash
# input dict (_build_hash_data), so a DB-write-level attacker could rewrite
# either field on a row (e.g. severity "critical" -> "info") with no hash
# mismatch — hiding a security incident from severity/category-filtered
# admin review, the exact tamper the chain exists to make detectable.
_CURRENT_HASH_VERSION = 4
_KEYED_MIN_VERSION = 2
_LEGACY_HASH_VERSION = 1

_GENESIS_HASH = "0" * 64
_CHAIN_HEAD_ID = 1
# Rows sealed per transaction. Bounds how long one sealer holds the chain-head
# lock; a larger backlog drains over several transactions.
_SEAL_BATCH_SIZE = 500
# Session.info key create_log_entry sets, so the after-commit hook knows the
# transaction it just committed carried audit rows.
_SEAL_REQUESTED = "audit_seal_requested"


def _get_audit_signing_key() -> str:
    """Return the HMAC key for the audit chain.

    Prefers a dedicated ``AUDIT_LOG_SIGNING_KEY`` (ideally stored outside the
    app database) and falls back to ``SECRET_KEY``. Either way the key lives in
    application config/secrets, never in the audit tables, so a DB-only attacker
    cannot forge the chain.
    """
    return settings.AUDIT_LOG_SIGNING_KEY or settings.SECRET_KEY


# Domain label for the key fingerprint stored on each row. A keyed digest of a
# fixed label, truncated, identifies the key without revealing it: recovering
# the key from it is as hard as forging the HMAC itself.
_KEY_ID_LABEL = b"logbook:audit-log-signing-key-id:v1"
_KEY_ID_LENGTH = 16


def audit_signing_key_id(key: str) -> str:
    """Return the fingerprint recorded on a row signed with ``key``."""
    return hmac.new(key.encode(), _KEY_ID_LABEL, hashlib.sha256).hexdigest()[
        :_KEY_ID_LENGTH
    ]


class _AuditKeyring:
    """The keys a verification run may check a row against.

    ``current`` is the key new rows are signed with. ``legacy`` is
    ``SECRET_KEY``, and exists only when a distinct dedicated key is
    configured: before 2026-10-06 the shipped compose files did not pass
    ``AUDIT_LOG_SIGNING_KEY`` through, so installs that set it in ``.env``
    signed every row with the fallback. Those rows must keep verifying once
    the dedicated key arrives (owner decision, 2026-10-06), but SECRET_KEY
    must not become a permanent second key — so it is accepted only for rows
    before the chain's cut-over, the first row recording the dedicated key.
    """

    def __init__(self) -> None:
        self.current = _get_audit_signing_key()
        self.current_id = audit_signing_key_id(self.current)
        dedicated = settings.AUDIT_LOG_SIGNING_KEY
        secret = settings.SECRET_KEY
        self.legacy: str | None = (
            secret if dedicated and secret and secret != dedicated else None
        )
        self.legacy_id = audit_signing_key_id(self.legacy) if self.legacy else None
        self.legacy_rows: list[int] = []

    def warn_if_legacy_used(self, what: str) -> None:
        """One WARNING per run, not per row, naming what SECRET_KEY verified."""
        if not self.legacy_rows:
            return
        logger.warning(
            f"Audit integrity: {len(self.legacy_rows)} {what} verified with "
            "SECRET_KEY, the fallback that signed them before "
            "AUDIT_LOG_SIGNING_KEY reached the backend (ids "
            f"{self.legacy_rows[0]}-{self.legacy_rows[-1]}). They are accepted "
            "only before the first row signed with AUDIT_LOG_SIGNING_KEY; "
            "rotating SECRET_KEY will make them unverifiable."
        )


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
            normalized: str = (
                ts.astimezone(UTC)
                .replace(microsecond=0)
                .isoformat(timespec="microseconds")
            )
            return normalized
        return str(ts)

    @staticmethod
    def calculate_hash(
        log_data: dict[str, Any],
        previous_hash: str,
        version: int = _CURRENT_HASH_VERSION,
        key: str | None = None,
    ) -> str:
        """
        Calculate the integrity hash for a log entry.

        Creates a deterministic hash from log entry data and the previous hash,
        forming a blockchain-inspired chain. ``version`` selects the algorithm:

        - ``4`` (default): keyed HMAC-SHA256 with organization_id,
          event_category, and severity in the hash input.
        - ``3``: keyed HMAC-SHA256 with organization_id but not
          event_category/severity (rows written before those were covered).
        - ``2``: keyed HMAC-SHA256 without organization_id (rows written
          before the column existed).
        - ``1``: legacy unkeyed SHA-256, retained ONLY to verify entries written
          before the keyed upgrade. Never used for new entries.

        ``key`` overrides the signing key for keyed versions; verification
        passes the key a row's ``signing_key_id`` names.
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
        # v4 adds event_category and severity, inserted at a fixed distance
        # from the end (before event_data_str/previous_hash) so the position
        # is correct whether or not the v3 insert above ran. Older rows keep
        # verifying byte-identically without these two fields.
        if version >= 4:
            fields[-2:-2] = [
                str(log_data.get("event_category", "")),
                str(log_data.get("severity", "")),
            ]
        data_string = "|".join(fields)

        if version >= _KEYED_MIN_VERSION:
            return hmac.new(
                (key if key is not None else _get_audit_signing_key()).encode(),
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

    def _check_keyed_row(
        self,
        log: AuditLog,
        previous_hash: str,
        row_version: int,
        keyring: _AuditKeyring,
        cutover_id: int | None,
    ) -> tuple[str | None, str]:
        """Check a keyed row's stored hash against the key it names.

        Returns ``(error, calculated_hash)``; ``error`` is None when the row
        verifies. A row recording the current key's id verifies only with that
        key. A row with no id (written before ids were recorded) verifies with
        the current key, else SECRET_KEY; a row recording SECRET_KEY's id,
        only with SECRET_KEY. Either SECRET_KEY path is refused after
        ``cutover_id``, the first row that records the dedicated key.
        """
        log_data = self._build_hash_data(log)
        stored = log.current_hash or ""
        recorded = getattr(log, "signing_key_id", None)
        calculated = self.calculate_hash(
            log_data, previous_hash, row_version, keyring.current
        )

        if recorded is not None and recorded not in (
            keyring.current_id,
            keyring.legacy_id,
        ):
            return (
                "Unknown signing key - the row's signing_key_id matches "
                "neither the configured audit signing key nor SECRET_KEY",
                calculated,
            )
        if recorded in (None, keyring.current_id) and hmac.compare_digest(
            calculated, stored
        ):
            return None, calculated
        if keyring.legacy is None or recorded == keyring.current_id:
            return "Hash mismatch - log entry has been tampered with", calculated

        legacy_hash = self.calculate_hash(
            log_data, previous_hash, row_version, keyring.legacy
        )
        if not hmac.compare_digest(legacy_hash, stored):
            return "Hash mismatch - log entry has been tampered with", (
                calculated if recorded is None else legacy_hash
            )
        if cutover_id is not None and log.id > cutover_id:
            return (
                "Signed with SECRET_KEY after the audit chain moved to "
                "AUDIT_LOG_SIGNING_KEY - the legacy key is accepted only for "
                f"entries before id {cutover_id}",
                legacy_hash,
            )
        keyring.legacy_rows.append(log.id)
        return None, legacy_hash

    @staticmethod
    def _cutover_in(logs, keyring: _AuditKeyring) -> int | None:
        """First row id in ``logs`` that records the dedicated key, if any."""
        if keyring.legacy is None:
            return None
        return min(
            (
                log.id
                for log in logs
                if getattr(log, "signing_key_id", None) == keyring.current_id
            ),
            default=None,
        )

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
        Create a new audit log entry, unsealed.

        The row is inserted in the caller's transaction, so it commits or
        rolls back with the action it records. Its chain position and hashes
        are assigned afterwards by ``seal_pending`` (SEC2-28-10): reading the
        chain's tail here raced every other writer and forked the chain, and
        locking the tail here would hold that lock until the caller commits,
        serializing every audited request behind it.
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

                # Microseconds are zeroed on the STORED value, not just in the
                # hash input: MySQL DATETIME(0) ROUNDS fractional seconds on
                # insert, so storing 12.7s would read back as 13s and fail
                # verification about half the time. timestamp_nanos preserves
                # sub-second ordering losslessly.
                timestamp = datetime.now(UTC).replace(microsecond=0)
                timestamp_nanos = time.time_ns()

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
                )

                db.add(log_entry)
                await db.flush()
                await db.refresh(log_entry)

            db.info[_SEAL_REQUESTED] = True
            return log_entry

        except Exception as e:
            logger.error(f"Failed to create audit log: {e}")
            # Don't re-raise - audit log failures should not break the caller's
            # operation. The savepoint rollback already undid the audit changes
            # without affecting the outer transaction.
            return None

    async def _lock_chain_head(self, db: AsyncSession) -> AuditChainHead:
        """Return the chain-head row, locked FOR UPDATE until ``db`` ends its
        transaction. Creates it on an installation built by ``create_all``,
        which has the table but not the row the migration seeds."""
        # populate_existing: a session that sealed earlier would otherwise be
        # handed its identity-map copy, holding the last_seq it saw then.
        stmt = (
            select(AuditChainHead)
            .where(AuditChainHead.id == _CHAIN_HEAD_ID)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        head: AuditChainHead | None = (await db.execute(stmt)).scalar_one_or_none()
        if head is not None:
            return head

        last_seq = (await db.execute(select(func.max(AuditLog.chain_seq)))).scalar()
        last_hash = None
        if last_seq:
            last_hash = (
                await db.execute(
                    select(AuditLog.current_hash).where(AuditLog.chain_seq == last_seq)
                )
            ).scalar()
        # Never start below the shipping watermark: it is a chain position,
        # and a position it has already passed would never be shipped.
        shipped = (
            await db.execute(select(func.max(AuditShipState.last_shipped_id)))
        ).scalar()
        try:
            async with db.begin_nested():
                db.add(
                    AuditChainHead(
                        id=_CHAIN_HEAD_ID,
                        last_seq=max(last_seq or 0, shipped or 0),
                        last_hash=last_hash,
                    )
                )
                await db.flush()
        except IntegrityError:
            # Another sealer created it first. The locked read below waits
            # for that transaction to finish and then returns its row.
            pass
        created: AuditChainHead = (await db.execute(stmt)).scalar_one()
        return created

    async def _tail_hash(self, db: AsyncSession, head: AuditChainHead) -> str:
        """The hash the next sealed row links to.

        Read from the tail row itself while it exists, not from
        ``head.last_hash``: ``rehash_chain`` may rewrite a legacy tail row's
        hash, and the chain must continue from what verification will read.
        ``head.last_hash`` covers a tail the retention job has purged.
        """
        if head.last_seq:
            row_hash = (
                await db.execute(
                    select(AuditLog.current_hash).where(
                        AuditLog.chain_seq == head.last_seq
                    )
                )
            ).scalar()
            if row_hash:
                return str(row_hash)
        return head.last_hash or _GENESIS_HASH

    async def seal_pending(
        self, db: AsyncSession, batch_size: int = _SEAL_BATCH_SIZE
    ) -> int:
        """Seal up to ``batch_size`` unsealed rows visible to ``db`` onto the
        chain, and return how many were sealed.

        Locks the chain-head row, so concurrent sealers serialize and each
        extends the tail the previous one committed: the chain cannot fork.
        Rows are sealed in id order among those visible, so a row whose
        transaction committed late joins the chain after rows with higher
        ids; ``chain_seq`` records where.

        Does not commit. The head lock is held until ``db``'s transaction
        ends, so the caller must keep that transaction short;
        ``seal_audit_chain`` is the self-contained entry point.
        """
        head = await self._lock_chain_head(db)
        # A plain (non-locking) read, issued after the head lock: its snapshot
        # therefore includes everything the previous sealer committed. A
        # locking read would instead wait on every caller transaction holding
        # an uncommitted audit row -- while this one holds the head lock.
        pending = (
            (
                await db.execute(
                    select(AuditLog)
                    .where(AuditLog.chain_seq.is_(None))
                    .order_by(AuditLog.id)
                    .limit(batch_size)
                    .execution_options(populate_existing=True)
                )
            )
            .scalars()
            .all()
        )
        if not pending:
            return 0

        previous_hash = await self._tail_hash(db, head)
        signing_key = _get_audit_signing_key()
        key_id = audit_signing_key_id(signing_key)
        seq = head.last_seq
        for row in pending:
            seq += 1
            # Hashed from the row as stored -- the same values verification
            # will read back -- and signed with the key configured now, which
            # signing_key_id records.
            current_hash = self.calculate_hash(
                self._build_hash_data(row),
                previous_hash,
                _CURRENT_HASH_VERSION,
                signing_key,
            )
            values = {
                "chain_seq": seq,
                "previous_hash": previous_hash,
                "current_hash": current_hash,
                "hash_version": _CURRENT_HASH_VERSION,
                "signing_key_id": key_id,
            }
            # "AND chain_seq IS NULL" makes sealing a row twice impossible
            # rather than merely unlikely: were this session's view ever
            # stale, the update matches nothing and the batch rolls back
            # instead of re-linking a row that is already on the chain.
            result = await db.execute(
                update(AuditLog)
                .where(AuditLog.id == row.id, AuditLog.chain_seq.is_(None))
                .values(**values)
                .execution_options(synchronize_session=False)
            )
            if result.rowcount != 1:
                raise RuntimeError(
                    f"Audit row {row.id} was sealed by another transaction "
                    "while this one held the chain head"
                )
            for name, value in values.items():
                set_committed_value(row, name, value)
            previous_hash = current_hash

        head.last_seq = seq
        head.last_hash = previous_hash
        await db.flush()
        return len(pending)

    async def verify_integrity(
        self,
        db: AsyncSession,
        start_id: int | None = None,
        end_id: int | None = None,
    ) -> dict[str, Any]:
        """
        Verify the integrity of the audit log chain

        Only sealed rows are verified, walked in chain order (``chain_seq``).
        A row awaiting its seal has no hash yet, so it can be neither intact
        nor tampered; it is counted in ``pending_seal`` instead. ``start_id``
        and ``end_id`` bound the window by row id.

        Returns:
            Dict with verification results including:
            - verified: bool - whether integrity check passed
            - total_checked: int - number of entries checked
            - pending_seal: int - entries in the window not yet sealed
            - errors: List - any integrity violations found
        """
        query = (
            select(AuditLog)
            .where(AuditLog.chain_seq.isnot(None))
            .order_by(AuditLog.chain_seq)
        )
        pending_query = (
            select(func.count())
            .select_from(AuditLog)
            .where(AuditLog.chain_seq.is_(None))
        )
        if start_id:
            query = query.where(AuditLog.id >= start_id)
            pending_query = pending_query.where(AuditLog.id >= start_id)
        if end_id:
            query = query.where(AuditLog.id <= end_id)
            pending_query = pending_query.where(AuditLog.id <= end_id)
        windowed = bool(start_id or end_id)

        result = await db.execute(query)
        logs = result.scalars().all()
        pending_seal = (await db.execute(pending_query)).scalar() or 0

        if not logs:
            return {
                "verified": True,
                "total_checked": 0,
                "pending_seal": pending_seal,
                "first_id": None,
                "last_id": None,
                "errors": [],
            }

        results = {
            "verified": True,
            "total_checked": len(logs),
            "pending_seal": pending_seal,
            "first_id": logs[0].id,
            "last_id": logs[-1].id,
            "errors": [],
        }

        # The genesis anchor below applies to the chain's first sealed row.
        # Without start_id the walk begins there -- unless end_id cut the
        # window short of it, which a row committed late and sealed after
        # higher ids can do, so ask the table rather than assume.
        chain_start_seq = logs[0].chain_seq
        if start_id is None and end_id:
            chain_start_seq = (
                await db.execute(select(func.min(AuditLog.chain_seq)))
            ).scalar()

        # Verify each log entry. Legacy SHA-256 is accepted only through the
        # externally configured legacy ID boundary. The per-row hash_version is
        # attacker-writable and therefore cannot itself authorize an unkeyed
        # hash; without this independent boundary an attacker could rewrite the
        # whole keyed suffix as v1 and recompute it without the HMAC key.
        #
        # No-downgrade guard: once the chain has produced any keyed (v2) entry,
        # every later entry must also be keyed. Otherwise an attacker with DB
        # write access could rewrite the tail as forgeable legacy (v1) rows and
        # still present a self-consistent chain. ``max_version_seen`` tracks the
        # high-water mark; a lower-versioned row after it is treated as tamper.
        max_version_seen = _LEGACY_HASH_VERSION
        keyring = _AuditKeyring()
        # SECRET_KEY is accepted only before the cut-over. A run that starts
        # at the chain's beginning holds every earlier row and finds it among
        # them; a window starting mid-chain must ask the table, or a window
        # past the cut-over would accept SECRET_KEY because it never saw it.
        if start_id is not None and keyring.legacy is not None:
            cutover_id = (
                await db.execute(
                    select(func.min(AuditLog.id)).where(
                        AuditLog.signing_key_id == keyring.current_id
                    )
                )
            ).scalar()
        else:
            cutover_id = self._cutover_in(logs, keyring)
        for i, log in enumerate(logs):
            row_version = log.hash_version or _LEGACY_HASH_VERSION
            if row_version >= _KEYED_MIN_VERSION:
                hash_error, calculated_hash = self._check_keyed_row(
                    log, log.previous_hash, row_version, keyring, cutover_id
                )
            else:
                calculated_hash = self.calculate_hash(
                    self._build_hash_data(log), log.previous_hash, row_version
                )
                hash_error = (
                    None
                    if calculated_hash == log.current_hash
                    else "Hash mismatch - log entry has been tampered with"
                )

            if (
                row_version < _KEYED_MIN_VERSION
                and log.id > settings.AUDIT_LOG_LEGACY_MAX_ID
            ):
                results["verified"] = False
                results["errors"].append(
                    {
                        "log_id": log.id,
                        "error": (
                            "Unkeyed hash is not permitted after the trusted "
                            "legacy audit boundary"
                        ),
                        "row_version": row_version,
                        "legacy_max_id": settings.AUDIT_LOG_LEGACY_MAX_ID,
                    }
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

            if hash_error is not None:
                results["verified"] = False
                results["errors"].append(
                    {
                        "log_id": log.id,
                        "error": hash_error,
                        "expected_hash": log.current_hash,
                        "calculated_hash": calculated_hash,
                        "signing_key_id": getattr(log, "signing_key_id", None),
                    }
                )

            # Check chain integrity (except for first entry). An id window can
            # leave out a row in the middle of the walk -- chain order is not
            # id order -- so a windowed check links only rows that are
            # adjacent on the chain. A full walk links every pair: a missing
            # position there is a deleted row and must fail.
            if i > 0 and (not windowed or log.chain_seq == logs[i - 1].chain_seq + 1):
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
            elif i == 0 and start_id is None and log.chain_seq == chain_start_seq:
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
                    await self._is_archived_boundary(
                        db, log.id, log.previous_hash, keyring, cutover_id
                    )
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
            # Checkpoints record row ids, and the last row on the chain need
            # not hold the highest id.
            current_max_id = max(log.id for log in logs)
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
                        "log_id": current_max_id,
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

        keyring.warn_if_legacy_used("audit entries or archive attestations")
        return results

    async def rehash_chain(self, db: AsyncSession) -> int:
        """
        Recompute and store correct hashes for the entire audit log chain.

        This is needed when a bug caused creation-time hashes to differ from
        verification-time hashes (e.g. timestamp timezone or None handling).
        The log data itself is unchanged — only the stored hashes are corrected.

        Returns the number of entries rehashed. Unsealed rows have no hash to
        repair; the sealer links them to whatever this leaves at the tail.
        """
        result = await db.execute(
            select(AuditLog)
            .where(AuditLog.chain_seq.isnot(None))
            .order_by(AuditLog.chain_seq)
        )
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
        keyring = _AuditKeyring()
        cutover_id = self._cutover_in(logs, keyring)
        for log in logs:
            row_version = log.hash_version or _LEGACY_HASH_VERSION

            if (
                row_version < _KEYED_MIN_VERSION
                and log.id > settings.AUDIT_LOG_LEGACY_MAX_ID
            ):
                raise ValueError(
                    "Refusing to rehash: unkeyed audit entry "
                    f"{log.id} is after the trusted legacy boundary "
                    f"({settings.AUDIT_LOG_LEGACY_MAX_ID}). This may be a "
                    "hash-version downgrade attack."
                )

            if row_version >= _KEYED_MIN_VERSION:
                # Keyed row: verify against its stored hash, never overwrite it.
                hash_error, _ = self._check_keyed_row(
                    log, previous_hash, row_version, keyring, cutover_id
                )
                if hash_error is not None:
                    raise ValueError(
                        "Refusing to rehash: keyed audit entry "
                        f"{log.id} does not match its stored hash ({hash_error}). "
                        "This is a genuine integrity signal (tamper or a bug in "
                        "keyed hashing), not a legacy-hash mismatch — rehash "
                        "will not overwrite it. Investigate via the integrity "
                        "report."
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

        keyring.warn_if_legacy_used("audit entries")
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
            # Chain order is not id order; an offline verifier walks this.
            "chain_seq": getattr(row, "chain_seq", None),
            "previous_hash": row.previous_hash,
            "current_hash": row.current_hash,
            "hash_version": row.hash_version,
            "signing_key_id": getattr(row, "signing_key_id", None),
        }

    @staticmethod
    def compute_archive_attestation(
        first_log_id: int,
        last_log_id: int,
        last_log_hash: str,
        key: str | None = None,
    ) -> str:
        """Keyed HMAC attesting that a checkpoint range was legitimately
        archived by the retention job. Kept out of the checkpoint's own
        unkeyed checkpoint_hash on purpose: DB write access must not be
        enough to sanction a head deletion."""
        data = f"audit-archive|{first_log_id}|{last_log_id}|{last_log_hash}"
        return hmac.new(
            (key if key is not None else _get_audit_signing_key()).encode(),
            data.encode(),
            hashlib.sha256,
        ).hexdigest()

    async def _is_archived_boundary(
        self,
        db: AsyncSession,
        head_id: int,
        previous_hash: str,
        keyring: _AuditKeyring | None = None,
        cutover_id: int | None = None,
    ) -> bool:
        """Whether the current chain head legitimately follows an archived
        (exported-and-purged) range: some checkpoint below the head must
        record this exact boundary hash with a valid keyed attestation.

        An attestation made with SECRET_KEY (an archive run before the
        dedicated key reached the backend) is accepted only for a range that
        ends before ``cutover_id``, the same bound the rows are held to."""
        keyring = keyring or _AuditKeyring()
        result = await db.execute(
            select(AuditLogCheckpoint)
            .where(AuditLogCheckpoint.archived_at.isnot(None))
            .where(AuditLogCheckpoint.last_log_hash == previous_hash)
            .where(AuditLogCheckpoint.last_log_id < head_id)
        )
        for cp in result.scalars().all():
            if not cp.archive_attestation:
                continue
            expected = self.compute_archive_attestation(
                cp.first_log_id, cp.last_log_id, cp.last_log_hash, keyring.current
            )
            if hmac.compare_digest(cp.archive_attestation, expected):
                return True
            if keyring.legacy is None or (
                cutover_id is not None and cp.last_log_id >= cutover_id
            ):
                continue
            legacy = self.compute_archive_attestation(
                cp.first_log_id, cp.last_log_id, cp.last_log_hash, keyring.legacy
            )
            if hmac.compare_digest(cp.archive_attestation, legacy):
                keyring.legacy_rows.append(cp.last_log_id)
                return True
        return False

    async def _is_chain_prefix(self, db: AsyncSession, end_id: int) -> bool:
        """Whether the rows with ``id <= end_id`` are exactly the start of
        the sealed chain.

        Retention purges by id (checkpoints cover id ranges), and the
        surviving head must link to the attested hash of the last purged
        row. That only holds when every purged row is sealed and comes
        before every surviving row on the chain. A transaction that inserted
        early and committed late is sealed after rows with higher ids, so an
        id boundary can occasionally fall inside the chain rather than
        between two of its positions.
        """
        unsealed, last_inside = (
            await db.execute(
                select(
                    func.sum(case((AuditLog.chain_seq.is_(None), 1), else_=0)),
                    func.max(AuditLog.chain_seq),
                ).where(AuditLog.id <= end_id)
            )
        ).one()
        if unsealed:
            return False
        first_outside = (
            await db.execute(
                select(func.min(AuditLog.chain_seq)).where(AuditLog.id > end_id)
            )
        ).scalar()
        return first_outside is None or (
            last_inside is not None and last_inside < first_outside
        )

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
        candidates: list[tuple[int, AuditLogCheckpoint]] = []
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
                candidates.append((cp.last_log_id, cp))
            expected_next = max(expected_next, cp.last_log_id + 1)

        if not candidates:
            results["skipped_reason"] = "no checkpoint-covered rows past retention"
            return results

        # Furthest boundary first; fall back to earlier ones when a row
        # committed late was sealed across it (see _is_chain_prefix).
        purge_end: int | None = None
        boundary_cp: AuditLogCheckpoint | None = None
        for end, cp in reversed(candidates):
            if await self._is_chain_prefix(db, end):
                purge_end, boundary_cp = end, cp
                break
        if purge_end is None or boundary_cp is None:
            results["skipped_reason"] = (
                "no retention boundary is a clean prefix of the sealed chain"
            )
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
                    .order_by(AuditLog.chain_seq)
                )
            )
            .scalars()
            .all()
        )
        # Last on the chain, which is what the surviving head links to.
        last_row = rows[-1]

        # Archives contain the complete, unredacted audit records.  Do not
        # rely on the process umask to keep either the directory or files
        # private, especially when the configured path is on a shared volume.
        os.makedirs(archive_dir, mode=0o700, exist_ok=True)
        os.chmod(archive_dir, 0o700)
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        filename = f"audit_archive_{rows[0].id:012d}-{purge_end:012d}_{stamp}.jsonl.gz"
        archive_path = os.path.join(archive_dir, filename)
        fd = os.open(archive_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        # The mode passed to os.open is filtered by the process umask — a
        # hostile umask could leave the only remaining copy of the purged
        # rows unreadable (mode 0000). fchmod re-asserts the exact mode,
        # matching the explicit chmod on the directory above.
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as raw_fh:
            with gzip.open(raw_fh, "wt", encoding="utf-8") as fh:
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
        if any(log.current_hash is None for log in logs):
            # A checkpoint attests hashes; an unsealed row has none yet, and
            # attesting the range without it would make its later seal look
            # like an insertion into an attested range.
            raise ValueError("Range contains audit entries not yet sealed")

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


async def seal_audit_chain(max_batches: int = 20) -> int:
    """Seal committed, unsealed audit rows, each batch in its own short
    transaction on its own session. Returns the number of rows sealed.

    Being a separate session is the point: it sees a caller's audit rows only
    once that caller has committed, so a rolled-back action never reaches
    the chain.
    """
    from app.core.database import async_session_factory

    total = 0
    for _ in range(max_batches):
        async with async_session_factory() as db:
            try:
                sealed = await audit_logger.seal_pending(db)
                await db.commit()
            except Exception:
                await db.rollback()
                raise
        total += sealed
        if sealed < _SEAL_BATCH_SIZE:
            break
    return total


# One in-flight after-commit sealer per process. A burst of audited commits
# (SEC2-28-10's own reproduction: a flood of requests from a blocked IP, each
# writing an audit row on its own session) would otherwise start one sealer
# per commit, each holding a pooled connection while it queues on the head
# lock. A commit arriving mid-run sets _seal_rerun so its row is not missed.
_seal_task: asyncio.Task[None] | None = None
_seal_rerun = False


async def _run_requested_seals() -> None:
    global _seal_rerun
    while True:
        _seal_rerun = False
        try:
            await seal_audit_chain()
        except Exception as e:
            # The periodic audit_chain_seal task is the backstop; a row left
            # unsealed here is sealed on its next run.
            logger.warning(f"After-commit audit sealing failed: {e!r}")
            return
        if not _seal_rerun:
            return


def request_audit_seal() -> None:
    """Seal soon, in the background, without blocking the caller."""
    global _seal_task, _seal_rerun
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return  # no event loop (a sync script): the periodic task seals
    if (
        _seal_task is not None
        and not _seal_task.done()
        and _seal_task.get_loop() is loop
    ):
        _seal_rerun = True
        return
    _seal_task = loop.create_task(_run_requested_seals())


@event.listens_for(Session, "after_commit")
def _seal_after_commit(session: Session) -> None:
    if not session.info.pop(_SEAL_REQUESTED, False):
        return
    # A session bound to a Connection someone else began a transaction on
    # (the test fixture's outer transaction, a migration) has only released
    # a savepoint: its rows are not committed and no other session could
    # see them to seal.
    if isinstance(session.bind, Connection):
        return
    request_audit_seal()


@event.listens_for(Session, "after_soft_rollback")
def _forget_seal_request(session: Session, previous_transaction) -> None:
    # Only the outermost rollback discards the audit rows; a savepoint
    # rolled back after the audit write leaves them to be committed.
    if previous_transaction.parent is None and not previous_transaction.nested:
        session.info.pop(_SEAL_REQUESTED, None)


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
            "pending_seal": result.get("pending_seal", 0),
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

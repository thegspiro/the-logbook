"""
Audit Log Database Models

SQLAlchemy models for tamper-proof audit logging.
These tables are append-only and protected from modifications.
Compatible with MySQL database.
"""

import enum
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import JSON, BigInteger, DateTime, Enum, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base


class SeverityLevel(str, enum.Enum):
    """Audit log severity levels"""

    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class AuditLog(Base):
    """
    Tamper-proof audit log entries

    Each entry forms part of a cryptographic hash chain,
    making it impossible to modify historical entries without detection.
    """

    __tablename__ = "audit_logs"

    # Primary key
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    # Timestamp with nanosecond precision
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    timestamp_nanos: Mapped[int] = mapped_column(BigInteger, nullable=False)

    # Event Information
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    # event_category and severity are included in the hash chain from
    # hash_version 4 onward — earlier rows verify without them (they were
    # read into the hash-input dict but silently never hashed).
    event_category: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    severity: Mapped[SeverityLevel] = mapped_column(
        Enum(SeverityLevel, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )

    # Actor Information
    user_id: Mapped[Optional[str]] = mapped_column(String(36))
    username: Mapped[Optional[str]] = mapped_column(String(255))
    session_id: Mapped[Optional[str]] = mapped_column(String(36))

    # Owning tenant. Nullable: platform-level events (pre-auth alerts,
    # scheduled jobs with no acting user) have no org. Plain string, no FK —
    # audit rows are append-only and deliberately loosely coupled. Stamped
    # explicitly by callers or auto-resolved from user_id at write time;
    # rows written before the column existed were backfilled from user_id.
    # Included in the hash chain from hash_version 3 onward.
    organization_id: Mapped[Optional[str]] = mapped_column(String(36), index=True)

    # Context
    ip_address: Mapped[Optional[str]] = mapped_column(String(45))  # Support IPv6
    user_agent: Mapped[Optional[str]] = mapped_column(Text)
    geo_location: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON)

    # Event Data
    event_data: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)

    # Integrity Chain (Blockchain-inspired)
    #
    # The caller's transaction inserts the row with all four chain columns
    # NULL; AuditLogger.seal_pending fills them later in its own short
    # transaction, serialized on audit_chain_head (SEC2-28-10). Assigning the
    # chain position at insert time instead would mean reading the chain's
    # tail inside every caller's transaction, which either forks the chain
    # (non-locking read) or serializes every audited request behind one row
    # lock (locking read).
    #
    # chain_seq is the row's position in the chain and is NOT id order: a
    # transaction that inserts early and commits late is sealed after rows
    # with higher ids. Anything that walks or slices the chain orders by
    # chain_seq. Rows written before the sealer existed were backfilled with
    # chain_seq = id, which was their chain order.
    chain_seq: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    previous_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    current_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    # Hash algorithm version: NULL/1 = legacy unkeyed SHA-256, 2 = keyed
    # HMAC-SHA256, 3 = keyed + organization_id in the hash input. Stored
    # per-row so pre-upgrade entries still verify under their original
    # scheme while all new entries are forgery-resistant.
    hash_version: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # Fingerprint of the key that signed this row (audit_signing_key_id),
    # never the key itself. NULL on rows written before it was recorded:
    # those verify against AUDIT_LOG_SIGNING_KEY, else SECRET_KEY — the key
    # that signed them when the dedicated one never reached the container.
    # SECRET_KEY is accepted only up to the first row that records the
    # dedicated key; see AuditLogger.verify_integrity.
    signing_key_id: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Indexes
    __table_args__ = (
        Index("idx_audit_timestamp", "timestamp"),
        Index("idx_audit_user_id", "user_id"),
        Index("idx_audit_event_type", "event_type"),
        Index("idx_audit_current_hash", "current_hash"),
        Index("uq_audit_chain_seq", "chain_seq", unique=True),
    )

    def __repr__(self):
        return f"<AuditLog(id={self.id}, event_type={self.event_type}, timestamp={self.timestamp})>"


class AuditLogCheckpoint(Base):
    """
    Periodic integrity checkpoints for audit logs

    These provide cryptographic snapshots that can be used
    to verify the integrity of historical logs.
    """

    __tablename__ = "audit_log_checkpoints"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    checkpoint_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Range covered
    first_log_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    last_log_id: Mapped[int] = mapped_column(BigInteger, nullable=False)

    # Cryptographic proofs
    merkle_root: Mapped[str] = mapped_column(String(64), nullable=False)
    checkpoint_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    signature: Mapped[Optional[str]] = mapped_column(
        Text
    )  # Digital signature (future implementation)

    # Statistics
    total_entries: Mapped[int] = mapped_column(Integer, nullable=False)

    # Verification results
    verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # Retention archival. Set when this checkpoint's covered rows were
    # exported and purged by the retention job (see
    # AuditLogger.archive_expired_logs). last_log_hash is the chain hash of
    # the final purged row — the surviving chain head anchors to it instead
    # of the genesis hash. archive_attestation is a keyed HMAC over the
    # archived range, so a DB-only attacker cannot fabricate a "sanctioned"
    # head deletion: without the signing key the attestation won't verify.
    archived_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_log_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    archive_attestation: Mapped[Optional[str]] = mapped_column(
        String(64), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (Index("idx_checkpoint_time", "checkpoint_time"),)

    def __repr__(self):
        return f"<AuditLogCheckpoint(id={self.id}, logs={self.first_log_id}-{self.last_log_id})>"


class AuditShipState(Base):
    """
    High-water mark for off-host audit-log shipping.

    A single row (id=1) tracking the last chain position (AuditLog.chain_seq)
    successfully delivered to the configured external collector
    (AUDIT_SHIP_WEBHOOK_URL). The watermark only advances after the collector
    acknowledges a batch, so a failed delivery is retried on the next
    scheduled run.

    The column is still called ``last_shipped_id`` because it held an
    AuditLog.id until SEC2-28-10. It switched to chain_seq because only sealed
    rows can be shipped and they are not sealed in id order, so an id
    watermark would step over a row sealed late. Every row sealed before the
    switch has chain_seq = id, so a stored watermark kept its meaning.
    """

    __tablename__ = "audit_ship_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    last_shipped_id: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, server_default="0"
    )
    last_shipped_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self):
        return f"<AuditShipState(last_shipped_id={self.last_shipped_id})>"


class AuditChainHead(Base):
    """
    The sealed end of the audit hash chain: one row (id=1).

    AuditLogger.seal_pending locks this row (SELECT ... FOR UPDATE) for the
    length of one short sealing transaction, so two sealers serialize here and
    can never both extend the chain from the same tail. It is the only lock
    the chain takes, and no caller's transaction ever touches it.
    """

    __tablename__ = "audit_chain_head"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # chain_seq of the last sealed row, 0 before anything was sealed.
    last_seq: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, server_default="0"
    )
    # current_hash of that row. Kept here, not only on the row, because the
    # retention job may purge every sealed row; the next row must still link
    # to the purged tail, which the archive attestation vouches for.
    last_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self):
        return f"<AuditChainHead(last_seq={self.last_seq})>"

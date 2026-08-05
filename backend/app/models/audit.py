"""
Audit Log Database Models

SQLAlchemy models for tamper-proof audit logging.
These tables are append-only and protected from modifications.
Compatible with MySQL database.
"""

import enum

from sqlalchemy import (
    JSON,
    BigInteger,
    Column,
    DateTime,
    Enum,
    Index,
    Integer,
    String,
    Text,
)
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
    id = Column(BigInteger, primary_key=True, autoincrement=True)

    # Timestamp with nanosecond precision
    timestamp = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    timestamp_nanos = Column(BigInteger, nullable=False)

    # Event Information
    event_type = Column(String(100), nullable=False)
    event_category = Column(String(50), nullable=False, index=True)
    severity = Column(
        Enum(SeverityLevel, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )

    # Actor Information
    user_id = Column(String(36))
    username = Column(String(255))
    session_id = Column(String(36))

    # Owning tenant. Nullable: platform-level events (pre-auth alerts,
    # scheduled jobs with no acting user) have no org. Plain string, no FK —
    # audit rows are append-only and deliberately loosely coupled. Stamped
    # explicitly by callers or auto-resolved from user_id at write time;
    # rows written before the column existed were backfilled from user_id.
    # Included in the hash chain from hash_version 3 onward.
    organization_id = Column(String(36), index=True)

    # Context
    ip_address = Column(String(45))  # Support IPv6
    user_agent = Column(Text)
    geo_location = Column(JSON)

    # Event Data
    event_data = Column(JSON, nullable=False)

    # Integrity Chain (Blockchain-inspired)
    previous_hash = Column(String(64), nullable=False)
    current_hash = Column(String(64), nullable=False)
    # Hash algorithm version: NULL/1 = legacy unkeyed SHA-256, 2 = keyed
    # HMAC-SHA256, 3 = keyed + organization_id in the hash input. Stored
    # per-row so pre-upgrade entries still verify under their original
    # scheme while all new entries are forgery-resistant.
    hash_version = Column(Integer, nullable=True)

    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Indexes
    __table_args__ = (
        Index("idx_audit_timestamp", "timestamp"),
        Index("idx_audit_user_id", "user_id"),
        Index("idx_audit_event_type", "event_type"),
        Index("idx_audit_current_hash", "current_hash"),
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

    id = Column(Integer, primary_key=True, autoincrement=True)

    checkpoint_time = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Range covered
    first_log_id = Column(BigInteger, nullable=False)
    last_log_id = Column(BigInteger, nullable=False)

    # Cryptographic proofs
    merkle_root = Column(String(64), nullable=False)
    checkpoint_hash = Column(String(64), nullable=False)
    signature = Column(Text)  # Digital signature (future implementation)

    # Statistics
    total_entries = Column(Integer, nullable=False)

    # Verification results
    verified_at = Column(DateTime(timezone=True))

    # Retention archival. Set when this checkpoint's covered rows were
    # exported and purged by the retention job (see
    # AuditLogger.archive_expired_logs). last_log_hash is the chain hash of
    # the final purged row — the surviving chain head anchors to it instead
    # of the genesis hash. archive_attestation is a keyed HMAC over the
    # archived range, so a DB-only attacker cannot fabricate a "sanctioned"
    # head deletion: without the signing key the attestation won't verify.
    archived_at = Column(DateTime(timezone=True), nullable=True)
    last_log_hash = Column(String(64), nullable=True)
    archive_attestation = Column(String(64), nullable=True)

    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (Index("idx_checkpoint_time", "checkpoint_time"),)

    def __repr__(self):
        return f"<AuditLogCheckpoint(id={self.id}, logs={self.first_log_id}-{self.last_log_id})>"


class AuditShipState(Base):
    """
    High-water mark for off-host audit-log shipping.

    A single row (id=1) tracking the last AuditLog.id successfully delivered
    to the configured external collector (AUDIT_SHIP_WEBHOOK_URL). The
    watermark only advances after the collector acknowledges a batch, so a
    failed delivery is retried on the next scheduled run.
    """

    __tablename__ = "audit_ship_state"

    id = Column(Integer, primary_key=True)
    last_shipped_id = Column(BigInteger, nullable=False, default=0, server_default="0")
    last_shipped_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self):
        return f"<AuditShipState(last_shipped_id={self.last_shipped_id})>"

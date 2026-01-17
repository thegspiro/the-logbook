"""
Audit Log Database Models

SQLAlchemy models for tamper-proof audit logging.
These tables are append-only and protected from modifications.
Compatible with MySQL database.
"""

from sqlalchemy import (
    Column,
    BigInteger,
    String,
    DateTime,
    Enum,
    Integer,
    Text,
    Index,
    JSON,
)
from sqlalchemy.sql import func
from datetime import datetime
import enum

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
    timestamp = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    timestamp_nanos = Column(BigInteger, nullable=False)
    
    # Event Information
    event_type = Column(String(100), nullable=False, index=True)
    event_category = Column(String(50), nullable=False, index=True)
    severity = Column(Enum(SeverityLevel), nullable=False)
    
    # Actor Information
    user_id = Column(String(36), index=True)
    username = Column(String(255))
    session_id = Column(String(36))

    # Context
    ip_address = Column(String(45))  # Support IPv6
    user_agent = Column(Text)
    geo_location = Column(JSON)

    # Event Data
    event_data = Column(JSON, nullable=False)
    sensitive_data_encrypted = Column(Text)  # AES encrypted sensitive fields
    
    # Integrity Chain (Blockchain-inspired)
    previous_hash = Column(String(64), nullable=False)
    current_hash = Column(String(64), nullable=False, index=True)
    
    # Metadata
    server_id = Column(String(100))
    process_id = Column(Integer)
    
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    
    # Indexes
    __table_args__ = (
        Index('idx_audit_timestamp', 'timestamp'),
        Index('idx_audit_user_id', 'user_id'),
        Index('idx_audit_event_type', 'event_type'),
        Index('idx_audit_current_hash', 'current_hash'),
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
    
    checkpoint_time = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    
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
    verification_status = Column(String(20))  # pending, verified, failed
    verification_details = Column(JSON)
    
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    
    __table_args__ = (
        Index('idx_checkpoint_time', 'checkpoint_time'),
    )
    
    def __repr__(self):
        return f"<AuditLogCheckpoint(id={self.id}, logs={self.first_log_id}-{self.last_log_id})>"

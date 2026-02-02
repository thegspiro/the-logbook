"""
IP Security Database Models

SQLAlchemy models for IP-based security controls including:
- IP allowlist/exceptions for geo-blocking
- IP blocklist for known malicious IPs
- Access attempt logging
"""

from sqlalchemy import (
    Column,
    String,
    Boolean,
    DateTime,
    Integer,
    Text,
    Index,
    Enum,
)
from sqlalchemy.sql import func
from datetime import datetime
import enum
import uuid

from app.core.database import Base


def generate_uuid() -> str:
    """Generate UUID as string for MySQL compatibility"""
    return str(uuid.uuid4())


class IPExceptionType(str, enum.Enum):
    """Type of IP exception"""
    ALLOWLIST = "allowlist"  # Explicitly allowed (bypasses geo-blocking)
    BLOCKLIST = "blocklist"  # Explicitly blocked (regardless of country)


class IPExceptionStatus(str, enum.Enum):
    """Status of IP exception"""
    ACTIVE = "active"
    EXPIRED = "expired"
    REVOKED = "revoked"


class IPException(Base):
    """
    IP Exception model for allowlist/blocklist entries.

    Allows specific IPs to bypass geo-blocking or be explicitly blocked.
    Supports both individual IPs and CIDR ranges.
    """

    __tablename__ = "ip_exceptions"

    id = Column(String(36), primary_key=True, default=generate_uuid)

    # IP address or CIDR range (e.g., "192.168.1.100" or "10.0.0.0/8")
    ip_address = Column(String(45), nullable=False, index=True)
    cidr_range = Column(String(50))  # Optional CIDR notation

    # Exception type and status
    exception_type = Column(Enum(IPExceptionType), nullable=False, index=True)
    status = Column(Enum(IPExceptionStatus), default=IPExceptionStatus.ACTIVE, index=True)

    # Reason and documentation
    reason = Column(Text, nullable=False)
    description = Column(Text)

    # Who/what this exception is for
    organization_id = Column(String(36), index=True)  # Optional: org-specific exception
    user_id = Column(String(36), index=True)  # Optional: user-specific exception
    entity_name = Column(String(255))  # e.g., "VPN Exit Node", "Partner API"

    # Country information (for logging/reference)
    country_code = Column(String(2))
    country_name = Column(String(100))

    # Validity period
    valid_from = Column(DateTime(timezone=True), server_default=func.now())
    valid_until = Column(DateTime(timezone=True))  # Null = no expiration

    # Audit trail
    created_by = Column(String(36), nullable=False)  # User ID who created
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    revoked_by = Column(String(36))
    revoked_at = Column(DateTime(timezone=True))
    revoke_reason = Column(Text)

    # Usage tracking
    last_used_at = Column(DateTime(timezone=True))
    use_count = Column(Integer, default=0)

    __table_args__ = (
        Index('idx_ip_exception_ip', 'ip_address'),
        Index('idx_ip_exception_type_status', 'exception_type', 'status'),
        Index('idx_ip_exception_org', 'organization_id'),
    )

    def __repr__(self):
        return f"<IPException(ip={self.ip_address}, type={self.exception_type}, status={self.status})>"

    def is_valid(self) -> bool:
        """Check if exception is currently valid."""
        if self.status != IPExceptionStatus.ACTIVE:
            return False
        now = datetime.utcnow()
        if self.valid_from and now < self.valid_from:
            return False
        if self.valid_until and now > self.valid_until:
            return False
        return True


class BlockedAccessAttempt(Base):
    """
    Blocked Access Attempt model for logging denied requests.

    Records all requests that were blocked due to geo-blocking or IP blocklist.
    Critical for security auditing and identifying attack patterns.
    """

    __tablename__ = "blocked_access_attempts"

    id = Column(String(36), primary_key=True, default=generate_uuid)

    # Request information
    ip_address = Column(String(45), nullable=False, index=True)
    country_code = Column(String(2), index=True)
    country_name = Column(String(100))

    # Block reason
    block_reason = Column(String(100), nullable=False, index=True)
    block_details = Column(Text)

    # Request details
    request_path = Column(String(500))
    request_method = Column(String(10))
    user_agent = Column(Text)
    request_headers = Column(Text)  # JSON string of relevant headers

    # Timestamp
    blocked_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    __table_args__ = (
        Index('idx_blocked_ip_time', 'ip_address', 'blocked_at'),
        Index('idx_blocked_country_time', 'country_code', 'blocked_at'),
    )

    def __repr__(self):
        return f"<BlockedAccessAttempt(ip={self.ip_address}, country={self.country_code}, reason={self.block_reason})>"


class CountryBlockRule(Base):
    """
    Country Block Rule model for managing blocked countries.

    Allows dynamic management of blocked countries without code changes.
    """

    __tablename__ = "country_block_rules"

    id = Column(String(36), primary_key=True, default=generate_uuid)

    # Country information
    country_code = Column(String(2), nullable=False, unique=True)
    country_name = Column(String(100))

    # Rule status
    is_blocked = Column(Boolean, default=True, index=True)

    # Reason and documentation
    reason = Column(Text, nullable=False)
    risk_level = Column(String(20))  # low, medium, high, critical

    # Audit trail
    created_by = Column(String(36), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    updated_by = Column(String(36))

    # Statistics
    blocked_attempts_count = Column(Integer, default=0)
    last_blocked_at = Column(DateTime(timezone=True))

    __table_args__ = (
        Index('idx_country_rule_code', 'country_code'),
        Index('idx_country_rule_blocked', 'is_blocked'),
    )

    def __repr__(self):
        return f"<CountryBlockRule(country={self.country_code}, blocked={self.is_blocked})>"

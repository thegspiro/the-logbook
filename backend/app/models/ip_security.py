"""
IP Security Database Models

SQLAlchemy models for IP-based security controls including:
- IP allowlist/exceptions for geo-blocking (requires IT admin approval)
- IP blocklist for known malicious IPs
- Access attempt logging

Zero-Trust Security Model:
- All IP exceptions are user-specific
- Require IT administrator approval
- Must have a defined time period (no permanent exceptions)
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
    ForeignKey,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from datetime import datetime, timedelta
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


class IPExceptionApprovalStatus(str, enum.Enum):
    """Approval status for IP exceptions - requires IT admin approval"""
    PENDING = "pending"      # Awaiting IT admin review
    APPROVED = "approved"    # Approved by IT admin
    REJECTED = "rejected"    # Rejected by IT admin
    EXPIRED = "expired"      # Time period has ended
    REVOKED = "revoked"      # Manually revoked before expiration


class IPException(Base):
    """
    IP Exception model for user-specific allowlist/blocklist entries.

    ZERO-TRUST REQUIREMENTS:
    - Every exception MUST be tied to a specific user
    - Every exception MUST be approved by an IT administrator
    - Every exception MUST have a defined time period (no permanent exceptions)
    - All actions are logged for audit purposes
    """

    __tablename__ = "ip_exceptions"

    id = Column(String(36), primary_key=True, default=generate_uuid)

    # ============================================
    # Request Information
    # ============================================

    # IP address or CIDR range (e.g., "192.168.1.100" or "10.0.0.0/8")
    ip_address = Column(String(45), nullable=False, index=True)
    cidr_range = Column(String(50))  # Optional CIDR notation for ranges

    # Exception type
    exception_type = Column(Enum(IPExceptionType, values_callable=lambda x: [e.value for e in x]), nullable=False, index=True)

    # Reason and documentation (required - user must justify the request)
    reason = Column(Text, nullable=False)
    description = Column(Text)  # Additional details

    # ============================================
    # User Association (REQUIRED)
    # ============================================

    # The user this exception is for - REQUIRED for zero-trust
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # ============================================
    # Time Period (REQUIRED - no permanent exceptions)
    # ============================================

    # Requested duration in days (user specifies how long they need access)
    requested_duration_days = Column(Integer, nullable=False)

    # Actual validity period (set by IT admin upon approval)
    valid_from = Column(DateTime(timezone=True))  # Set when approved
    valid_until = Column(DateTime(timezone=True), nullable=False)  # REQUIRED - no permanent exceptions

    # Maximum allowed duration (configurable, e.g., 90 days)
    # IT admin can approve for less than requested but not more than max

    # ============================================
    # Approval Workflow
    # ============================================

    # Current approval status
    approval_status = Column(
        Enum(IPExceptionApprovalStatus, values_callable=lambda x: [e.value for e in x]),
        default=IPExceptionApprovalStatus.PENDING,
        nullable=False,
        index=True
    )

    # Request submitted
    requested_by = Column(String(36), ForeignKey("users.id"), nullable=False)  # User who submitted request
    requested_at = Column(DateTime(timezone=True), server_default=func.now())

    # Approval by IT Administrator
    approved_by = Column(String(36), ForeignKey("users.id"))  # IT admin who approved
    approved_at = Column(DateTime(timezone=True))
    approval_notes = Column(Text)  # IT admin notes on approval
    approved_duration_days = Column(Integer)  # Actual approved duration (may differ from requested)

    # Rejection (if applicable)
    rejected_by = Column(String(36), ForeignKey("users.id"))  # IT admin who rejected
    rejected_at = Column(DateTime(timezone=True))
    rejection_reason = Column(Text)  # Required when rejecting

    # Revocation (if exception needs to be ended early)
    revoked_by = Column(String(36), ForeignKey("users.id"))
    revoked_at = Column(DateTime(timezone=True))
    revoke_reason = Column(Text)

    # ============================================
    # Context Information
    # ============================================

    # Country information (auto-populated from IP lookup)
    country_code = Column(String(2))
    country_name = Column(String(100))

    # Use case description
    use_case = Column(String(100))  # e.g., "travel", "remote_work", "vpn", "partner_access"

    # ============================================
    # Usage Tracking
    # ============================================

    last_used_at = Column(DateTime(timezone=True))
    use_count = Column(Integer, default=0)

    # ============================================
    # Timestamps
    # ============================================

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # ============================================
    # Indexes
    # ============================================

    __table_args__ = (
        Index('idx_ip_exception_ip', 'ip_address'),
        Index('idx_ip_exception_user', 'user_id'),
        Index('idx_ip_exception_org', 'organization_id'),
        Index('idx_ip_exception_approval', 'approval_status'),
        Index('idx_ip_exception_type_status', 'exception_type', 'approval_status'),
        Index('idx_ip_exception_valid_until', 'valid_until'),
    )

    def __repr__(self):
        return f"<IPException(ip={self.ip_address}, user={self.user_id}, status={self.approval_status})>"

    def is_active(self) -> bool:
        """Check if exception is currently active and valid."""
        if self.approval_status != IPExceptionApprovalStatus.APPROVED:
            return False
        now = datetime.utcnow()
        if self.valid_from and now < self.valid_from:
            return False
        if self.valid_until and now > self.valid_until:
            return False
        return True

    def is_expired(self) -> bool:
        """Check if exception has expired."""
        if not self.valid_until:
            return False
        return datetime.utcnow() > self.valid_until

    def days_remaining(self) -> int:
        """Get number of days remaining until expiration."""
        if not self.valid_until:
            return 0
        delta = self.valid_until - datetime.utcnow()
        return max(0, delta.days)


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

    # Associated user (if authenticated)
    user_id = Column(String(36), ForeignKey("users.id"), index=True)

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
        Index('idx_blocked_user', 'user_id'),
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
    created_by = Column(String(36), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    updated_by = Column(String(36), ForeignKey("users.id"))

    # Statistics
    blocked_attempts_count = Column(Integer, default=0)
    last_blocked_at = Column(DateTime(timezone=True))

    __table_args__ = (
        Index('idx_country_rule_code', 'country_code'),
        Index('idx_country_rule_blocked', 'is_blocked'),
    )

    def __repr__(self):
        return f"<CountryBlockRule(country={self.country_code}, blocked={self.is_blocked})>"


class IPExceptionAuditLog(Base):
    """
    Audit log for all IP exception actions.

    Tracks every action taken on IP exceptions for compliance and security.
    """

    __tablename__ = "ip_exception_audit_log"

    id = Column(String(36), primary_key=True, default=generate_uuid)

    # Reference to the exception
    exception_id = Column(String(36), ForeignKey("ip_exceptions.id", ondelete="CASCADE"), nullable=False, index=True)

    # Action taken
    action = Column(String(50), nullable=False, index=True)  # requested, approved, rejected, revoked, expired, used

    # Who performed the action
    performed_by = Column(String(36), ForeignKey("users.id"), nullable=False)

    # When
    performed_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    # Details
    details = Column(Text)  # JSON with action-specific details
    ip_address = Column(String(45))  # IP from which action was performed

    __table_args__ = (
        Index('idx_exception_audit_exception', 'exception_id'),
        Index('idx_exception_audit_action', 'action'),
        Index('idx_exception_audit_time', 'performed_at'),
    )

    def __repr__(self):
        return f"<IPExceptionAuditLog(exception={self.exception_id}, action={self.action})>"

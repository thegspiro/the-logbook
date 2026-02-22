"""
Public Portal Models

Database models for the public portal module that enables secure,
read-only API access to selected organization data for public websites.
"""

from sqlalchemy import Column, String, Boolean, Integer, Text, ForeignKey, Index, JSON
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.dialects.mysql import CHAR
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import uuid

from app.core.database import Base


def UUID():
    """Generate UUID that works with both PostgreSQL and MySQL"""
    return str(uuid.uuid4())


class PublicPortalConfig(Base):
    """
    Configuration for the public portal module.

    Controls whether the public portal is enabled and sets default
    security parameters for API access.
    """
    __tablename__ = "public_portal_config"

    id = Column(String(36), primary_key=True, default=UUID)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True
    )

    # Enable/disable entire public portal
    enabled = Column(Boolean, default=False, nullable=False)

    # CORS configuration - list of allowed origins
    allowed_origins = Column(JSON, default=list, nullable=False)

    # Default rate limit (requests per hour per API key)
    default_rate_limit = Column(Integer, default=1000, nullable=False)

    # Cache TTL in seconds
    cache_ttl_seconds = Column(Integer, default=300, nullable=False)  # 5 minutes

    # Additional settings (flexible JSON column)
    settings = Column(JSON, default=dict, nullable=False)

    # Timestamps
    created_at = Column(String(26), nullable=False, default=lambda: datetime.now(timezone.utc).isoformat())
    updated_at = Column(
        String(26),
        nullable=False,
        default=lambda: datetime.now(timezone.utc).isoformat(),
        onupdate=lambda: datetime.now(timezone.utc).isoformat()
    )

    # Relationships
    organization = relationship("Organization", back_populates="public_portal_config")
    api_keys = relationship(
        "PublicPortalAPIKey",
        back_populates="config",
        cascade="all, delete-orphan"
    )
    access_logs = relationship(
        "PublicPortalAccessLog",
        back_populates="config",
        cascade="all, delete-orphan"
    )
    data_whitelist = relationship(
        "PublicPortalDataWhitelist",
        back_populates="config",
        cascade="all, delete-orphan"
    )

    def __repr__(self):
        return f"<PublicPortalConfig(org_id={self.organization_id}, enabled={self.enabled})>"


class PublicPortalAPIKey(Base):
    """
    API keys for accessing the public portal.

    Keys are hashed before storage. Only the prefix (first 8 chars)
    is stored in plaintext for identification purposes.
    """
    __tablename__ = "public_portal_api_keys"

    id = Column(String(36), primary_key=True, default=UUID)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    config_id = Column(
        String(36),
        ForeignKey("public_portal_config.id", ondelete="CASCADE"),
        nullable=False
    )

    # API key (hashed with bcrypt)
    key_hash = Column(String(255), nullable=False, unique=True, index=True)

    # First 8 characters of the key (for identification)
    key_prefix = Column(String(8), nullable=False)

    # Friendly name for this API key
    name = Column(String(100), nullable=False)

    # Override default rate limit (NULL = use default)
    rate_limit_override = Column(Integer, nullable=True)

    # Optional expiration date
    expires_at = Column(String(26), nullable=True)

    # Last time this key was used
    last_used_at = Column(String(26), nullable=True)

    # Active/revoked status
    is_active = Column(Boolean, default=True, nullable=False)

    # Who created this key
    created_by = Column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True
    )

    # Timestamps
    created_at = Column(String(26), nullable=False, default=lambda: datetime.now(timezone.utc).isoformat())

    # Relationships
    organization = relationship("Organization")
    config = relationship("PublicPortalConfig", back_populates="api_keys")
    creator = relationship("User")
    access_logs = relationship(
        "PublicPortalAccessLog",
        back_populates="api_key",
        cascade="all, delete-orphan"
    )

    # Indexes
    __table_args__ = (
        Index('idx_api_key_prefix', 'key_prefix'),
        Index('idx_api_key_active', 'is_active'),
    )

    def __repr__(self):
        return f"<PublicPortalAPIKey(id={self.id}, name={self.name}, active={self.is_active})>"

    @property
    def is_expired(self) -> bool:
        """Check if the API key has expired"""
        if not self.expires_at:
            return False
        try:
            expiry = datetime.fromisoformat(self.expires_at)
            return datetime.now(timezone.utc) > expiry
        except (ValueError, TypeError):
            return False

    @property
    def effective_rate_limit(self) -> int:
        """Get the effective rate limit for this key"""
        if self.rate_limit_override is not None:
            return self.rate_limit_override
        # Fallback to config default or 1000
        return self.config.default_rate_limit if self.config else 1000


class PublicPortalAccessLog(Base):
    """
    Audit log of all public portal API access.

    Records every request to the public API for security monitoring,
    anomaly detection, and compliance.
    """
    __tablename__ = "public_portal_access_log"

    id = Column(String(36), primary_key=True, default=UUID)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    config_id = Column(
        String(36),
        ForeignKey("public_portal_config.id", ondelete="CASCADE"),
        nullable=False
    )

    # API key used (NULL if invalid/missing key)
    api_key_id = Column(
        String(36),
        ForeignKey("public_portal_api_keys.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )

    # Request details
    ip_address = Column(String(45), nullable=False, index=True)  # IPv4/IPv6
    endpoint = Column(String(255), nullable=False, index=True)
    method = Column(String(10), nullable=False)  # GET, POST, etc.
    status_code = Column(Integer, nullable=False, index=True)
    response_time_ms = Column(Integer, nullable=True)  # Response time in milliseconds

    # User agent and other headers
    user_agent = Column(Text, nullable=True)
    referer = Column(String(500), nullable=True)

    # Timestamp of the request
    timestamp = Column(String(26), nullable=False, default=lambda: datetime.now(timezone.utc).isoformat())

    # Security flags
    flagged_suspicious = Column(Boolean, default=False, nullable=False)
    flag_reason = Column(Text, nullable=True)

    # Relationships
    organization = relationship("Organization")
    config = relationship("PublicPortalConfig", back_populates="access_logs")
    api_key = relationship("PublicPortalAPIKey", back_populates="access_logs")

    # Indexes for common queries
    __table_args__ = (
        Index('idx_access_log_timestamp', 'timestamp'),
        Index('idx_access_log_ip', 'ip_address'),
        Index('idx_access_log_suspicious', 'flagged_suspicious'),
        Index('idx_access_log_org_timestamp', 'organization_id', 'timestamp'),
    )

    def __repr__(self):
        return f"<PublicPortalAccessLog(endpoint={self.endpoint}, status={self.status_code}, ip={self.ip_address})>"


class PublicPortalDataWhitelist(Base):
    """
    Whitelist of data fields that can be exposed via the public portal.

    Uses a whitelist approach - only explicitly enabled fields are
    returned through the public API.
    """
    __tablename__ = "public_portal_data_whitelist"

    id = Column(String(36), primary_key=True, default=UUID)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    config_id = Column(
        String(36),
        ForeignKey("public_portal_config.id", ondelete="CASCADE"),
        nullable=False
    )

    # Data category (e.g., 'organization', 'events', 'personnel')
    data_category = Column(String(50), nullable=False, index=True)

    # Specific field name within the category
    field_name = Column(String(100), nullable=False)

    # Whether this field is enabled for public access
    is_enabled = Column(Boolean, default=False, nullable=False)

    # Timestamps
    created_at = Column(String(26), nullable=False, default=lambda: datetime.now(timezone.utc).isoformat())
    updated_at = Column(
        String(26),
        nullable=False,
        default=lambda: datetime.now(timezone.utc).isoformat(),
        onupdate=lambda: datetime.now(timezone.utc).isoformat()
    )

    # Relationships
    organization = relationship("Organization")
    config = relationship("PublicPortalConfig", back_populates="data_whitelist")

    # Unique constraint: one entry per org+category+field combination
    __table_args__ = (
        Index('idx_whitelist_category', 'data_category'),
        Index('idx_whitelist_enabled', 'is_enabled'),
        Index('idx_whitelist_unique', 'organization_id', 'data_category', 'field_name', unique=True),
    )

    def __repr__(self):
        return f"<PublicPortalDataWhitelist(category={self.data_category}, field={self.field_name}, enabled={self.is_enabled})>"

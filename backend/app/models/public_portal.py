"""
Public Portal Models

Database models for the public portal module that enables secure,
read-only API access to selected organization data for public websites.
"""

from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid

if TYPE_CHECKING:
    from app.models.user import Organization, User


class PublicPortalConfig(Base):
    """
    Configuration for the public portal module.

    Controls whether the public portal is enabled and sets default
    security parameters for API access.
    """

    __tablename__ = "public_portal_config"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    # Enable/disable entire public portal
    enabled: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )

    # CORS configuration - list of allowed origins
    allowed_origins: Mapped[list[str]] = mapped_column(
        JSON, default=list, nullable=False
    )

    # Default rate limit (requests per hour per API key)
    default_rate_limit: Mapped[int] = mapped_column(
        Integer, default=1000, nullable=False, server_default="1000"
    )

    # Cache TTL in seconds
    cache_ttl_seconds: Mapped[int] = mapped_column(
        Integer, default=300, nullable=False, server_default="300"
    )  # 5 minutes

    # Additional settings (flexible JSON column)
    settings: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization", back_populates="public_portal_config"
    )
    api_keys: Mapped[list["PublicPortalAPIKey"]] = relationship(
        "PublicPortalAPIKey", back_populates="config", cascade="all, delete-orphan"
    )
    access_logs: Mapped[list["PublicPortalAccessLog"]] = relationship(
        "PublicPortalAccessLog", back_populates="config", cascade="all, delete-orphan"
    )
    data_whitelist: Mapped[list["PublicPortalDataWhitelist"]] = relationship(
        "PublicPortalDataWhitelist",
        back_populates="config",
        cascade="all, delete-orphan",
    )

    def __repr__(self):
        return f"<PublicPortalConfig(org_id={self.organization_id}, enabled={self.enabled})>"


class PublicPortalAPIKey(Base):
    """
    API keys for accessing the public portal.

    Keys are hashed (bcrypt) before storage. Only a short selective prefix
    (first 16 chars: "logbook_" + 8 key chars) is stored in plaintext, both for
    identification and to make authentication lookups return a single candidate.
    """

    __tablename__ = "public_portal_api_keys"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    config_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("public_portal_config.id", ondelete="CASCADE"),
        nullable=False,
    )

    # API key (hashed with bcrypt)
    key_hash: Mapped[str] = mapped_column(
        String(255), nullable=False, unique=True, index=True
    )

    # Selective lookup prefix (first 16 chars: "logbook_" + 8 key chars) so a
    # by-prefix lookup returns a single candidate rather than every key. Legacy
    # keys created before this change stored only the constant "logbook_" (8
    # chars); they are self-healed to the 16-char selective prefix on next use.
    key_prefix: Mapped[str] = mapped_column(String(20), nullable=False)

    # Friendly name for this API key
    name: Mapped[str] = mapped_column(String(100), nullable=False)

    # Override default rate limit (NULL = use default)
    rate_limit_override: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Optional expiration date
    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Last time this key was used
    last_used_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Active/revoked status
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, server_default="1"
    )

    # Who created this key
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Relationships
    organization: Mapped["Organization"] = relationship("Organization")
    config: Mapped["PublicPortalConfig"] = relationship(
        "PublicPortalConfig", back_populates="api_keys"
    )
    creator: Mapped[Optional["User"]] = relationship("User")
    access_logs: Mapped[list["PublicPortalAccessLog"]] = relationship(
        "PublicPortalAccessLog", back_populates="api_key", cascade="all, delete-orphan"
    )

    # Indexes
    __table_args__ = (
        Index("idx_api_key_prefix", "key_prefix"),
        Index("idx_api_key_active", "is_active"),
    )

    def __repr__(self):
        return f"<PublicPortalAPIKey(id={self.id}, name={self.name}, active={self.is_active})>"

    @property
    def is_expired(self) -> bool:
        """Check if the API key has expired"""
        if not self.expires_at:
            return False
        expiry = (
            self.expires_at.replace(tzinfo=timezone.utc)
            if self.expires_at.tzinfo is None
            else self.expires_at
        )
        return bool(datetime.now(timezone.utc) > expiry)

    @property
    def effective_rate_limit(self) -> int:
        """Get the effective rate limit for this key"""
        override: Optional[int] = self.rate_limit_override
        if override is not None:
            return override
        # Fallback to config default or 1000
        return self.config.default_rate_limit if self.config else 1000


class PublicPortalAccessLog(Base):
    """
    Audit log of all public portal API access.

    Records every request to the public API for security monitoring,
    anomaly detection, and compliance.
    """

    __tablename__ = "public_portal_access_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    config_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("public_portal_config.id", ondelete="CASCADE"),
        nullable=False,
    )

    # API key used (NULL if invalid/missing key)
    api_key_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("public_portal_api_keys.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Request details
    ip_address: Mapped[str] = mapped_column(String(45), nullable=False)  # IPv4/IPv6
    endpoint: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    method: Mapped[str] = mapped_column(String(10), nullable=False)  # GET, POST, etc.
    status_code: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    response_time_ms: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )  # Response time in milliseconds

    # User agent and other headers
    user_agent: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    referer: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # Timestamp of the request
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Security flags
    flagged_suspicious: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )
    flag_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    organization: Mapped["Organization"] = relationship("Organization")
    config: Mapped["PublicPortalConfig"] = relationship(
        "PublicPortalConfig", back_populates="access_logs"
    )
    api_key: Mapped[Optional["PublicPortalAPIKey"]] = relationship(
        "PublicPortalAPIKey", back_populates="access_logs"
    )

    # Indexes for common queries
    __table_args__ = (
        Index("idx_access_log_timestamp", "timestamp"),
        Index("idx_access_log_ip", "ip_address"),
        Index("idx_access_log_suspicious", "flagged_suspicious"),
        Index("idx_access_log_org_timestamp", "organization_id", "timestamp"),
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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    config_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("public_portal_config.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Data category (e.g., 'organization', 'events', 'personnel')
    data_category: Mapped[str] = mapped_column(String(50), nullable=False)

    # Specific field name within the category
    field_name: Mapped[str] = mapped_column(String(100), nullable=False)

    # Whether this field is enabled for public access
    is_enabled: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    organization: Mapped["Organization"] = relationship("Organization")
    config: Mapped["PublicPortalConfig"] = relationship(
        "PublicPortalConfig", back_populates="data_whitelist"
    )

    # Unique constraint: one entry per org+category+field combination
    __table_args__ = (
        Index("idx_whitelist_category", "data_category"),
        Index("idx_whitelist_enabled", "is_enabled"),
        Index(
            "idx_whitelist_unique",
            "organization_id",
            "data_category",
            "field_name",
            unique=True,
        ),
    )

    def __repr__(self):
        return f"<PublicPortalDataWhitelist(category={self.data_category}, field={self.field_name}, enabled={self.is_enabled})>"

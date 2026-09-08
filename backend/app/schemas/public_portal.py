"""
Public Portal Pydantic Schemas

Request and response schemas for public portal API endpoints.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.base import UTCResponseBase

# ==============================================================================
# Configuration Schemas
# ==============================================================================


class PublicPortalConfigCreate(BaseModel):
    """Schema for creating public portal configuration"""

    enabled: bool = Field(default=False, description="Enable/disable public portal")
    allowed_origins: List[str] = Field(
        default_factory=list, description="List of allowed CORS origins"
    )
    default_rate_limit: int = Field(
        default=1000,
        ge=1,
        le=100000,
        description="Default rate limit (requests per hour)",
    )
    cache_ttl_seconds: int = Field(
        default=300, ge=0, le=3600, description="Cache TTL in seconds"
    )
    settings: Dict[str, Any] = Field(
        default_factory=dict, description="Additional settings"
    )


class PublicPortalConfigUpdate(BaseModel):
    """Schema for updating public portal configuration"""

    enabled: Optional[bool] = None
    allowed_origins: Optional[List[str]] = None
    default_rate_limit: Optional[int] = Field(None, ge=1, le=100000)
    cache_ttl_seconds: Optional[int] = Field(None, ge=0, le=3600)
    settings: Optional[Dict[str, Any]] = None


class PublicPortalConfigResponse(UTCResponseBase):
    """Schema for public portal configuration response"""

    id: UUID
    organization_id: UUID
    enabled: bool
    allowed_origins: List[str]
    default_rate_limit: int
    cache_ttl_seconds: int
    settings: Dict[str, Any]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ==============================================================================
# API Key Schemas
# ==============================================================================


class PublicPortalAPIKeyCreate(BaseModel):
    """Schema for creating a new API key"""

    name: str = Field(
        ..., min_length=1, max_length=100, description="Friendly name for the API key"
    )
    rate_limit_override: Optional[int] = Field(
        None,
        ge=1,
        le=100000,
        description="Override default rate limit (NULL = use default)",
    )
    expires_at: Optional[datetime] = Field(None, description="Optional expiration date")


class PublicPortalAPIKeyResponse(UTCResponseBase):
    """Schema for API key response (without the actual key)"""

    id: UUID
    organization_id: UUID
    key_prefix: str
    name: str
    rate_limit_override: Optional[int]
    expires_at: Optional[datetime]
    last_used_at: Optional[datetime]
    is_active: bool
    created_by: Optional[UUID]
    created_at: datetime
    is_expired: bool

    model_config = ConfigDict(from_attributes=True)


class PublicPortalAPIKeyCreatedResponse(UTCResponseBase):
    """Schema for newly created API key (includes the actual key once)"""

    id: UUID
    api_key: str = Field(
        ..., description="The actual API key - SAVE THIS! It won't be shown again."
    )
    key_prefix: str
    name: str
    rate_limit_override: Optional[int]
    expires_at: Optional[datetime]
    is_active: bool
    created_at: datetime


class PublicPortalAPIKeyUpdate(BaseModel):
    """Schema for updating an API key"""

    name: Optional[str] = Field(None, min_length=1, max_length=100)
    rate_limit_override: Optional[int] = Field(None, ge=1, le=100000)
    expires_at: Optional[datetime] = None
    is_active: Optional[bool] = None


# ==============================================================================
# Access Log Schemas
# ==============================================================================


class PublicPortalAccessLogResponse(UTCResponseBase):
    """Schema for access log entry response"""

    id: UUID
    organization_id: UUID
    api_key_id: Optional[UUID]
    ip_address: str
    endpoint: str
    method: str
    status_code: int
    response_time_ms: Optional[int]
    user_agent: Optional[str]
    referer: Optional[str]
    timestamp: datetime
    flagged_suspicious: bool
    flag_reason: Optional[str]

    model_config = ConfigDict(from_attributes=True)


# ==============================================================================
# Data Whitelist Schemas
# ==============================================================================


class PublicPortalDataWhitelistCreate(BaseModel):
    """Schema for creating data whitelist entry"""

    data_category: str = Field(..., min_length=1, max_length=50)
    field_name: str = Field(..., min_length=1, max_length=100)
    is_enabled: bool = Field(default=False)


class PublicPortalDataWhitelistUpdate(BaseModel):
    """Schema for updating data whitelist entry"""

    is_enabled: bool


class PublicPortalDataWhitelistResponse(UTCResponseBase):
    """Schema for data whitelist entry response"""

    id: UUID
    organization_id: UUID
    data_category: str
    field_name: str
    is_enabled: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PublicPortalDataWhitelistBulkUpdate(BaseModel):
    """Schema for bulk updating whitelist entries"""

    updates: List[Dict[str, Any]] = Field(
        ..., description="List of {category, field, enabled} objects"
    )


# ==============================================================================
# Usage Statistics Schemas
# ==============================================================================


class PublicPortalUsageStats(BaseModel):
    """Schema for usage statistics"""

    total_requests: int
    requests_today: int
    requests_this_week: int
    requests_this_month: int
    unique_ips: int
    average_response_time_ms: float
    top_endpoints: List[Dict[str, Any]]
    requests_by_status: Dict[int, int]
    flagged_requests: int


# ==============================================================================
# Public API Response Schemas
# ==============================================================================


class PublicOrganizationInfo(BaseModel):
    """Public organization information (sanitized)

    **Every field defaults to ``None``, and that is load-bearing.** The portal
    handler builds the full dictionary and then runs it through
    ``filter_data_by_whitelist``, which keeps only the fields an administrator
    has explicitly enabled — so a field that is not whitelisted is *absent*
    from the dict this model is constructed from. Under Pydantic v2
    ``Optional[str]`` with no default is a **required** field that merely
    accepts ``None``, so the pre-default version raised ``ValidationError`` for
    every configuration that had not whitelisted all nine fields, including the
    default-deny one every deployment starts in (the whitelist table is empty
    until an administrator adds rows; nothing seeds it). The endpoint's own
    ``except Exception`` then answered 500 — the whitelist's default-deny path
    could not return the empty document it is supposed to return.
    ``docs/PUBLIC_API_DOCUMENTATION.md`` already documents this shape: "Only
    whitelisted fields are returned. Some fields may be null if not
    configured."

    The route handler must pass ``response_model_exclude_unset=True``: without
    it, the defaults that make an unwhitelisted field constructible also make
    it round-trip back out as an explicit ``null`` instead of being absent, and
    a partial whitelist would serialize every field it did *not* enable —
    exactly the leak the whitelist exists to prevent. ``exclude_unset`` keys
    off ``model_fields_set``, which holds only the keys the whitelist-filtered
    dict actually passed to the constructor, so an enabled field that happens
    to be empty still serializes as ``null`` (a configured-but-blank value)
    while a disabled one is omitted entirely.
    """

    name: Optional[str] = None
    organization_type: Optional[str] = None
    logo: Optional[str] = None
    description: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    # The address components are individually nullable (``line2`` and
    # ``country`` routinely are), so the value type has to admit ``None`` —
    # ``Dict[str, str]`` rejected the very dictionary the handler builds.
    mailing_address: Optional[Dict[str, Optional[str]]] = None
    physical_address: Optional[Dict[str, Optional[str]]] = None


class PublicOrganizationStats(BaseModel):
    """Public organization statistics

    Defaults to ``None`` for the same reason as
    :class:`PublicOrganizationInfo` — the whitelist removes un-enabled keys
    before this model is constructed. Also requires
    ``response_model_exclude_unset=True`` on its route for the same reason.
    """

    total_volunteer_hours: Optional[int] = None
    total_calls_ytd: Optional[int] = None
    total_members: Optional[int] = None
    stations: Optional[int] = None
    apparatus: Optional[int] = None
    founded_year: Optional[int] = None


class PublicEvent(UTCResponseBase):
    """Public event information"""

    id: UUID
    title: str
    description: Optional[str]
    event_type: str
    start_time: datetime
    end_time: Optional[datetime]
    location: Optional[str]
    is_public: bool


# ==============================================================================
# Error Response Schema
# ==============================================================================

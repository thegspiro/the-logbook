"""
Public Portal Pydantic Schemas

Request and response schemas for public portal API endpoints.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

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


class PublicPortalConfigResponse(BaseModel):
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


class PublicPortalAPIKeyResponse(BaseModel):
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


class PublicPortalAPIKeyCreatedResponse(BaseModel):
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


class PublicPortalAccessLogResponse(BaseModel):
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


class PublicPortalAccessLogFilter(BaseModel):
    """Schema for filtering access logs"""

    api_key_id: Optional[UUID] = None
    ip_address: Optional[str] = None
    endpoint: Optional[str] = None
    status_code: Optional[int] = None
    flagged_suspicious: Optional[bool] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    limit: int = Field(default=100, ge=1, le=1000)
    offset: int = Field(default=0, ge=0)


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


class PublicPortalDataWhitelistResponse(BaseModel):
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
    """Public organization information (sanitized)"""

    name: str
    organization_type: str
    logo: Optional[str]
    description: Optional[str]
    phone: Optional[str]
    email: Optional[str]
    website: Optional[str]
    mailing_address: Optional[Dict[str, str]]
    physical_address: Optional[Dict[str, str]]


class PublicOrganizationStats(BaseModel):
    """Public organization statistics"""

    total_volunteer_hours: Optional[int]
    total_calls_ytd: Optional[int]
    total_members: Optional[int]
    stations: Optional[int]
    apparatus: Optional[int]
    founded_year: Optional[int]


class PublicEvent(BaseModel):
    """Public event information"""

    id: UUID
    title: str
    description: Optional[str]
    event_type: str
    start_time: datetime
    end_time: Optional[datetime]
    location: Optional[str]
    is_public: bool


class PublicPersonnelRoster(BaseModel):
    """Public personnel roster (minimal PII)"""

    name: str
    rank: Optional[str]
    years_of_service: Optional[int]
    certifications: Optional[List[str]]


# ==============================================================================
# Error Response Schema
# ==============================================================================


class PublicPortalErrorResponse(BaseModel):
    """Standard error response for public API"""

    error: str = Field(..., description="Error code")
    message: str = Field(..., description="Human-readable error message")
    details: Optional[Dict[str, Any]] = Field(
        None, description="Additional error details"
    )

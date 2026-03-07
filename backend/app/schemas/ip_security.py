"""
IP Security Pydantic Schemas

Request and response schemas for IP security endpoints:
- IP exception requests and approval workflow
- Blocked access attempts
- Country block rules
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

# Shared config for response schemas
_response_config = ConfigDict(
    from_attributes=True, alias_generator=to_camel, populate_by_name=True
)


# =============================================================================
# IP Exception Schemas
# =============================================================================


class IPExceptionRequestCreate(BaseModel):
    """Schema for creating an IP exception request (user action)."""

    ip_address: str = Field(..., min_length=1, max_length=45)
    reason: str = Field(..., min_length=1)
    requested_duration_days: int = Field(..., ge=1, le=90)
    use_case: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None


class IPExceptionApprove(BaseModel):
    """Schema for approving an IP exception (IT admin action)."""

    approved_duration_days: Optional[int] = Field(None, ge=1, le=90)
    approval_notes: Optional[str] = None


class IPExceptionReject(BaseModel):
    """Schema for rejecting an IP exception (IT admin action)."""

    rejection_reason: str = Field(..., min_length=1)


class IPExceptionRevoke(BaseModel):
    """Schema for revoking an active IP exception (IT admin action)."""

    revoke_reason: str = Field(..., min_length=1)


class IPExceptionResponse(BaseModel):
    """Response schema for an IP exception."""

    model_config = _response_config

    id: str
    ip_address: str
    exception_type: str
    reason: str
    description: Optional[str] = None
    user_id: str
    organization_id: str
    requested_duration_days: int
    valid_from: Optional[datetime] = None
    valid_until: datetime
    approval_status: str
    requested_by: str
    requested_at: Optional[datetime] = None
    approved_by: Optional[str] = None
    approved_at: Optional[datetime] = None
    approval_notes: Optional[str] = None
    approved_duration_days: Optional[int] = None
    rejected_by: Optional[str] = None
    rejected_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None
    revoked_by: Optional[str] = None
    revoked_at: Optional[datetime] = None
    revoke_reason: Optional[str] = None
    country_code: Optional[str] = None
    country_name: Optional[str] = None
    use_case: Optional[str] = None
    last_used_at: Optional[datetime] = None
    use_count: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# =============================================================================
# Blocked Access Attempt Schemas
# =============================================================================


class BlockedAccessAttemptResponse(BaseModel):
    """Response schema for a blocked access attempt."""

    model_config = _response_config

    id: str
    ip_address: str
    country_code: Optional[str] = None
    country_name: Optional[str] = None
    user_id: Optional[str] = None
    block_reason: str
    block_details: Optional[str] = None
    request_path: Optional[str] = None
    request_method: Optional[str] = None
    user_agent: Optional[str] = None
    blocked_at: Optional[datetime] = None


# =============================================================================
# Country Block Rule Schemas
# =============================================================================


class CountryBlockRuleCreate(BaseModel):
    """Schema for adding a blocked country."""

    country_code: str = Field(..., min_length=2, max_length=2)
    country_name: Optional[str] = Field(None, max_length=100)
    reason: str = Field(..., min_length=1)
    risk_level: str = Field("high", pattern=r"^(low|medium|high|critical)$")


class CountryBlockRuleResponse(BaseModel):
    """Response schema for a country block rule."""

    model_config = _response_config

    id: str
    country_code: str
    country_name: Optional[str] = None
    is_blocked: bool
    reason: str
    risk_level: Optional[str] = None
    created_by: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    blocked_attempts_count: Optional[int] = None
    last_blocked_at: Optional[datetime] = None


# =============================================================================
# Audit Log Schemas
# =============================================================================


class IPExceptionAuditLogResponse(BaseModel):
    """Response schema for an IP exception audit log entry."""

    model_config = _response_config

    id: str
    exception_id: str
    action: str
    performed_by: str
    performed_at: Optional[datetime] = None
    details: Optional[str] = None
    ip_address: Optional[str] = None


# =============================================================================
# List Response Wrappers
# =============================================================================


class IPExceptionListResponse(BaseModel):
    """Paginated list of IP exceptions."""

    model_config = _response_config

    items: list[IPExceptionResponse]
    total: int


class BlockedAttemptsListResponse(BaseModel):
    """Paginated list of blocked access attempts."""

    model_config = _response_config

    items: list[BlockedAccessAttemptResponse]
    total: int

"""
Admin Hours Pydantic Schemas

Request and response schemas for admin hours endpoints.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

# Shared camelCase response config
_RESPONSE_CONFIG = ConfigDict(
    from_attributes=True, alias_generator=to_camel, populate_by_name=True
)


# =============================================================================
# Category Schemas
# =============================================================================


class AdminHoursCategoryCreate(BaseModel):
    """Schema for creating a new admin hours category"""

    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    color: Optional[str] = Field(None, max_length=7, pattern=r"^#[0-9A-Fa-f]{6}$")
    require_approval: bool = True
    auto_approve_under_hours: Optional[float] = Field(None, ge=0)
    max_hours_per_session: Optional[float] = Field(12.0, ge=0.5)
    sort_order: int = Field(0, ge=0)


class AdminHoursCategoryUpdate(BaseModel):
    """Schema for updating an admin hours category"""

    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    color: Optional[str] = Field(None, max_length=7, pattern=r"^#[0-9A-Fa-f]{6}$")
    require_approval: Optional[bool] = None
    auto_approve_under_hours: Optional[float] = Field(None, ge=0)
    max_hours_per_session: Optional[float] = Field(None, ge=0.5)
    is_active: Optional[bool] = None
    sort_order: Optional[int] = Field(None, ge=0)


class AdminHoursCategoryResponse(BaseModel):
    """Response schema for admin hours category"""

    model_config = _RESPONSE_CONFIG

    id: str
    organization_id: str
    name: str
    description: Optional[str] = None
    color: Optional[str] = None
    require_approval: bool
    auto_approve_under_hours: Optional[float] = None
    max_hours_per_session: Optional[float] = None
    is_active: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime


# =============================================================================
# Entry Schemas
# =============================================================================


class AdminHoursClockInResponse(BaseModel):
    """Response after clocking in via QR code"""

    model_config = _RESPONSE_CONFIG

    id: str
    category_id: str
    category_name: str
    clock_in_at: datetime
    status: str
    message: str


class AdminHoursClockOutResponse(BaseModel):
    """Response after clocking out"""

    model_config = _RESPONSE_CONFIG

    id: str
    category_id: str
    category_name: str
    clock_in_at: datetime
    clock_out_at: datetime
    duration_minutes: int
    status: str
    message: str


class AdminHoursEntryCreate(BaseModel):
    """Schema for manual admin hours entry"""

    category_id: str
    clock_in_at: datetime
    clock_out_at: datetime
    description: Optional[str] = None


class AdminHoursEntryResponse(BaseModel):
    """Full response schema for an admin hours entry"""

    model_config = _RESPONSE_CONFIG

    id: str
    organization_id: str
    user_id: str
    category_id: str
    clock_in_at: datetime
    clock_out_at: Optional[datetime] = None
    duration_minutes: Optional[int] = None
    description: Optional[str] = None
    entry_method: str
    status: str
    approved_by: Optional[str] = None
    approved_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    # Joined fields
    category_name: Optional[str] = None
    category_color: Optional[str] = None
    user_name: Optional[str] = None


class AdminHoursActiveSession(BaseModel):
    """Response for the user's currently active session"""

    model_config = _RESPONSE_CONFIG

    id: str
    category_id: str
    category_name: str
    category_color: Optional[str] = None
    clock_in_at: datetime
    elapsed_minutes: int


class AdminHoursApprovalAction(BaseModel):
    """Schema for approving or rejecting an entry"""

    action: str = Field(..., pattern=r"^(approve|reject)$")
    rejection_reason: Optional[str] = None


class AdminHoursSummary(BaseModel):
    """Summary of hours for reporting"""

    model_config = _RESPONSE_CONFIG

    total_hours: float
    total_entries: int
    by_category: list[dict]
    period_start: Optional[datetime] = None
    period_end: Optional[datetime] = None


class AdminHoursQRData(BaseModel):
    """Data returned for QR code display page"""

    model_config = _RESPONSE_CONFIG

    category_id: str
    category_name: str
    category_description: Optional[str] = None
    category_color: Optional[str] = None
    organization_name: Optional[str] = None

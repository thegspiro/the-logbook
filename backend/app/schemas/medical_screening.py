"""
Medical Screening Pydantic Schemas

Request and response schemas for the medical screening endpoints.
"""

from datetime import date, datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.base import UTCResponseBase

# --- Screening Requirement Schemas ---


class ScreeningRequirementBase(BaseModel):
    """Base schema for a screening requirement."""

    name: str = Field(..., min_length=1, max_length=255)
    screening_type: str = Field(
        ...,
        description="Type: physical_exam, medical_clearance, drug_screening, "
        "vision_hearing, fitness_assessment, psychological",
    )
    description: Optional[str] = None
    frequency_months: Optional[int] = Field(
        None, description="Recurrence in months. NULL = one-time."
    )
    applies_to_roles: Optional[List[str]] = Field(
        None, description="Role names this requirement applies to."
    )
    is_active: bool = True
    grace_period_days: int = Field(
        default=30, ge=0, description="Days past due before non-compliant."
    )


class ScreeningRequirementCreate(ScreeningRequirementBase):
    """Schema for creating a screening requirement."""

    pass


class ScreeningRequirementUpdate(BaseModel):
    """Schema for updating a screening requirement."""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    screening_type: Optional[str] = None
    description: Optional[str] = None
    frequency_months: Optional[int] = None
    applies_to_roles: Optional[List[str]] = None
    is_active: Optional[bool] = None
    grace_period_days: Optional[int] = Field(None, ge=0)


class ScreeningRequirementResponse(ScreeningRequirementBase, UTCResponseBase):
    """Response schema for a screening requirement."""

    id: str
    organization_id: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# --- Screening Record Schemas ---


class ScreeningRecordBase(BaseModel):
    """Base schema for a screening record."""

    screening_type: str
    status: str = Field(
        default="scheduled",
        description="Status: scheduled, completed, passed, failed, "
        "pending_review, waived, expired",
    )
    scheduled_date: Optional[date] = None
    completed_date: Optional[date] = None
    expiration_date: Optional[date] = None
    provider_name: Optional[str] = Field(None, max_length=255)
    result_summary: Optional[str] = None
    result_data: Optional[Dict[str, Any]] = None
    notes: Optional[str] = None


class ScreeningRecordCreate(ScreeningRecordBase):
    """Schema for creating a screening record."""

    requirement_id: Optional[str] = None
    user_id: Optional[str] = None
    prospect_id: Optional[str] = None


class ScreeningRecordUpdate(BaseModel):
    """Schema for updating a screening record."""

    screening_type: Optional[str] = None
    status: Optional[str] = None
    scheduled_date: Optional[date] = None
    completed_date: Optional[date] = None
    expiration_date: Optional[date] = None
    provider_name: Optional[str] = Field(None, max_length=255)
    result_summary: Optional[str] = None
    result_data: Optional[Dict[str, Any]] = None
    notes: Optional[str] = None


class ScreeningRecordResponse(ScreeningRecordBase, UTCResponseBase):
    """Response schema for a screening record."""

    id: str
    organization_id: str
    requirement_id: Optional[str] = None
    user_id: Optional[str] = None
    prospect_id: Optional[str] = None
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    user_name: Optional[str] = None
    prospect_name: Optional[str] = None
    reviewer_name: Optional[str] = None
    requirement_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# --- Compliance Schemas ---


class ComplianceItem(BaseModel):
    """Compliance status for a single screening requirement."""

    requirement_id: str
    requirement_name: str
    screening_type: str
    is_compliant: bool
    last_screening_date: Optional[date] = None
    expiration_date: Optional[date] = None
    days_until_expiration: Optional[int] = None
    status: Optional[str] = None


class ComplianceSummary(BaseModel):
    """Overall compliance summary for a user or prospect."""

    subject_id: str
    subject_name: str
    subject_type: str = Field(description="'user' or 'prospect'")
    total_requirements: int
    compliant_count: int
    non_compliant_count: int
    expiring_soon_count: int
    is_fully_compliant: bool
    items: List[ComplianceItem]


class ExpiringScreening(BaseModel):
    """A screening record that is expiring soon."""

    record_id: str
    screening_type: str
    requirement_name: Optional[str] = None
    user_id: Optional[str] = None
    user_name: Optional[str] = None
    prospect_id: Optional[str] = None
    prospect_name: Optional[str] = None
    expiration_date: date
    days_until_expiration: int

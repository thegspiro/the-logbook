"""
Compliance Requirements Configuration Schemas

Pydantic request/response schemas for compliance config endpoints.
"""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.schemas.base import UTCResponseBase


# =============================================================================
# Compliance Profile Schemas
# =============================================================================


class ComplianceProfileBase(BaseModel):
    """Shared fields for compliance profiles."""

    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    membership_types: Optional[List[str]] = None
    role_ids: Optional[List[str]] = None
    compliant_threshold_override: Optional[float] = Field(
        None, ge=0, le=100,
    )
    at_risk_threshold_override: Optional[float] = Field(
        None, ge=0, le=100,
    )
    required_requirement_ids: Optional[List[str]] = None
    optional_requirement_ids: Optional[List[str]] = None
    is_active: bool = True
    priority: int = 0


class ComplianceProfileCreate(ComplianceProfileBase):
    """Schema for creating a compliance profile."""

    pass


class ComplianceProfileUpdate(BaseModel):
    """Schema for updating a compliance profile."""

    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    membership_types: Optional[List[str]] = None
    role_ids: Optional[List[str]] = None
    compliant_threshold_override: Optional[float] = Field(
        None, ge=0, le=100,
    )
    at_risk_threshold_override: Optional[float] = Field(
        None, ge=0, le=100,
    )
    required_requirement_ids: Optional[List[str]] = None
    optional_requirement_ids: Optional[List[str]] = None
    is_active: Optional[bool] = None
    priority: Optional[int] = None


class ComplianceProfileResponse(ComplianceProfileBase):
    """Response schema for compliance profile."""

    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=to_camel,
        populate_by_name=True,
    )

    id: str
    config_id: str
    created_at: datetime
    updated_at: datetime


# =============================================================================
# Compliance Config Schemas
# =============================================================================


class ComplianceConfigBase(BaseModel):
    """Shared fields for compliance config."""

    threshold_type: str = Field(
        "percentage",
        description="percentage or all_required",
    )
    compliant_threshold: float = Field(100.0, ge=0, le=100)
    at_risk_threshold: float = Field(75.0, ge=0, le=100)
    grace_period_days: int = Field(0, ge=0, le=365)
    auto_report_frequency: str = Field(
        "none",
        description="none, monthly, quarterly, or yearly",
    )
    report_email_recipients: Optional[List[str]] = None
    report_day_of_month: Optional[int] = Field(1, ge=1, le=28)
    notify_non_compliant_members: bool = False
    notify_days_before_deadline: Optional[List[int]] = None


class ComplianceConfigCreate(ComplianceConfigBase):
    """Schema for creating compliance config (initial setup)."""

    pass


class ComplianceConfigUpdate(BaseModel):
    """Schema for updating compliance config."""

    threshold_type: Optional[str] = None
    compliant_threshold: Optional[float] = Field(None, ge=0, le=100)
    at_risk_threshold: Optional[float] = Field(None, ge=0, le=100)
    grace_period_days: Optional[int] = Field(None, ge=0, le=365)
    auto_report_frequency: Optional[str] = None
    report_email_recipients: Optional[List[str]] = None
    report_day_of_month: Optional[int] = Field(None, ge=1, le=28)
    notify_non_compliant_members: Optional[bool] = None
    notify_days_before_deadline: Optional[List[int]] = None


class ComplianceConfigResponse(ComplianceConfigBase):
    """Response schema for compliance config."""

    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=to_camel,
        populate_by_name=True,
    )

    id: str
    organization_id: str
    profiles: List[ComplianceProfileResponse] = []
    created_at: datetime
    updated_at: datetime
    updated_by: Optional[str] = None


# =============================================================================
# Report Schemas
# =============================================================================


class ComplianceReportGenerate(BaseModel):
    """Request schema for generating a report."""

    report_type: str = Field(
        ..., description="monthly or yearly",
    )
    year: int = Field(..., ge=2020, le=2100)
    month: Optional[int] = Field(None, ge=1, le=12)
    send_email: bool = Field(
        False, description="Email the report to configured recipients",
    )
    additional_recipients: Optional[List[str]] = None


class ComplianceReportSummary(UTCResponseBase):
    """Summary response for a stored report."""

    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=to_camel,
        populate_by_name=True,
    )

    id: str
    organization_id: str
    report_type: str
    period_label: str
    period_year: int
    period_month: Optional[int] = None
    status: str
    summary: Optional[dict] = None
    emailed_to: Optional[List[str]] = None
    emailed_at: Optional[datetime] = None
    generated_by: Optional[str] = None
    generated_at: datetime
    generation_duration_ms: Optional[int] = None
    error_message: Optional[str] = None


class ComplianceReportDetail(ComplianceReportSummary):
    """Full report detail including report data."""

    report_data: Optional[dict] = None

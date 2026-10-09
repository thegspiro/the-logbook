"""
Medical Screening Pydantic Schemas

Request and response schemas for the medical screening endpoints.
"""

from datetime import date, datetime
from typing import Any, Dict, List, Optional, overload

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.medical_screening import ScreeningStatus, ScreeningType
from app.schemas.base import UTCResponseBase

_SCREENING_TYPES = {e.value for e in ScreeningType}
_SCREENING_STATUSES = {e.value for e in ScreeningStatus}


@overload
def _validate_enum(value: str, valid: set[str], field: str) -> str:
    """A string in, the normalized string out."""


@overload
def _validate_enum(value: Optional[str], valid: set[str], field: str) -> Optional[str]:
    """An optional value in: None passes through unchanged."""


def _validate_enum(value: Optional[str], valid: set[str], field: str) -> Optional[str]:
    """Reject request values the DB's ENUM column can't store.

    ``screening_type``/``status`` map to strict MySQL ENUM columns, but the
    request schemas type them as free strings. Without this check an out-of-enum
    value passes Pydantic, reaches MySQL, and fails there with a truncation error
    that surfaces as a 500 (the endpoints only convert ``ValueError`` to 400).
    Normalizing to lowercase first also absorbs the casing mismatch called out in
    the schema-contract pitfall. ``None``/unset is left for the field's own
    optionality to handle.
    """
    if value is None:
        return value
    normalized = value.lower() if isinstance(value, str) else value
    if normalized not in valid:
        raise ValueError(
            f"Invalid {field} '{value}'. Must be one of: {', '.join(sorted(valid))}"
        )
    return normalized


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

    @field_validator("screening_type")
    @classmethod
    def _valid_screening_type(cls, v: str) -> str:
        return _validate_enum(v, _SCREENING_TYPES, "screening_type")


class ScreeningRequirementUpdate(BaseModel):
    """Schema for updating a screening requirement."""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    screening_type: Optional[str] = None
    description: Optional[str] = None
    frequency_months: Optional[int] = None
    applies_to_roles: Optional[List[str]] = None
    is_active: Optional[bool] = None
    grace_period_days: Optional[int] = Field(None, ge=0)

    @field_validator("screening_type")
    @classmethod
    def _valid_screening_type(cls, v: Optional[str]) -> Optional[str]:
        return _validate_enum(v, _SCREENING_TYPES, "screening_type")


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

    @field_validator("screening_type")
    @classmethod
    def _valid_screening_type(cls, v: str) -> str:
        return _validate_enum(v, _SCREENING_TYPES, "screening_type")

    @field_validator("status")
    @classmethod
    def _valid_status(cls, v: str) -> str:
        return _validate_enum(v, _SCREENING_STATUSES, "status")

    @model_validator(mode="after")
    def _exactly_one_subject(self) -> "ScreeningRecordCreate":
        """A record belongs to one member or one prospect — never neither, never
        both (MS-13, owner decision 2026-10-05).

        Compliance resolves records by ``user_id`` or ``prospect_id``, so a
        record with neither counts toward nobody: a physical that was really
        performed and recorded still left the member reading as uncleared. A
        record with both would count twice, under two identities. The update
        schema accepts neither field, so this is the only place it can be set.
        """
        if bool(self.user_id) == bool(self.prospect_id):
            raise ValueError(
                "A screening record must be for exactly one member (user_id) "
                "or one prospect (prospect_id)."
            )
        return self


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

    @field_validator("screening_type")
    @classmethod
    def _valid_screening_type(cls, v: Optional[str]) -> Optional[str]:
        return _validate_enum(v, _SCREENING_TYPES, "screening_type")

    @field_validator("status")
    @classmethod
    def _valid_status(cls, v: Optional[str]) -> Optional[str]:
        return _validate_enum(v, _SCREENING_STATUSES, "status")


class ScreeningRecordResponse(ScreeningRecordBase, UTCResponseBase):
    """Response schema for a screening record."""

    id: str
    organization_id: str
    requirement_id: Optional[str] = None
    user_id: Optional[str] = None
    prospect_id: Optional[str] = None
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    self_recorded: bool = Field(
        default=False,
        description="The record's status was last set by the member it is about.",
    )
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
    self_recorded: bool = Field(
        default=False,
        description="The record this item is graded on was recorded by its own "
        "subject (MS-7). It still counts; it is shown so it is not trusted "
        "silently.",
    )


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
    self_recorded_count: int = Field(
        default=0,
        description="Compliant items whose record the subject recorded themself.",
    )
    items: List[ComplianceItem]


class MyComplianceSummary(BaseModel):
    """The caller's own screening compliance, reduced to counts.

    Deliberately carries no requirement names, screening types, dates or
    statuses — only how many are outstanding and how soon the next one lapses.

    This is what the dashboard reads, and the dashboard is a shared surface:
    The Logbook is installed as a kiosk on tablets left at stations, so a line
    reading "Psychological evaluation expired" is legible to whoever walks past.
    Counts answer "am I clear tonight" without disclosing which screening or
    what it found. The member sees the detail on their own screening page,
    which they open deliberately.
    """

    total_requirements: int
    compliant_count: int
    non_compliant_count: int
    expiring_soon_count: int
    is_fully_compliant: bool
    days_until_next_expiration: Optional[int] = Field(
        default=None,
        description=(
            "Days until the soonest still-valid screening lapses, or None when "
            "nothing is due. Negative values are never returned — an already "
            "lapsed screening is counted in non_compliant_count instead."
        ),
    )


class ScreeningSubject(BaseModel):
    """Someone a screening record can be filed against."""

    id: str
    name: str


class ScreeningSubjects(BaseModel):
    """The members and prospects the Add Record dialog offers.

    Names and ids only — nothing about anyone's screenings.
    """

    members: List[ScreeningSubject]
    prospects: List[ScreeningSubject]


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
    self_recorded: bool = False

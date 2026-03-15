"""
Training Session Pydantic Schemas

Request and response schemas for training session endpoints.
"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.schemas.base import stamp_naive_datetimes_utc


class TrainingSessionCreate(BaseModel):
    """Schema for creating a training session (creates Event + TrainingSession)"""

    # Event details
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    location_id: Optional[UUID] = Field(
        None, description="Location ID for double-booking prevention"
    )
    location: Optional[str] = Field(None, max_length=300)
    location_details: Optional[str] = None
    start_datetime: datetime
    end_datetime: datetime

    # RSVP settings
    requires_rsvp: bool = Field(default=True)
    rsvp_deadline: Optional[datetime] = None
    max_attendees: Optional[int] = Field(default=None, ge=1)
    is_mandatory: bool = Field(default=False)

    # Check-in settings
    check_in_window_type: str = Field(
        default="flexible", description="flexible, strict, or window"
    )
    check_in_minutes_before: int = Field(default=15)
    check_in_minutes_after: int = Field(default=15)
    require_checkout: bool = Field(
        default=True,
        description="Require manual check-out for accurate duration tracking",
    )

    # Training course details
    use_existing_course: bool = Field(default=False)
    course_id: Optional[UUID] = None  # If using existing course

    # Category and program linkage
    category_id: Optional[UUID] = Field(
        None,
        description="Training category this session falls under (Fire, EMS, Hazmat, etc.)",
    )
    program_id: Optional[UUID] = Field(
        None,
        description="Training program this session is part of (e.g., Recruit School, Driver Training)",
    )
    phase_id: Optional[UUID] = Field(
        None, description="Specific program phase (e.g., Phase 2 of Recruit School)"
    )
    requirement_id: Optional[UUID] = Field(
        None, description="Specific requirement this session satisfies"
    )

    # New course details (if not using existing)
    course_name: Optional[str] = Field(None, max_length=255)
    course_code: Optional[str] = Field(None, max_length=50)
    training_type: str = Field(
        ...,
        description="certification, continuing_education, skills_practice, orientation, refresher, specialty",
    )
    credit_hours: float = Field(..., ge=0)
    instructor: Optional[str] = Field(None, max_length=255)

    # Certification details
    issues_certification: bool = Field(default=False)
    certification_number_prefix: Optional[str] = Field(None, max_length=50)
    issuing_agency: Optional[str] = Field(None, max_length=255)
    expiration_months: Optional[int] = Field(None, ge=1)

    # Auto-completion settings
    auto_create_records: bool = Field(
        default=True, description="Auto-create training records on check-in"
    )
    require_completion_confirmation: bool = Field(
        default=False, description="Require instructor confirmation"
    )

    # Approval settings
    approval_required: bool = Field(default=True)
    approval_deadline_days: int = Field(default=7, ge=1, le=30)


class RecurringTrainingSessionCreate(TrainingSessionCreate):
    """Schema for creating a recurring training session series"""

    # Recurrence settings
    recurrence_pattern: str = Field(
        ...,
        description=(
            "daily, weekly, biweekly, monthly, monthly_weekday, "
            "annually, annually_weekday, custom"
        ),
    )
    recurrence_end_date: datetime = Field(
        ..., description="When the recurring series ends"
    )
    recurrence_custom_days: Optional[List[int]] = Field(
        None, description="For custom pattern: weekday numbers (0=Mon, 6=Sun)"
    )
    recurrence_weekday: Optional[int] = Field(
        None,
        ge=0,
        le=6,
        description="For monthly_weekday/annually_weekday: weekday (0=Mon, 6=Sun)",
    )
    recurrence_week_ordinal: Optional[int] = Field(
        None,
        description="Which occurrence: 1=first, 2=second, ..., 5=fifth, -1=last",
    )
    recurrence_month: Optional[int] = Field(
        None,
        ge=1,
        le=12,
        description="For annually_weekday: target month (1=Jan, 12=Dec)",
    )
    recurrence_exceptions: Optional[List[str]] = Field(
        None,
        description="ISO date strings (YYYY-MM-DD) of dates to skip",
    )

    @model_validator(mode="after")
    def validate_recurrence_fields(self) -> "RecurringTrainingSessionCreate":
        pattern = self.recurrence_pattern
        if pattern == "custom" and not self.recurrence_custom_days:
            raise ValueError(
                "recurrence_custom_days is required for custom pattern"
            )
        if pattern in ("monthly_weekday", "annually_weekday"):
            if self.recurrence_weekday is None:
                raise ValueError(
                    f"recurrence_weekday is required for {pattern} pattern"
                )
            if self.recurrence_week_ordinal is None:
                raise ValueError(
                    f"recurrence_week_ordinal is required for {pattern} pattern"
                )
        if pattern == "annually_weekday" and self.recurrence_month is None:
            raise ValueError(
                "recurrence_month is required for annually_weekday pattern"
            )
        return self


class TrainingSessionResponse(BaseModel):
    """Schema for training session response"""

    id: UUID
    organization_id: UUID
    event_id: UUID
    course_id: Optional[UUID]

    # Category and program linkage
    category_id: Optional[UUID] = None
    program_id: Optional[UUID] = None
    phase_id: Optional[UUID] = None
    requirement_id: Optional[UUID] = None

    course_name: str
    course_code: Optional[str]
    training_type: str
    credit_hours: float
    instructor: Optional[str]

    issues_certification: bool
    certification_number_prefix: Optional[str]
    issuing_agency: Optional[str]
    expiration_months: Optional[int]

    auto_create_records: bool
    require_completion_confirmation: bool
    approval_required: bool
    approval_deadline_days: int

    is_finalized: bool
    finalized_at: Optional[datetime]
    finalized_by: Optional[UUID]

    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID]

    class Config:
        from_attributes = True

    @model_validator(mode="after")
    def ensure_utc(self) -> "TrainingSessionResponse":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


class AttendeeApprovalData(BaseModel):
    """Schema for individual attendee approval data"""

    user_id: UUID
    user_name: str
    user_email: str

    # Original times
    checked_in_at: datetime
    checked_out_at: Optional[datetime]
    calculated_duration_minutes: Optional[int]

    # Override times (for adjustments)
    override_check_in_at: Optional[datetime] = None
    override_check_out_at: Optional[datetime] = None
    override_duration_minutes: Optional[int] = None

    # Status
    approved: bool = False
    notes: Optional[str] = None


class TrainingApprovalRequest(BaseModel):
    """Schema for submitting training approval"""

    attendees: list[AttendeeApprovalData]
    approval_notes: Optional[str] = None


class TrainingApprovalResponse(BaseModel):
    """Schema for training approval response"""

    id: UUID
    training_session_id: UUID
    event_id: UUID
    status: str
    approval_deadline: datetime

    # Event details
    event_title: str
    event_start_datetime: datetime
    event_end_datetime: datetime
    course_name: str
    credit_hours: float

    # Attendee data
    attendees: list[AttendeeApprovalData]

    approved_by: Optional[UUID]
    approved_at: Optional[datetime]
    approval_notes: Optional[str]

    created_at: datetime

    class Config:
        from_attributes = True

    @model_validator(mode="after")
    def ensure_utc(self) -> "TrainingApprovalResponse":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]

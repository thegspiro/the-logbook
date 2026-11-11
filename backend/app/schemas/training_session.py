"""
Training Session Pydantic Schemas

Request and response schemas for training session endpoints.
"""

from datetime import datetime
from typing import Annotated, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.training import TrainingType as ModelTrainingType
from app.schemas.base import UTCResponseBase, as_utc
from app.schemas.column_bounds import FLOAT32_MAX, INT32_MAX, INT32_MIN
from app.schemas.enum_validation import validate_enum_value


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
    max_attendees: Optional[int] = Field(default=None, ge=1, le=INT32_MAX)
    is_mandatory: bool = Field(default=False)

    # Check-in settings
    check_in_window_type: str = Field(
        default="flexible", description="flexible, strict, or window"
    )
    check_in_minutes_before: int = Field(default=15, ge=INT32_MIN, le=INT32_MAX)
    check_in_minutes_after: int = Field(default=15, ge=INT32_MIN, le=INT32_MAX)
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
    attendance_requirement_ids: Optional[List[UUID]] = Field(
        None,
        max_length=50,
        description=(
            "Session-attendance requirements this session counts toward; "
            "members they grade are charged with attending it"
        ),
    )

    # New course details (if not using existing). With neither a course nor a
    # name, the session is filed under the event's title, as a Training event
    # created from Events is.
    course_name: Optional[str] = Field(None, max_length=255)
    course_code: Optional[str] = Field(None, max_length=50)
    training_type: str = Field(
        default=ModelTrainingType.CONTINUING_EDUCATION.value,
        description=(
            "certification, continuing_education, skills_practice, orientation, "
            "refresher, specialty, policy_acknowledgment"
        ),
    )
    credit_hours: Optional[float] = Field(
        None,
        ge=0,
        le=FLOAT32_MAX,
        description="Hours credited; empty means the scheduled length",
    )
    instructor: Optional[str] = Field(None, max_length=255)
    instructor_id: Optional[UUID] = Field(
        None, description="Member teaching this session (enables qualification checks)"
    )

    @field_validator("start_datetime", "end_datetime", "rsvp_deadline")
    @classmethod
    def _normalize_utc(cls, v: Optional[datetime]) -> Optional[datetime]:
        return as_utc(v)

    @field_validator("training_type")
    @classmethod
    def _validate_training_type(cls, v: str) -> str:
        return validate_enum_value(v, ModelTrainingType, "training_type")

    # Certification details
    issues_certification: bool = Field(default=False)
    certification_number_prefix: Optional[str] = Field(None, max_length=50)
    issuing_agency: Optional[str] = Field(None, max_length=255)
    expiration_months: Optional[int] = Field(None, ge=1, le=INT32_MAX)

    # When False, attendance still credits the member but the session does not
    # advance the linked pipeline/certificate requirements (hours a certifying
    # body wouldn't accept stay off the member's certificate).
    counts_toward_certification: bool = Field(
        default=True,
        description="Whether this session's hours advance linked certificate requirements",
    )

    # Auto-completion settings
    auto_create_records: bool = Field(
        default=True, description="Auto-create training records on check-in"
    )
    require_completion_confirmation: bool = Field(
        default=False, description="Require instructor confirmation"
    )

    # Approval settings
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
    recurrence_custom_days: Optional[List[Annotated[int, Field(ge=0, le=6)]]] = Field(
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
        ge=INT32_MIN,
        le=INT32_MAX,
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

    @field_validator("recurrence_end_date")
    @classmethod
    def _normalize_recurrence_end_utc(cls, v: datetime) -> datetime:
        return as_utc(v)

    @model_validator(mode="after")
    def validate_recurrence_fields(self) -> "RecurringTrainingSessionCreate":
        pattern = self.recurrence_pattern
        if pattern == "custom" and not self.recurrence_custom_days:
            raise ValueError("recurrence_custom_days is required for custom pattern")
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


class TrainingSessionLinkageUpdate(BaseModel):
    """Partial update for a session's requirement/program linkage.

    Three-state contract (see CLAUDE.md pitfall #1): a field omitted from the
    payload is left untouched, an explicit null clears the link, a value sets
    it. The service applies this via ``model_dump(exclude_unset=True)`` +
    ``apply_updates``.

    ``course_id`` also re-files the session: setting it takes the course's name
    and code, clearing it files the session under the event's title again.
    ``training_type`` cannot be cleared — every record needs one.
    """

    category_id: Optional[UUID] = None
    program_id: Optional[UUID] = None
    phase_id: Optional[UUID] = None
    requirement_id: Optional[UUID] = None
    course_id: Optional[UUID] = None
    training_type: Optional[str] = None

    @field_validator("training_type")
    @classmethod
    def _validate_training_type(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        return validate_enum_value(v, ModelTrainingType, "training_type")


class TrainingSessionAttendanceRequirements(BaseModel):
    """The full set of attendance requirements a session counts toward.

    A replacement, not a patch: an empty list unlinks every one.
    """

    requirement_ids: List[UUID] = Field(default_factory=list, max_length=50)


class TrainingSessionAttach(BaseModel):
    """The training details a Training event is created with.

    Sent with ``POST /events`` and ``POST /events/recurring`` (one session per
    occurrence), or to attach details to an existing Training event. They
    become the event's training session, which files its attendance credit
    under a course and category, feeds a program requirement, and decides
    which session-attendance requirements the event counts toward.

    Every field is optional. With no course and no one-off name the session is
    filed under the event's title; with no type it is Continuing Education;
    with no hours it credits the scheduled length, the same as a Training
    event with no details at all.

    Unknown keys are refused rather than dropped: a client sending a field
    this schema does not carry would otherwise get a 201 and lose it.
    """

    model_config = ConfigDict(extra="forbid")

    course_id: Optional[UUID] = None
    # A one-off course name, not added to the Course Library.
    course_name: Optional[str] = Field(None, max_length=255)
    course_code: Optional[str] = Field(None, max_length=50)
    category_id: Optional[UUID] = None
    program_id: Optional[UUID] = None
    phase_id: Optional[UUID] = None
    requirement_id: Optional[UUID] = None
    training_type: Optional[str] = None
    credit_hours: Optional[float] = Field(None, ge=0, le=FLOAT32_MAX)
    instructor: Optional[str] = Field(None, max_length=255)
    instructor_id: Optional[UUID] = None

    issues_certification: bool = False
    certification_number_prefix: Optional[str] = Field(None, max_length=50)
    issuing_agency: Optional[str] = Field(None, max_length=255)
    expiration_months: Optional[int] = Field(None, ge=1, le=INT32_MAX)

    counts_toward_certification: bool = True
    auto_create_records: bool = True
    require_completion_confirmation: bool = False
    approval_deadline_days: int = Field(default=7, ge=1, le=30)

    attendance_requirement_ids: Optional[List[UUID]] = Field(
        None,
        max_length=50,
        description=(
            "Session-attendance requirements this session counts toward; "
            "members they grade are charged with attending it"
        ),
    )

    @field_validator("training_type")
    @classmethod
    def _validate_training_type(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        return validate_enum_value(v, ModelTrainingType, "training_type")

    @model_validator(mode="after")
    def _one_course_source(self) -> "TrainingSessionAttach":
        if self.course_id is not None and (self.course_name or self.course_code):
            raise ValueError(
                "Pick a course from the library or name a one-off course, not both"
            )
        return self


class TrainingSessionResponse(UTCResponseBase):
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
    attendance_requirement_ids: List[str] = Field(default_factory=list)

    course_name: str
    course_code: Optional[str]
    training_type: str
    credit_hours: float
    instructor: Optional[str]
    instructor_id: Optional[UUID] = None
    # User ids, per the column's own documentation. Declared List[Any]
    # before, which promised the frontend (string[]) nothing.
    co_instructors: Optional[List[str]] = None
    apparatus_id: Optional[UUID] = None

    issues_certification: bool
    certification_number_prefix: Optional[str]
    issuing_agency: Optional[str]
    expiration_months: Optional[int]

    counts_toward_certification: bool = True
    auto_create_records: bool
    require_completion_confirmation: bool
    approval_deadline_days: int

    is_finalized: bool
    finalized_at: Optional[datetime]
    finalized_by: Optional[UUID]

    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID]

    model_config = ConfigDict(from_attributes=True)


class AttendeeApprovalData(UTCResponseBase):
    """Schema for individual attendee approval data"""

    user_id: UUID
    user_name: str
    user_email: str

    # Original times
    checked_in_at: datetime
    checked_out_at: Optional[datetime]
    calculated_duration_minutes: Optional[int] = Field(..., ge=INT32_MIN, le=INT32_MAX)

    # Override times (for adjustments)
    override_check_in_at: Optional[datetime] = None
    override_check_out_at: Optional[datetime] = None
    override_duration_minutes: Optional[int] = Field(None, ge=INT32_MIN, le=INT32_MAX)

    # Status
    approved: bool = False
    notes: Optional[str] = None


class TrainingApprovalSummary(UTCResponseBase):
    """Where an event's training approval stands, for the event page.

    ``token`` is the approval link's secret and is included only while the
    approval is pending and unexpired, and only for a caller who may approve
    (training.manage) — the event page links them straight to the review.
    """

    approval_id: UUID
    status: str
    approval_deadline: datetime
    approved_at: Optional[datetime] = None
    attendee_count: int
    expired: bool
    token: Optional[str] = None


class TrainingApprovalRequest(BaseModel):
    """Schema for submitting training approval"""

    attendees: list[AttendeeApprovalData]
    approval_notes: Optional[str] = None


class TrainingApprovalResponse(UTCResponseBase):
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

    model_config = ConfigDict(from_attributes=True)

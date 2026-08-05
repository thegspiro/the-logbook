"""
Course Syllabus & Cohort Pydantic Schemas

Schemas for multi-class courses: the syllabus (``CourseClass``) that describes a
course's classes and their relative timing, and the cohort (``CourseCohort``)
that materializes that syllabus onto real dates as Events + TrainingSessions.

Field naming is snake_case to match the rest of the training module's schemas
(``training.py``, ``training_program.py``, ``training_session.py``), which do not
use the camelCase alias generator.
"""

from datetime import date, datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.training import CohortClassStatus as ModelCohortClassStatus
from app.models.training import CohortMemberStatus as ModelCohortMemberStatus
from app.models.training import CohortStatus as ModelCohortStatus
from app.models.training import DateRollPolicy as ModelDateRollPolicy
from app.schemas.base import UTCResponseBase
from app.schemas.enum_validation import validate_enum_value

_response_config = ConfigDict(from_attributes=True)

# A syllabus this long is a data-entry mistake, not a course. The cap bounds the
# generation transaction (one Event + one TrainingSession per class).
MAX_CLASSES_PER_COURSE = 200


def _validate_hhmm(value: Optional[str]) -> Optional[str]:
    """Accept ``"HH:MM"`` 24-hour wall-clock strings (or nothing)."""
    if value is None or value == "":
        return None
    parts = value.split(":")
    if len(parts) != 2:
        raise ValueError("start_time must be in HH:MM format")
    try:
        hour, minute = int(parts[0]), int(parts[1])
    except ValueError:
        raise ValueError("start_time must be in HH:MM format")
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise ValueError("start_time must be a valid 24-hour time")
    return f"{hour:02d}:{minute:02d}"


# ── Course Class (syllabus row) ──────────────────────────────────────


class CourseClassBase(BaseModel):
    """Shared fields for a syllabus row"""

    class_course_id: UUID = Field(
        ..., description="Catalog course taught in this class (required)"
    )
    section_name: Optional[str] = Field(None, max_length=255)
    title: Optional[str] = Field(
        None, max_length=255, description="Display override; defaults to course name"
    )
    description: Optional[str] = None
    day_offset: int = Field(0, ge=0, description="Days from the cohort start date")
    start_time: Optional[str] = Field(
        None, description="Local wall-clock start time, HH:MM"
    )
    duration_minutes: int = Field(60, ge=1, le=1440)
    credit_hours: Optional[float] = Field(None, ge=0)
    instructor_id: Optional[UUID] = None
    instructor: Optional[str] = Field(None, max_length=255)
    location_id: Optional[UUID] = None
    location: Optional[str] = Field(None, max_length=300)
    category_id: Optional[UUID] = None
    requirement_id: Optional[UUID] = None
    phase_id: Optional[UUID] = None
    is_required: bool = True
    counts_toward_certification: bool = True

    @field_validator("start_time")
    @classmethod
    def _check_start_time(cls, v: Optional[str]) -> Optional[str]:
        return _validate_hhmm(v)


class CourseClassCreate(CourseClassBase):
    """Add a class to a course syllabus"""

    sequence: Optional[int] = Field(
        None, ge=1, description="Position in the syllabus; appended when omitted"
    )


class CourseClassUpdate(BaseModel):
    """Patch a syllabus row — every field optional"""

    class_course_id: Optional[UUID] = None
    section_name: Optional[str] = Field(None, max_length=255)
    title: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    day_offset: Optional[int] = Field(None, ge=0)
    start_time: Optional[str] = None
    duration_minutes: Optional[int] = Field(None, ge=1, le=1440)
    credit_hours: Optional[float] = Field(None, ge=0)
    instructor_id: Optional[UUID] = None
    instructor: Optional[str] = Field(None, max_length=255)
    location_id: Optional[UUID] = None
    location: Optional[str] = Field(None, max_length=300)
    category_id: Optional[UUID] = None
    requirement_id: Optional[UUID] = None
    phase_id: Optional[UUID] = None
    is_required: Optional[bool] = None
    counts_toward_certification: Optional[bool] = None
    active: Optional[bool] = None

    @field_validator("start_time")
    @classmethod
    def _check_start_time(cls, v: Optional[str]) -> Optional[str]:
        return _validate_hhmm(v)


class CourseClassResponse(CourseClassBase, UTCResponseBase):
    """A syllabus row, with the linked catalog course resolved for display"""

    model_config = _response_config

    id: UUID
    organization_id: UUID
    course_id: UUID
    sequence: int
    active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None
    created_by: Optional[UUID] = None

    # Resolved from the linked catalog course so the syllabus list needs no
    # follow-up requests per row.
    class_course_name: Optional[str] = None
    class_course_code: Optional[str] = None
    class_course_active: Optional[bool] = None


class CourseClassReorder(BaseModel):
    """New ordering for a course's syllabus — every class id, in order"""

    class_ids: List[UUID] = Field(..., min_length=1)


class CourseClassAutofill(BaseModel):
    """Recompute every class's day_offset from a weekly meeting pattern"""

    meeting_days: List[int] = Field(
        ..., min_length=1, description="Weekday numbers, 0=Monday"
    )
    start_weekday: int = Field(
        0, ge=0, le=6, description="Weekday the course starts on"
    )
    default_start_time: Optional[str] = None
    default_duration_minutes: Optional[int] = Field(None, ge=1, le=1440)

    @field_validator("meeting_days")
    @classmethod
    def _check_days(cls, v: List[int]) -> List[int]:
        if any(d < 0 or d > 6 for d in v):
            raise ValueError("meeting_days entries must be between 0 (Mon) and 6 (Sun)")
        return sorted(set(v))

    @field_validator("default_start_time")
    @classmethod
    def _check_start_time(cls, v: Optional[str]) -> Optional[str]:
        return _validate_hhmm(v)


# ── Schedule preview ─────────────────────────────────────────────────


class CohortScheduleConfig(BaseModel):
    """Schedule knobs shared by the preview request and cohort creation"""

    meeting_days: Optional[List[int]] = None
    default_start_time: Optional[str] = None
    default_duration_minutes: Optional[int] = Field(None, ge=1, le=1440)
    date_roll_policy: str = Field(
        "none", description="none, next_business_day, or next_meeting_day"
    )
    blackout_dates: Optional[List[str]] = Field(
        None, description="ISO dates the schedule must skip"
    )

    @field_validator("date_roll_policy")
    @classmethod
    def _check_policy(cls, v: str) -> str:
        return validate_enum_value(v, ModelDateRollPolicy, "date_roll_policy")

    @field_validator("default_start_time")
    @classmethod
    def _check_start_time(cls, v: Optional[str]) -> Optional[str]:
        return _validate_hhmm(v)

    @field_validator("meeting_days")
    @classmethod
    def _check_days(cls, v: Optional[List[int]]) -> Optional[List[int]]:
        if v is None:
            return None
        if any(d < 0 or d > 6 for d in v):
            raise ValueError("meeting_days entries must be between 0 (Mon) and 6 (Sun)")
        return sorted(set(v))


class CohortSchedulePreviewRequest(CohortScheduleConfig):
    """Compute the dates a cohort *would* get, without creating anything"""

    course_id: UUID
    start_date: date


class PreviewClass(UTCResponseBase):
    """One computed class in a schedule preview"""

    model_config = _response_config

    course_class_id: UUID
    sequence: int
    title: str
    class_course_name: Optional[str] = None
    section_name: Optional[str] = None
    scheduled_start: datetime
    scheduled_end: datetime
    credit_hours: Optional[float] = None
    instructor: Optional[str] = None
    warnings: List[str] = Field(default_factory=list)


class CohortSchedulePreviewResponse(BaseModel):
    """The full computed schedule, plus anything the officer should see first"""

    course_id: UUID
    course_name: str
    start_date: date
    timezone: str
    classes: List[PreviewClass]
    suggested_blackout_dates: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


# ── Cohort ───────────────────────────────────────────────────────────


class CohortClassOverride(BaseModel):
    """An officer's edit to one previewed class before generation"""

    course_class_id: UUID
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None
    instructor_id: Optional[UUID] = None
    location_id: Optional[UUID] = None
    skip: bool = False

    @model_validator(mode="after")
    def _check_range(self) -> "CohortClassOverride":
        if (
            self.scheduled_start
            and self.scheduled_end
            and self.scheduled_end <= self.scheduled_start
        ):
            raise ValueError("scheduled_end must be after scheduled_start")
        return self


class CourseCohortBase(CohortScheduleConfig):
    """Shared cohort fields"""

    name: str = Field(..., min_length=1, max_length=255)
    code: Optional[str] = Field(None, max_length=50)
    description: Optional[str] = None
    location_id: Optional[UUID] = None
    location: Optional[str] = Field(None, max_length=300)
    requires_rsvp: bool = True
    auto_create_records: bool = True
    notes: Optional[str] = None


class CourseCohortCreate(CourseCohortBase):
    """Generate a cohort: dated classes, optional pipeline, and a roster"""

    course_id: UUID
    start_date: date
    program_id: Optional[UUID] = Field(
        None, description="Existing pipeline to enrol the roster in"
    )
    generate_program: bool = Field(
        False,
        description="Build a matching pipeline from the syllabus when none is linked",
    )
    classes: Optional[List[CohortClassOverride]] = Field(
        None, description="Per-class edits from the preview step"
    )
    member_user_ids: Optional[List[UUID]] = None


class CourseCohortUpdate(BaseModel):
    """Patch cohort metadata. Rescheduling goes through the class endpoints."""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    code: Optional[str] = Field(None, max_length=50)
    description: Optional[str] = None
    status: Optional[str] = None
    location_id: Optional[UUID] = None
    location: Optional[str] = Field(None, max_length=300)
    notes: Optional[str] = None
    blackout_dates: Optional[List[str]] = None

    @field_validator("status")
    @classmethod
    def _check_status(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        return validate_enum_value(v, ModelCohortStatus, "status")


class CourseCohortClassResponse(UTCResponseBase):
    """A materialized class, with its live event/attendance state"""

    model_config = _response_config

    id: UUID
    organization_id: UUID
    cohort_id: UUID
    course_class_id: Optional[UUID] = None
    sequence: int
    title: str
    description: Optional[str] = None
    scheduled_start: datetime
    scheduled_end: datetime
    event_id: Optional[UUID] = None
    training_session_id: Optional[UUID] = None
    status: str
    class_course_id: Optional[UUID] = None
    credit_hours: Optional[float] = None
    instructor_id: Optional[UUID] = None
    instructor: Optional[str] = None
    location_id: Optional[UUID] = None
    location: Optional[str] = None
    category_id: Optional[UUID] = None
    requirement_id: Optional[UUID] = None
    phase_id: Optional[UUID] = None
    cancellation_reason: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    # Resolved for the cohort timeline view
    class_course_name: Optional[str] = None
    rsvp_count: Optional[int] = None
    checked_in_count: Optional[int] = None


class CourseCohortMemberResponse(UTCResponseBase):
    """One roster entry"""

    model_config = _response_config

    id: UUID
    organization_id: UUID
    cohort_id: UUID
    user_id: UUID
    enrollment_id: Optional[UUID] = None
    status: str
    notes: Optional[str] = None
    withdrawn_at: Optional[datetime] = None
    added_at: Optional[datetime] = None

    # Resolved so the roster renders names, not UUIDs
    full_name: Optional[str] = None
    email: Optional[str] = None
    progress_percentage: Optional[float] = None


class CourseCohortResponse(UTCResponseBase):
    """Cohort summary — the list view"""

    model_config = _response_config

    id: UUID
    organization_id: UUID
    course_id: UUID
    name: str
    code: Optional[str] = None
    description: Optional[str] = None
    start_date: date
    status: str
    program_id: Optional[UUID] = None
    meeting_days: Optional[List[int]] = None
    default_start_time: Optional[str] = None
    default_duration_minutes: Optional[int] = None
    date_roll_policy: str
    blackout_dates: Optional[List[str]] = None
    location_id: Optional[UUID] = None
    location: Optional[str] = None
    requires_rsvp: bool
    auto_create_records: bool
    generated_at: Optional[datetime] = None
    generated_by: Optional[UUID] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    created_by: Optional[UUID] = None

    course_name: Optional[str] = None
    program_name: Optional[str] = None
    class_count: int = 0
    member_count: int = 0
    end_date: Optional[date] = None


class CourseCohortDetailResponse(CourseCohortResponse):
    """Cohort with its full class timeline and roster"""

    classes: List[CourseCohortClassResponse] = Field(default_factory=list)
    members: List[CourseCohortMemberResponse] = Field(default_factory=list)


# ── Cohort management ────────────────────────────────────────────────


class CohortClassReschedule(BaseModel):
    """Move one class; the linked event moves with it"""

    scheduled_start: datetime
    scheduled_end: datetime
    instructor_id: Optional[UUID] = None
    location_id: Optional[UUID] = None

    @model_validator(mode="after")
    def _check_range(self) -> "CohortClassReschedule":
        if self.scheduled_end <= self.scheduled_start:
            raise ValueError("scheduled_end must be after scheduled_start")
        return self


class CohortClassCancel(BaseModel):
    """Cancel one class — the event is cancelled, never deleted"""

    reason: str = Field(..., min_length=1, max_length=500)


class CohortAdHocClassCreate(BaseModel):
    """Add a class that was never on the syllabus (make-up sessions, add-ons)"""

    title: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    class_course_id: UUID
    scheduled_start: datetime
    scheduled_end: datetime
    credit_hours: Optional[float] = Field(None, ge=0)
    instructor_id: Optional[UUID] = None
    instructor: Optional[str] = Field(None, max_length=255)
    location_id: Optional[UUID] = None
    location: Optional[str] = Field(None, max_length=300)
    category_id: Optional[UUID] = None
    requirement_id: Optional[UUID] = None
    phase_id: Optional[UUID] = None
    invite_roster: bool = True

    @model_validator(mode="after")
    def _check_range(self) -> "CohortAdHocClassCreate":
        if self.scheduled_end <= self.scheduled_start:
            raise ValueError("scheduled_end must be after scheduled_start")
        return self


class CohortShiftRequest(BaseModel):
    """Shift upcoming classes by N days (weather, instructor illness, …)"""

    days: int = Field(..., description="Positive to delay, negative to pull forward")
    from_sequence: Optional[int] = Field(
        None, ge=1, description="Only shift classes at or after this position"
    )

    @field_validator("days")
    @classmethod
    def _check_days(cls, v: int) -> int:
        if v == 0:
            raise ValueError("days must not be zero")
        if abs(v) > 365:
            raise ValueError("days must be within one year")
        return v


class CohortMemberAdd(BaseModel):
    """Add members to the roster (and, by default, to the pipeline)"""

    user_ids: List[UUID] = Field(..., min_length=1, max_length=200)
    enroll_in_program: bool = True
    invite_to_events: bool = True


class CohortOperationResult(BaseModel):
    """Outcome of a bulk cohort operation"""

    success_count: int = 0
    errors: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class CohortMemberStatusUpdate(BaseModel):
    """Change a roster member's status"""

    status: str

    @field_validator("status")
    @classmethod
    def _check_status(cls, v: str) -> str:
        return validate_enum_value(v, ModelCohortMemberStatus, "status")


class CohortClassStatusUpdate(BaseModel):
    """Change a scheduled class's status"""

    status: str

    @field_validator("status")
    @classmethod
    def _check_status(cls, v: str) -> str:
        return validate_enum_value(v, ModelCohortClassStatus, "status")

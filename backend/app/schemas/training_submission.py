"""
Training Submission Pydantic Schemas

Request and response schemas for self-reported training submissions
and self-report configuration.
"""

from datetime import date, datetime, time
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.training import TrainingType as ModelTrainingType
from app.schemas.base import UTCResponseBase
from app.schemas.column_bounds import FLOAT32_MAX
from app.schemas.enum_validation import validate_enum_value

# ==================== Self-Report Config Schemas ====================

# Bounds on SelfReportConfig.attachment_retention_days. The frontend's
# self-report settings editor mirrors the floor.
ATTACHMENT_RETENTION_MIN_DAYS = 90
ATTACHMENT_RETENTION_MAX_DAYS = 36500


class FieldConfig(BaseModel):
    """Configuration for a single form field"""

    visible: bool = True
    required: bool = False
    label: str = ""


class SelfReportConfigResponse(UTCResponseBase):
    """Response schema for self-report configuration"""

    id: UUID
    organization_id: UUID

    require_approval: bool
    auto_approve_under_hours: Optional[float] = None
    approval_deadline_days: int

    notify_officer_on_submit: bool
    notify_member_on_decision: bool

    field_config: dict  # { field_name: { visible, required, label } }

    allowed_training_types: Optional[list[str]] = None
    max_hours_per_submission: Optional[float] = None
    member_instructions: Optional[str] = None
    attachment_retention_days: Optional[int] = None

    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SelfReportConfigUpdate(BaseModel):
    """Schema for updating self-report configuration"""

    require_approval: Optional[bool] = None
    auto_approve_under_hours: Optional[float] = Field(
        None, ge=-FLOAT32_MAX, le=FLOAT32_MAX
    )
    approval_deadline_days: Optional[int] = Field(None, ge=1, le=90)

    notify_officer_on_submit: Optional[bool] = None
    notify_member_on_decision: Optional[bool] = None

    field_config: Optional[dict] = None

    allowed_training_types: Optional[list[str]] = None
    max_hours_per_submission: Optional[float] = Field(None, ge=0.5, le=FLOAT32_MAX)
    member_instructions: Optional[str] = None
    # null clears it (keep indefinitely). The floor is there so a mistyped
    # value cannot destroy the evidence behind a training approved last week.
    attachment_retention_days: Optional[int] = Field(
        None,
        ge=ATTACHMENT_RETENTION_MIN_DAYS,
        le=ATTACHMENT_RETENTION_MAX_DAYS,
    )


# ==================== Training Submission Schemas ====================


class TrainingSubmissionCreate(BaseModel):
    """Schema for submitting self-reported training"""

    course_name: str = Field(..., min_length=1, max_length=255)
    course_code: Optional[str] = Field(None, max_length=50)
    training_type: str = Field(
        ...,
        description=(
            "certification, continuing_education, skills_practice, orientation, "
            "refresher, specialty, policy_acknowledgment"
        ),
    )
    description: Optional[str] = None

    completion_date: date
    # Time of day the training started. The form derives hours from this plus a
    # length; keeping it means an edit does not have to invent one.
    start_time: Optional[time] = None
    hours_completed: float = Field(..., gt=0, le=FLOAT32_MAX)
    credit_hours: Optional[float] = Field(None, ge=0, le=FLOAT32_MAX)

    instructor: Optional[str] = Field(None, max_length=255)
    location: Optional[str] = Field(None, max_length=255)

    certification_number: Optional[str] = Field(None, max_length=100)
    issuing_agency: Optional[str] = Field(None, max_length=255)
    expiration_date: Optional[date] = None

    category_id: Optional[UUID] = None
    attachments: Optional[list[str]] = None

    # A draft is parked in the member's own list and never reaches the review
    # queue until POST /{id}/submit promotes it.
    save_as_draft: bool = False
    # The device picks one before its first attempt and repeats it on every
    # resend, so a submission sent twice is stored once; see
    # TrainingSubmissionService.create_submission.
    client_request_id: Optional[str] = Field(
        None, min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$"
    )

    @field_validator("training_type")
    @classmethod
    def _validate_training_type(cls, v: str) -> str:
        return validate_enum_value(v, ModelTrainingType, "training_type")

    @field_validator("completion_date")
    @classmethod
    def _validate_completion_date(cls, v: date) -> date:
        # Self-report is for COMPLETED training, so the completion date cannot be
        # in the future. Allow a 1-day grace so a member in a timezone ahead of
        # the server isn't rejected for logging today's training.
        from datetime import timedelta

        if v > date.today() + timedelta(days=1):
            raise ValueError("completion_date cannot be in the future")
        return v


class TrainingSubmissionUpdate(BaseModel):
    """Schema for updating a submission (before approval)"""

    course_name: Optional[str] = Field(None, min_length=1, max_length=255)
    course_code: Optional[str] = Field(None, max_length=50)
    training_type: Optional[str] = None
    description: Optional[str] = None

    completion_date: Optional[date] = None
    start_time: Optional[time] = None
    hours_completed: Optional[float] = Field(None, gt=0, le=FLOAT32_MAX)
    credit_hours: Optional[float] = Field(None, ge=0, le=FLOAT32_MAX)

    instructor: Optional[str] = Field(None, max_length=255)
    location: Optional[str] = Field(None, max_length=255)

    certification_number: Optional[str] = Field(None, max_length=100)
    issuing_agency: Optional[str] = Field(None, max_length=255)
    expiration_date: Optional[date] = None

    category_id: Optional[UUID] = None
    attachments: Optional[list[str]] = None

    @field_validator("training_type")
    @classmethod
    def _validate_training_type(cls, v: Optional[str]) -> Optional[str]:
        return validate_enum_value(v, ModelTrainingType, "training_type")


class SubmissionAttachment(BaseModel):
    """Client-safe view of one stored attachment.

    The stored dict also carries the server file path; it is deliberately not
    declared here so it can never reach a client through the response model.
    """

    index: int
    file_name: Optional[str] = None
    file_type: Optional[str] = None
    file_size: Optional[int] = None
    uploaded_at: Optional[str] = None


def sanitize_attachments(attachments: Optional[list]) -> list[dict]:
    """Strip server file paths, exposing only client-safe metadata + index.

    Entries predating the upload endpoint are bare strings (the column was
    typed ``list[str]``); they carry a name and nothing else.
    """
    result: list[dict] = []
    for i, a in enumerate(attachments or []):
        if isinstance(a, dict):
            result.append(
                {
                    "index": i,
                    "file_name": a.get("file_name"),
                    "file_type": a.get("file_type"),
                    "file_size": a.get("file_size"),
                    "uploaded_at": a.get("uploaded_at"),
                }
            )
        else:
            result.append({"index": i, "file_name": str(a)})
    return result


class TrainingSubmissionResponse(UTCResponseBase):
    """Response schema for a training submission"""

    id: UUID
    organization_id: UUID
    submitted_by: UUID
    # Resolved by the service as a transient attribute; the model has no
    # relationship to User, and the review queue needs a name, not an id.
    submitter_name: Optional[str] = None

    course_name: str
    course_code: Optional[str]
    training_type: str
    description: Optional[str]

    completion_date: date
    start_time: Optional[time] = None
    hours_completed: float
    credit_hours: Optional[float]

    instructor: Optional[str]
    location: Optional[str]

    certification_number: Optional[str]
    issuing_agency: Optional[str]
    expiration_date: Optional[date]

    category_id: Optional[UUID]
    attachments: Optional[list[SubmissionAttachment]] = None

    status: str
    reviewed_by: Optional[UUID]
    reviewed_at: Optional[datetime]
    reviewer_notes: Optional[str]
    training_record_id: Optional[UUID]

    # Set only on a crew-recorded entry: the officer who filed it on the
    # member's behalf, the batch it was filed in, and the shift it ran on.
    recorded_by: Optional[UUID] = None
    recorder_name: Optional[str] = None
    crew_batch_id: Optional[UUID] = None
    shift_id: Optional[UUID] = None

    submitted_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @field_validator("attachments", mode="before")
    @classmethod
    def _strip_file_paths(cls, v: Optional[list]) -> Optional[list[dict]]:
        if v is None:
            return None
        return sanitize_attachments(v)


class SubmissionReviewRequest(BaseModel):
    """Schema for officer reviewing a submission"""

    action: str = Field(..., description="approve, reject, or revision_requested")
    reviewer_notes: Optional[str] = None

    # Optional overrides (officer can adjust hours, etc.)
    override_hours: Optional[float] = Field(None, gt=0, le=FLOAT32_MAX)
    override_credit_hours: Optional[float] = Field(None, ge=0, le=FLOAT32_MAX)
    override_training_type: Optional[str] = None

    # Optionally apply the approved training toward a pipeline requirement
    # (e.g. crediting a make-up session). Both must be set together.
    apply_to_program_id: Optional[UUID] = None
    apply_to_requirement_id: Optional[UUID] = None

    @field_validator("override_training_type")
    @classmethod
    def _validate_override_training_type(cls, v: Optional[str]) -> Optional[str]:
        return validate_enum_value(v, ModelTrainingType, "training_type")


# ==================== Crew-Recorded Training ====================

# A drill is recorded for the crew on hand, not the whole department. The cap
# keeps one request from writing an unbounded number of rows.
CREW_MAX_MEMBERS = 100


class CrewTrainingCreate(BaseModel):
    """A drill recorded by a shift officer for every member present.

    Files one pending submission per member; none is credited until the
    training officer approves it.
    """

    course_name: str = Field(..., min_length=1, max_length=255)
    course_code: Optional[str] = Field(None, max_length=50)
    training_type: str
    description: Optional[str] = Field(None, max_length=5000)

    completion_date: date
    start_time: Optional[time] = None
    hours_completed: float = Field(..., gt=0, le=FLOAT32_MAX)

    instructor: Optional[str] = Field(None, max_length=255)
    location: Optional[str] = Field(None, max_length=255)

    category_id: Optional[UUID] = None
    shift_id: Optional[UUID] = None

    member_ids: list[UUID] = Field(..., min_length=1, max_length=CREW_MAX_MEMBERS)

    @field_validator("training_type")
    @classmethod
    def _validate_training_type(cls, v: str) -> str:
        return validate_enum_value(v, ModelTrainingType, "training_type")

    @field_validator("completion_date")
    @classmethod
    def _validate_completion_date(cls, v: date) -> date:
        # Same rule and grace as a self-report: this records training that
        # has already happened.
        from datetime import timedelta

        if v > date.today() + timedelta(days=1):
            raise ValueError("completion_date cannot be in the future")
        return v

    @field_validator("member_ids")
    @classmethod
    def _dedupe_members(cls, v: list[UUID]) -> list[UUID]:
        return list(dict.fromkeys(v))


class CrewTrainingResult(BaseModel):
    """What a crew recording filed."""

    crew_batch_id: UUID
    submissions: list[TrainingSubmissionResponse]


class CrewMemberOption(BaseModel):
    id: UUID
    name: str


class CrewRecordingContext(BaseModel):
    """Whether the caller may record crew training, and whom they can pick."""

    can_record: bool
    members: list[CrewMemberOption] = []


class CrewShiftOption(BaseModel):
    """A shift on the chosen day, offered to pre-fill who was present."""

    id: UUID
    start_time: datetime
    end_time: Optional[datetime] = None
    platoon: Optional[str] = None
    shift_officer_name: Optional[str] = None
    member_ids: list[UUID]


class CrewBatchApproveRequest(BaseModel):
    reviewer_notes: Optional[str] = Field(None, max_length=5000)


class CrewBatchSkipped(BaseModel):
    submission_id: UUID
    member_name: Optional[str] = None
    reason: str


class CrewBatchApproveResult(BaseModel):
    approved: int
    skipped: list[CrewBatchSkipped]

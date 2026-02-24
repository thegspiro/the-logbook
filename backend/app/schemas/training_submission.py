"""
Training Submission Pydantic Schemas

Request and response schemas for self-reported training submissions
and self-report configuration.
"""

from datetime import date, datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field

# ==================== Self-Report Config Schemas ====================


class FieldConfig(BaseModel):
    """Configuration for a single form field"""

    visible: bool = True
    required: bool = False
    label: str = ""


class SelfReportConfigResponse(BaseModel):
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

    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class SelfReportConfigUpdate(BaseModel):
    """Schema for updating self-report configuration"""

    require_approval: Optional[bool] = None
    auto_approve_under_hours: Optional[float] = None
    approval_deadline_days: Optional[int] = Field(None, ge=1, le=90)

    notify_officer_on_submit: Optional[bool] = None
    notify_member_on_decision: Optional[bool] = None

    field_config: Optional[dict] = None

    allowed_training_types: Optional[list[str]] = None
    max_hours_per_submission: Optional[float] = Field(None, ge=0.5)
    member_instructions: Optional[str] = None


# ==================== Training Submission Schemas ====================


class TrainingSubmissionCreate(BaseModel):
    """Schema for submitting self-reported training"""

    course_name: str = Field(..., min_length=1, max_length=255)
    course_code: Optional[str] = Field(None, max_length=50)
    training_type: str = Field(
        ...,
        description="certification, continuing_education, skills_practice, orientation, refresher, specialty",
    )
    description: Optional[str] = None

    completion_date: date
    hours_completed: float = Field(..., gt=0)
    credit_hours: Optional[float] = Field(None, ge=0)

    instructor: Optional[str] = Field(None, max_length=255)
    location: Optional[str] = Field(None, max_length=255)

    certification_number: Optional[str] = Field(None, max_length=100)
    issuing_agency: Optional[str] = Field(None, max_length=255)
    expiration_date: Optional[date] = None

    category_id: Optional[UUID] = None
    attachments: Optional[list[str]] = None


class TrainingSubmissionUpdate(BaseModel):
    """Schema for updating a submission (before approval)"""

    course_name: Optional[str] = Field(None, min_length=1, max_length=255)
    course_code: Optional[str] = Field(None, max_length=50)
    training_type: Optional[str] = None
    description: Optional[str] = None

    completion_date: Optional[date] = None
    hours_completed: Optional[float] = Field(None, gt=0)
    credit_hours: Optional[float] = Field(None, ge=0)

    instructor: Optional[str] = Field(None, max_length=255)
    location: Optional[str] = Field(None, max_length=255)

    certification_number: Optional[str] = Field(None, max_length=100)
    issuing_agency: Optional[str] = Field(None, max_length=255)
    expiration_date: Optional[date] = None

    category_id: Optional[UUID] = None
    attachments: Optional[list[str]] = None


class TrainingSubmissionResponse(BaseModel):
    """Response schema for a training submission"""

    id: UUID
    organization_id: UUID
    submitted_by: UUID

    course_name: str
    course_code: Optional[str]
    training_type: str
    description: Optional[str]

    completion_date: date
    hours_completed: float
    credit_hours: Optional[float]

    instructor: Optional[str]
    location: Optional[str]

    certification_number: Optional[str]
    issuing_agency: Optional[str]
    expiration_date: Optional[date]

    category_id: Optional[UUID]
    attachments: Optional[list[str]]

    status: str
    reviewed_by: Optional[UUID]
    reviewed_at: Optional[datetime]
    reviewer_notes: Optional[str]
    training_record_id: Optional[UUID]

    submitted_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class SubmissionReviewRequest(BaseModel):
    """Schema for officer reviewing a submission"""

    action: str = Field(..., description="approve, reject, or revision_requested")
    reviewer_notes: Optional[str] = None

    # Optional overrides (officer can adjust hours, etc.)
    override_hours: Optional[float] = Field(None, gt=0)
    override_credit_hours: Optional[float] = Field(None, ge=0)
    override_training_type: Optional[str] = None

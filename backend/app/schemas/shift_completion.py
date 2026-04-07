"""
Shift Completion Report Schemas

Pydantic models for shift officer reports on trainee experiences.
"""

from datetime import date, datetime
from typing import Dict, List, Optional

from pydantic import BaseModel, Field, field_validator

from app.schemas.base import UTCResponseBase


class SkillObservation(BaseModel):
    skill_name: str
    demonstrated: bool = False
    score: Optional[int] = Field(None, ge=1, le=5)
    notes: Optional[str] = None
    comment: Optional[str] = None


class TaskPerformed(BaseModel):
    task: str
    description: Optional[str] = None
    comment: Optional[str] = None  # Officer comment on this specific task


class RequirementProgressEntry(BaseModel):
    requirement_progress_id: str
    value_added: float


class ShiftCompletionReportCreate(BaseModel):
    shift_id: Optional[str] = None
    shift_date: date
    trainee_id: str
    hours_on_shift: float = Field(gt=0, le=48)
    calls_responded: int = Field(ge=0, default=0)
    call_types: Optional[List[str]] = Field(None, max_length=50)

    performance_rating: Optional[int] = Field(None, ge=1, le=5)
    areas_of_strength: Optional[str] = None
    areas_for_improvement: Optional[str] = None
    officer_narrative: Optional[str] = None

    skills_observed: Optional[List[SkillObservation]] = Field(None, max_length=100)
    tasks_performed: Optional[List[TaskPerformed]] = Field(None, max_length=100)

    enrollment_id: Optional[str] = None
    save_as_draft: bool = False

    @field_validator("shift_date")
    @classmethod
    def shift_date_not_future(cls, v: date) -> date:
        if v > date.today():
            raise ValueError("Shift date cannot be in the future")
        return v


class ShiftCompletionReportUpdate(BaseModel):
    hours_on_shift: Optional[float] = Field(None, gt=0, le=48)
    calls_responded: Optional[int] = Field(None, ge=0)
    call_types: Optional[List[str]] = Field(None, max_length=50)
    performance_rating: Optional[int] = Field(None, ge=1, le=5)
    areas_of_strength: Optional[str] = None
    areas_for_improvement: Optional[str] = None
    officer_narrative: Optional[str] = None
    skills_observed: Optional[List[SkillObservation]] = None
    tasks_performed: Optional[List[TaskPerformed]] = None
    review_status: Optional[str] = None


class TraineeAcknowledgment(BaseModel):
    trainee_comments: Optional[str] = None


class ReportReview(BaseModel):
    review_status: str  # approved, flagged
    reviewer_notes: Optional[str] = None
    redact_fields: Optional[List[str]] = None


class BatchReviewRequest(BaseModel):
    report_ids: List[str] = Field(..., min_length=1, max_length=100)
    review_status: str  # approved, flagged
    reviewer_notes: Optional[str] = None


class ShiftCompletionReportResponse(UTCResponseBase):
    id: str
    organization_id: str
    shift_id: Optional[str] = None
    shift_date: date
    trainee_id: str
    officer_id: str
    trainee_name: Optional[str] = None
    officer_name: Optional[str] = None

    hours_on_shift: float
    calls_responded: int
    call_types: Optional[List[str]] = None

    performance_rating: Optional[int] = None
    areas_of_strength: Optional[str] = None
    areas_for_improvement: Optional[str] = None
    officer_narrative: Optional[str] = None

    skills_observed: Optional[List[SkillObservation]] = None
    tasks_performed: Optional[List[TaskPerformed]] = None

    data_sources: Optional[Dict[str, str]] = None

    enrollment_id: Optional[str] = None
    requirements_progressed: Optional[List[RequirementProgressEntry]] = None

    # Review workflow
    review_status: str = "approved"
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    reviewer_notes: Optional[str] = None

    trainee_acknowledged: bool = False
    trainee_acknowledged_at: Optional[datetime] = None
    trainee_comments: Optional[str] = None

    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

"""
Shift Completion Report Schemas

Pydantic models for shift officer reports on trainee experiences.
"""

from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import date, datetime


class SkillObservation(BaseModel):
    skill_name: str
    demonstrated: bool = False
    notes: Optional[str] = None


class TaskPerformed(BaseModel):
    task: str
    description: Optional[str] = None


class RequirementProgressEntry(BaseModel):
    requirement_progress_id: str
    value_added: float


class ShiftCompletionReportCreate(BaseModel):
    shift_id: Optional[str] = None
    shift_date: date
    trainee_id: str
    hours_on_shift: float = Field(gt=0, le=48)
    calls_responded: int = Field(ge=0, default=0)
    call_types: Optional[List[str]] = None

    performance_rating: Optional[int] = Field(None, ge=1, le=5)
    areas_of_strength: Optional[str] = None
    areas_for_improvement: Optional[str] = None
    officer_narrative: Optional[str] = None

    skills_observed: Optional[List[SkillObservation]] = None
    tasks_performed: Optional[List[TaskPerformed]] = None

    enrollment_id: Optional[str] = None


class ShiftCompletionReportUpdate(BaseModel):
    performance_rating: Optional[int] = Field(None, ge=1, le=5)
    areas_of_strength: Optional[str] = None
    areas_for_improvement: Optional[str] = None
    officer_narrative: Optional[str] = None
    skills_observed: Optional[List[SkillObservation]] = None
    tasks_performed: Optional[List[TaskPerformed]] = None


class TraineeAcknowledgment(BaseModel):
    trainee_comments: Optional[str] = None


class ShiftCompletionReportResponse(BaseModel):
    id: str
    organization_id: str
    shift_id: Optional[str] = None
    shift_date: date
    trainee_id: str
    officer_id: str

    hours_on_shift: float
    calls_responded: int
    call_types: Optional[List[str]] = None

    performance_rating: Optional[int] = None
    areas_of_strength: Optional[str] = None
    areas_for_improvement: Optional[str] = None
    officer_narrative: Optional[str] = None

    skills_observed: Optional[List[SkillObservation]] = None
    tasks_performed: Optional[List[TaskPerformed]] = None

    enrollment_id: Optional[str] = None
    requirements_progressed: Optional[List[RequirementProgressEntry]] = None

    trainee_acknowledged: bool = False
    trainee_acknowledged_at: Optional[datetime] = None
    trainee_comments: Optional[str] = None

    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

"""
Training Pydantic Schemas

Request and response schemas for training-related endpoints.
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List
from datetime import datetime, date
from uuid import UUID
from enum import Enum


class DueDateType(str, Enum):
    """How the due date for a requirement is calculated"""
    CALENDAR_PERIOD = "calendar_period"  # Due by end of calendar period (e.g., Dec 31st)
    ROLLING = "rolling"  # Due X months from last completion
    CERTIFICATION_PERIOD = "certification_period"  # Due when certification expires
    FIXED_DATE = "fixed_date"  # Due by a specific fixed date


# Training Category Schemas

class TrainingCategoryBase(BaseModel):
    """Base training category schema"""
    name: str = Field(..., min_length=1, max_length=255)
    code: Optional[str] = Field(None, max_length=50)
    description: Optional[str] = None
    color: Optional[str] = Field(None, max_length=7, pattern=r'^#[0-9A-Fa-f]{6}$')
    parent_category_id: Optional[UUID] = None
    sort_order: int = 0
    icon: Optional[str] = Field(None, max_length=50)


class TrainingCategoryCreate(TrainingCategoryBase):
    """Schema for creating a new training category"""
    pass


class TrainingCategoryUpdate(BaseModel):
    """Schema for updating a training category"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    code: Optional[str] = Field(None, max_length=50)
    description: Optional[str] = None
    color: Optional[str] = Field(None, max_length=7, pattern=r'^#[0-9A-Fa-f]{6}$')
    parent_category_id: Optional[UUID] = None
    sort_order: Optional[int] = None
    icon: Optional[str] = Field(None, max_length=50)
    active: Optional[bool] = None


class TrainingCategoryResponse(TrainingCategoryBase):
    """Schema for training category response"""
    id: UUID
    organization_id: UUID
    active: bool
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None

    model_config = ConfigDict(from_attributes=True)


# Training Course Schemas

class TrainingCourseBase(BaseModel):
    """Base training course schema"""
    name: str = Field(..., min_length=1, max_length=255)
    code: Optional[str] = Field(None, max_length=50)
    description: Optional[str] = None
    training_type: str
    duration_hours: Optional[float] = Field(None, ge=0)
    credit_hours: Optional[float] = Field(None, ge=0)
    prerequisites: Optional[List[UUID]] = None
    expiration_months: Optional[int] = Field(None, ge=0)
    instructor: Optional[str] = Field(None, max_length=255)
    max_participants: Optional[int] = Field(None, ge=1)
    materials_required: Optional[List[str]] = None
    category_ids: Optional[List[UUID]] = None  # Categories this course belongs to


class TrainingCourseCreate(TrainingCourseBase):
    """Schema for creating a new training course"""
    pass


class TrainingCourseUpdate(BaseModel):
    """Schema for updating a training course"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    code: Optional[str] = Field(None, max_length=50)
    description: Optional[str] = None
    training_type: Optional[str] = None
    duration_hours: Optional[float] = Field(None, ge=0)
    credit_hours: Optional[float] = Field(None, ge=0)
    prerequisites: Optional[List[UUID]] = None
    expiration_months: Optional[int] = Field(None, ge=0)
    instructor: Optional[str] = Field(None, max_length=255)
    max_participants: Optional[int] = Field(None, ge=1)
    materials_required: Optional[List[str]] = None
    category_ids: Optional[List[UUID]] = None
    active: Optional[bool] = None


class TrainingCourseResponse(TrainingCourseBase):
    """Schema for training course response"""
    id: UUID
    organization_id: UUID
    active: bool
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None
    # Note: category_ids is inherited from TrainingCourseBase

    model_config = ConfigDict(from_attributes=True)


# Training Record Schemas

class TrainingRecordBase(BaseModel):
    """Base training record schema"""
    course_name: str = Field(..., min_length=1, max_length=255)
    course_code: Optional[str] = Field(None, max_length=50)
    training_type: str
    scheduled_date: Optional[date] = None
    completion_date: Optional[date] = None
    expiration_date: Optional[date] = None
    hours_completed: float = Field(..., ge=0)
    credit_hours: Optional[float] = Field(None, ge=0)
    certification_number: Optional[str] = Field(None, max_length=100)
    issuing_agency: Optional[str] = Field(None, max_length=255)
    status: str = "scheduled"
    score: Optional[float] = Field(None, ge=0, le=100)
    passing_score: Optional[float] = Field(None, ge=0, le=100)
    passed: Optional[bool] = None
    instructor: Optional[str] = Field(None, max_length=255)
    location: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None
    attachments: Optional[List[str]] = None


class TrainingRecordCreate(TrainingRecordBase):
    """Schema for creating a new training record"""
    user_id: UUID
    course_id: Optional[UUID] = None


class TrainingRecordUpdate(BaseModel):
    """Schema for updating a training record"""
    course_name: Optional[str] = Field(None, min_length=1, max_length=255)
    course_code: Optional[str] = Field(None, max_length=50)
    training_type: Optional[str] = None
    scheduled_date: Optional[date] = None
    completion_date: Optional[date] = None
    expiration_date: Optional[date] = None
    hours_completed: Optional[float] = Field(None, ge=0)
    credit_hours: Optional[float] = Field(None, ge=0)
    certification_number: Optional[str] = Field(None, max_length=100)
    issuing_agency: Optional[str] = Field(None, max_length=255)
    status: Optional[str] = None
    score: Optional[float] = Field(None, ge=0, le=100)
    passing_score: Optional[float] = Field(None, ge=0, le=100)
    passed: Optional[bool] = None
    instructor: Optional[str] = Field(None, max_length=255)
    location: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None
    attachments: Optional[List[str]] = None


class TrainingRecordResponse(TrainingRecordBase):
    """Schema for training record response"""
    id: UUID
    organization_id: UUID
    user_id: UUID
    course_id: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None

    model_config = ConfigDict(from_attributes=True)


# Training Requirement Schemas

class TrainingRequirementBase(BaseModel):
    """Base training requirement schema"""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    training_type: Optional[str] = None
    required_hours: Optional[float] = Field(None, ge=0)
    required_courses: Optional[List[UUID]] = None
    frequency: str
    year: Optional[int] = Field(None, ge=2020, le=2100)
    applies_to_all: bool = True
    required_roles: Optional[List[UUID]] = None
    start_date: Optional[date] = None
    due_date: Optional[date] = None
    # Due date calculation fields
    due_date_type: DueDateType = DueDateType.CALENDAR_PERIOD
    rolling_period_months: Optional[int] = Field(None, ge=1, le=120)  # 1-10 years
    period_start_month: int = Field(1, ge=1, le=12)  # Month period starts (1=January)
    period_start_day: int = Field(1, ge=1, le=31)  # Day period starts
    # Category requirements - training in these categories satisfies this requirement
    category_ids: Optional[List[UUID]] = None


class TrainingRequirementCreate(TrainingRequirementBase):
    """Schema for creating a new training requirement"""
    pass


class TrainingRequirementUpdate(BaseModel):
    """Schema for updating a training requirement"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    training_type: Optional[str] = None
    required_hours: Optional[float] = Field(None, ge=0)
    required_courses: Optional[List[UUID]] = None
    frequency: Optional[str] = None
    year: Optional[int] = Field(None, ge=2020, le=2100)
    applies_to_all: Optional[bool] = None
    required_roles: Optional[List[UUID]] = None
    start_date: Optional[date] = None
    due_date: Optional[date] = None
    # Due date calculation fields
    due_date_type: Optional[DueDateType] = None
    rolling_period_months: Optional[int] = Field(None, ge=1, le=120)
    period_start_month: Optional[int] = Field(None, ge=1, le=12)
    period_start_day: Optional[int] = Field(None, ge=1, le=31)
    category_ids: Optional[List[UUID]] = None
    active: Optional[bool] = None


class TrainingRequirementResponse(TrainingRequirementBase):
    """Schema for training requirement response"""
    id: UUID
    organization_id: UUID
    active: bool
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None

    model_config = ConfigDict(from_attributes=True)


# Training Statistics and Reports

class UserTrainingStats(BaseModel):
    """Training statistics for a user"""
    user_id: UUID
    total_hours: float
    hours_this_year: float
    total_certifications: int
    active_certifications: int
    expiring_soon: int  # Within 90 days
    expired: int
    completed_courses: int


class TrainingHoursSummary(BaseModel):
    """Summary of training hours by type"""
    training_type: str
    total_hours: float
    record_count: int


class TrainingReport(BaseModel):
    """Comprehensive training report"""
    user_id: Optional[UUID] = None
    start_date: date
    end_date: date
    total_hours: float
    hours_by_type: List[TrainingHoursSummary]
    records: List[TrainingRecordResponse]
    requirements_met: List[UUID]
    requirements_pending: List[UUID]


class RequirementProgress(BaseModel):
    """Progress towards a training requirement"""
    requirement_id: UUID
    requirement_name: str
    required_hours: Optional[float]
    completed_hours: float
    percentage_complete: float
    is_complete: bool
    due_date: Optional[date]
    due_date_type: Optional[DueDateType] = None
    days_until_due: Optional[int] = None  # Negative if overdue

"""
Training Program Pydantic Schemas

Request and response schemas for training program management endpoints.
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Dict, Any
from datetime import datetime, date
from uuid import UUID


# Enum-like string literals for validation
RequirementTypeStr = str  # hours, courses, certification, shifts, calls, skills_evaluation, checklist
RequirementSourceStr = str  # department, state, national
ProgramStructureTypeStr = str  # sequential, phases, flexible
EnrollmentStatusStr = str  # active, completed, on_hold, withdrawn, failed
RequirementProgressStatusStr = str  # not_started, in_progress, completed, waived


# Training Requirement Schemas (Enhanced)

class TrainingRequirementEnhancedBase(BaseModel):
    """Enhanced training requirement schema with all requirement types"""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    requirement_type: RequirementTypeStr
    source: RequirementSourceStr = "department"
    registry_name: Optional[str] = Field(None, max_length=100)
    registry_code: Optional[str] = Field(None, max_length=50)
    is_editable: bool = True

    # Different requirement quantities
    training_type: Optional[str] = None
    required_hours: Optional[float] = Field(None, ge=0)
    required_courses: Optional[List[Dict[str, Any]]] = None
    required_shifts: Optional[int] = Field(None, ge=0)
    required_calls: Optional[int] = Field(None, ge=0)
    required_call_types: Optional[List[str]] = None
    required_skills: Optional[List[Dict[str, Any]]] = None
    checklist_items: Optional[List[str]] = None
    passing_score: Optional[float] = Field(None, ge=0, le=100)
    max_attempts: Optional[int] = Field(None, ge=1)

    frequency: str
    time_limit_days: Optional[int] = Field(None, ge=0)
    applies_to_all: bool = False
    required_positions: Optional[List[str]] = None
    required_roles: Optional[List[UUID]] = None


class TrainingRequirementEnhancedCreate(TrainingRequirementEnhancedBase):
    """Schema for creating an enhanced training requirement"""
    pass


class TrainingRequirementEnhancedUpdate(BaseModel):
    """Schema for updating an enhanced training requirement"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    requirement_type: Optional[RequirementTypeStr] = None
    is_editable: Optional[bool] = None
    training_type: Optional[str] = None
    required_hours: Optional[float] = Field(None, ge=0)
    required_courses: Optional[List[Dict[str, Any]]] = None
    required_shifts: Optional[int] = Field(None, ge=0)
    required_calls: Optional[int] = Field(None, ge=0)
    required_call_types: Optional[List[str]] = None
    required_skills: Optional[List[Dict[str, Any]]] = None
    checklist_items: Optional[List[str]] = None
    passing_score: Optional[float] = Field(None, ge=0, le=100)
    max_attempts: Optional[int] = Field(None, ge=1)
    frequency: Optional[str] = None
    time_limit_days: Optional[int] = Field(None, ge=0)
    applies_to_all: Optional[bool] = None
    required_positions: Optional[List[str]] = None
    required_roles: Optional[List[UUID]] = None
    active: Optional[bool] = None


class TrainingRequirementEnhancedResponse(TrainingRequirementEnhancedBase):
    """Schema for enhanced training requirement response"""
    id: UUID
    organization_id: UUID
    active: bool
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None

    model_config = ConfigDict(from_attributes=True)


# Training Program Schemas

class TrainingProgramBase(BaseModel):
    """Base training program schema"""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    target_position: Optional[str] = Field(None, max_length=100)
    target_roles: Optional[List[UUID]] = None
    structure_type: ProgramStructureTypeStr = "flexible"
    time_limit_days: Optional[int] = Field(None, ge=0)
    warning_days_before: int = Field(default=30, ge=0)
    is_template: bool = False


class TrainingProgramCreate(TrainingProgramBase):
    """Schema for creating a training program"""
    pass


class TrainingProgramUpdate(BaseModel):
    """Schema for updating a training program"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    target_position: Optional[str] = Field(None, max_length=100)
    target_roles: Optional[List[UUID]] = None
    structure_type: Optional[ProgramStructureTypeStr] = None
    time_limit_days: Optional[int] = Field(None, ge=0)
    warning_days_before: Optional[int] = Field(None, ge=0)
    is_template: Optional[bool] = None
    active: Optional[bool] = None


class TrainingProgramResponse(TrainingProgramBase):
    """Schema for training program response"""
    id: UUID
    organization_id: UUID
    active: bool
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None

    model_config = ConfigDict(from_attributes=True)


# Program Phase Schemas

class ProgramPhaseBase(BaseModel):
    """Base program phase schema"""
    phase_number: int = Field(..., ge=1)
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    prerequisite_phase_ids: Optional[List[UUID]] = None
    time_limit_days: Optional[int] = Field(None, ge=0)


class ProgramPhaseCreate(ProgramPhaseBase):
    """Schema for creating a program phase"""
    program_id: UUID


class ProgramPhaseUpdate(BaseModel):
    """Schema for updating a program phase"""
    phase_number: Optional[int] = Field(None, ge=1)
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    prerequisite_phase_ids: Optional[List[UUID]] = None
    time_limit_days: Optional[int] = Field(None, ge=0)


class ProgramPhaseResponse(ProgramPhaseBase):
    """Schema for program phase response"""
    id: UUID
    program_id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# Program Requirement Schemas

class ProgramRequirementBase(BaseModel):
    """Base program requirement schema"""
    is_required: bool = True
    is_prerequisite: bool = False
    sort_order: int = Field(default=0, ge=0)


class ProgramRequirementCreate(ProgramRequirementBase):
    """Schema for creating a program requirement"""
    program_id: UUID
    phase_id: Optional[UUID] = None
    requirement_id: UUID


class ProgramRequirementUpdate(BaseModel):
    """Schema for updating a program requirement"""
    is_required: Optional[bool] = None
    is_prerequisite: Optional[bool] = None
    sort_order: Optional[int] = Field(None, ge=0)


class ProgramRequirementResponse(ProgramRequirementBase):
    """Schema for program requirement response"""
    id: UUID
    program_id: UUID
    phase_id: Optional[UUID] = None
    requirement_id: UUID
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# Program Milestone Schemas

class ProgramMilestoneBase(BaseModel):
    """Base program milestone schema"""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    completion_percentage_threshold: float = Field(..., ge=0, le=100)
    notification_message: Optional[str] = None


class ProgramMilestoneCreate(ProgramMilestoneBase):
    """Schema for creating a program milestone"""
    program_id: UUID
    phase_id: Optional[UUID] = None


class ProgramMilestoneUpdate(BaseModel):
    """Schema for updating a program milestone"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    completion_percentage_threshold: Optional[float] = Field(None, ge=0, le=100)
    notification_message: Optional[str] = None


class ProgramMilestoneResponse(ProgramMilestoneBase):
    """Schema for program milestone response"""
    id: UUID
    program_id: UUID
    phase_id: Optional[UUID] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# Program Enrollment Schemas

class ProgramEnrollmentBase(BaseModel):
    """Base program enrollment schema"""
    target_completion_date: Optional[date] = None
    notes: Optional[str] = None


class ProgramEnrollmentCreate(ProgramEnrollmentBase):
    """Schema for enrolling a member in a program"""
    user_id: UUID
    program_id: UUID


class ProgramEnrollmentUpdate(BaseModel):
    """Schema for updating a program enrollment"""
    target_completion_date: Optional[date] = None
    current_phase_id: Optional[UUID] = None
    status: Optional[EnrollmentStatusStr] = None
    notes: Optional[str] = None


class ProgramEnrollmentResponse(ProgramEnrollmentBase):
    """Schema for program enrollment response"""
    id: UUID
    user_id: UUID
    program_id: UUID
    enrolled_at: datetime
    current_phase_id: Optional[UUID] = None
    progress_percentage: float
    status: EnrollmentStatusStr
    completed_at: Optional[datetime] = None
    deadline_warning_sent: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# Requirement Progress Schemas

class RequirementProgressBase(BaseModel):
    """Base requirement progress schema"""
    progress_notes: Optional[Dict[str, Any]] = None


class RequirementProgressCreate(RequirementProgressBase):
    """Schema for creating requirement progress tracking"""
    enrollment_id: UUID
    requirement_id: UUID


class RequirementProgressUpdate(BaseModel):
    """Schema for updating requirement progress"""
    status: Optional[RequirementProgressStatusStr] = None
    progress_value: Optional[float] = Field(None, ge=0)
    progress_notes: Optional[Dict[str, Any]] = None
    verified_by: Optional[UUID] = None


class RequirementProgressResponse(RequirementProgressBase):
    """Schema for requirement progress response"""
    id: UUID
    enrollment_id: UUID
    requirement_id: UUID
    status: RequirementProgressStatusStr
    progress_value: float
    progress_percentage: float
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    verified_by: Optional[UUID] = None
    verified_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# Skill Evaluation Schemas

class SkillEvaluationBase(BaseModel):
    """Base skill evaluation schema"""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    category: Optional[str] = Field(None, max_length=100)
    evaluation_criteria: Optional[Dict[str, Any]] = None
    passing_requirements: Optional[str] = None
    required_for_programs: Optional[List[UUID]] = None


class SkillEvaluationCreate(SkillEvaluationBase):
    """Schema for creating a skill evaluation"""
    pass


class SkillEvaluationUpdate(BaseModel):
    """Schema for updating a skill evaluation"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    category: Optional[str] = Field(None, max_length=100)
    evaluation_criteria: Optional[Dict[str, Any]] = None
    passing_requirements: Optional[str] = None
    required_for_programs: Optional[List[UUID]] = None


class SkillEvaluationResponse(SkillEvaluationBase):
    """Schema for skill evaluation response"""
    id: UUID
    organization_id: UUID
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None

    model_config = ConfigDict(from_attributes=True)


# Skill Checkoff Schemas

class SkillCheckoffBase(BaseModel):
    """Base skill checkoff schema"""
    evaluation_results: Optional[Dict[str, Any]] = None
    notes: Optional[str] = None


class SkillCheckoffCreate(SkillCheckoffBase):
    """Schema for creating a skill checkoff"""
    user_id: UUID
    skill_evaluation_id: UUID
    evaluator_id: UUID


class SkillCheckoffUpdate(BaseModel):
    """Schema for updating a skill checkoff"""
    status: Optional[str] = None  # pending, passed, failed, needs_retest
    evaluation_results: Optional[Dict[str, Any]] = None
    notes: Optional[str] = None


class SkillCheckoffResponse(SkillCheckoffBase):
    """Schema for skill checkoff response"""
    id: UUID
    user_id: UUID
    skill_evaluation_id: UUID
    evaluator_id: UUID
    status: str
    evaluated_at: datetime
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# Comprehensive Program Details

class ProgramWithPhasesAndRequirements(TrainingProgramResponse):
    """Comprehensive program details with phases and requirements"""
    phases: List[ProgramPhaseResponse] = []
    requirements: List[TrainingRequirementEnhancedResponse] = []
    milestones: List[ProgramMilestoneResponse] = []
    total_requirements: int = 0
    total_required: int = 0


class MemberProgramProgress(BaseModel):
    """Comprehensive member progress in a program"""
    enrollment: ProgramEnrollmentResponse
    program: TrainingProgramResponse
    current_phase: Optional[ProgramPhaseResponse] = None
    requirement_progress: List[RequirementProgressResponse] = []
    completed_requirements: int = 0
    total_requirements: int = 0
    next_milestones: List[ProgramMilestoneResponse] = []
    time_remaining_days: Optional[int] = None
    is_behind_schedule: bool = False


# Registry Import Schemas

class RegistryRequirementImport(BaseModel):
    """Schema for importing registry requirements"""
    registry_name: str
    registry_description: str
    requirements: List[TrainingRequirementEnhancedCreate]


class RegistryImportResult(BaseModel):
    """Result of registry import operation"""
    registry_name: str
    imported_count: int
    skipped_count: int
    errors: List[str] = []

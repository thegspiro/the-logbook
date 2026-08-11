"""
Training Program Pydantic Schemas

Request and response schemas for training program management endpoints.
"""

from datetime import date, datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.training import RequirementFrequency as ModelRequirementFrequency
from app.models.training import TrainingType as ModelTrainingType
from app.schemas.base import UTCResponseBase
from app.schemas.checklist import ChecklistItem, coerce_checklist_items
from app.schemas.enum_validation import validate_enum_value

_response_config = ConfigDict(from_attributes=True)

# Enum-like string literals for validation
RequirementTypeStr = (
    str  # hours, courses, certification, shifts, calls, skills_evaluation, checklist
)
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
    # Opt-in: may imported/external training (e.g. Vector Solutions) auto-credit
    # this requirement by category? Off by default — in-house delivery only.
    allows_external_credit: bool = False

    # Different requirement quantities.
    # required_courses / required_skills / required_roles are stored as JSON
    # arrays of scalar id/slug strings (matching the training_requirements
    # columns and the compliance evaluator, which does membership tests like
    # `str(course_id) in required_courses` and `rank in required_roles`).
    # They are NOT lists of dicts, and required_roles holds role slugs, not
    # UUIDs — a UUID type here would fail to serialize a slug-based value.
    training_type: Optional[str] = None
    required_hours: Optional[float] = Field(None, ge=0)
    required_courses: Optional[List[str]] = None
    required_shifts: Optional[int] = Field(None, ge=0)
    required_calls: Optional[int] = Field(None, ge=0)
    required_call_types: Optional[List[str]] = None
    required_skills: Optional[List[str]] = None
    checklist_items: Optional[List[ChecklistItem]] = None
    passing_score: Optional[float] = Field(None, ge=0, le=100)
    max_attempts: Optional[int] = Field(None, ge=1)
    # Freshness window: a completion older than this many days doesn't count
    # toward the requirement. None = any completion counts however old.
    recency_days: Optional[int] = Field(None, ge=1, le=3650)

    frequency: str
    time_limit_days: Optional[int] = Field(None, ge=0)
    # Default matches the model column (default=True) and the base
    # TrainingRequirement schema so the same table isn't created with
    # conflicting defaults depending on which endpoint is used.
    applies_to_all: bool = True
    required_positions: Optional[List[str]] = None
    required_roles: Optional[List[str]] = None

    @field_validator("frequency")
    @classmethod
    def _validate_frequency(cls, v: str) -> str:
        return validate_enum_value(v, ModelRequirementFrequency, "frequency")

    @field_validator("training_type")
    @classmethod
    def _validate_training_type(cls, v: Optional[str]) -> Optional[str]:
        return validate_enum_value(v, ModelTrainingType, "training_type")

    @field_validator("checklist_items", mode="before")
    @classmethod
    def _coerce_checklist_items(cls, v):
        # Accepts the legacy bare-string form as well as objects, so older
        # clients and the built-in sample templates keep working.
        return coerce_checklist_items(v)


class TrainingRequirementEnhancedCreate(TrainingRequirementEnhancedBase):
    """Schema for creating an enhanced training requirement"""


class TrainingRequirementEnhancedUpdate(BaseModel):
    """Schema for updating an enhanced training requirement"""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    requirement_type: Optional[RequirementTypeStr] = None
    is_editable: Optional[bool] = None
    allows_external_credit: Optional[bool] = None
    training_type: Optional[str] = None
    required_hours: Optional[float] = Field(None, ge=0)
    required_courses: Optional[List[str]] = None
    required_shifts: Optional[int] = Field(None, ge=0)
    required_calls: Optional[int] = Field(None, ge=0)
    required_call_types: Optional[List[str]] = None
    required_skills: Optional[List[str]] = None
    checklist_items: Optional[List[ChecklistItem]] = None
    passing_score: Optional[float] = Field(None, ge=0, le=100)
    max_attempts: Optional[int] = Field(None, ge=1)
    recency_days: Optional[int] = Field(None, ge=1, le=3650)
    frequency: Optional[str] = None
    time_limit_days: Optional[int] = Field(None, ge=0)
    applies_to_all: Optional[bool] = None
    required_positions: Optional[List[str]] = None
    required_roles: Optional[List[str]] = None
    active: Optional[bool] = None

    @field_validator("frequency")
    @classmethod
    def _validate_frequency(cls, v: Optional[str]) -> Optional[str]:
        return validate_enum_value(v, ModelRequirementFrequency, "frequency")

    @field_validator("training_type")
    @classmethod
    def _validate_training_type(cls, v: Optional[str]) -> Optional[str]:
        return validate_enum_value(v, ModelTrainingType, "training_type")

    @field_validator("checklist_items", mode="before")
    @classmethod
    def _coerce_checklist_items(cls, v):
        # Accepts the legacy bare-string form as well as objects, so older
        # clients and the built-in sample templates keep working.
        return coerce_checklist_items(v)


class TrainingRequirementEnhancedResponse(
    TrainingRequirementEnhancedBase, UTCResponseBase
):
    """Schema for enhanced training requirement response"""

    id: UUID
    organization_id: UUID
    active: bool
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None

    model_config = _response_config


# Training Program Schemas


class ReminderConditions(BaseModel):
    """When a program nags an enrolled member about their deadline.

    ``extra="ignore"`` on purpose: ``milestone_threshold`` shipped in an early
    sketch of this blob and is not honored (ProgramMilestone rows already fire
    progress-based notifications). Old rows keep the key and still validate;
    new writes drop it.
    """

    model_config = ConfigDict(extra="ignore")

    # Days before the deadline to warn. A single int is accepted so rows written
    # against the original shape (``"days_before_deadline": 90``) still load.
    days_before_deadline: Optional[List[int]] = None
    # Skip the warning for members at or above this completion percentage.
    send_if_below_percentage: Optional[float] = Field(None, ge=0, le=100)

    @field_validator("days_before_deadline", mode="before")
    @classmethod
    def _accept_single_day(cls, value: Any) -> Any:
        if value is None or isinstance(value, list):
            return value
        return [value]

    @field_validator("days_before_deadline", mode="after")
    @classmethod
    def _reject_negative_days(cls, value: Optional[List[int]]) -> Optional[List[int]]:
        if value and any(day < 0 for day in value):
            raise ValueError(
                "Reminder days must be zero or more days before the due date"
            )
        return value


class TrainingProgramBase(BaseModel):
    """Base training program schema"""

    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    code: Optional[str] = Field(None, max_length=50)
    target_position: Optional[str] = Field(None, max_length=100)
    target_roles: Optional[List[UUID]] = None
    structure_type: ProgramStructureTypeStr = "flexible"
    time_limit_days: Optional[int] = Field(None, ge=0)
    warning_days_before: int = Field(default=30, ge=0)
    reminder_conditions: Optional[ReminderConditions] = None
    is_template: bool = False
    # Recertification cycle: when enabled, enrolled members' progress auto-resets
    # on a recurring deadline. anchor_month/day optionally pin it to a fixed date
    # (e.g. NREMT's March 30) rather than rolling from the enrollment date.
    recert_enabled: bool = False
    recert_interval_months: Optional[int] = Field(None, ge=1, le=120)
    recert_anchor_month: Optional[int] = Field(None, ge=1, le=12)
    recert_anchor_day: Optional[int] = Field(None, ge=1, le=31)


class TrainingProgramCreate(TrainingProgramBase):
    """Schema for creating a training program"""


class TrainingProgramUpdate(BaseModel):
    """Schema for updating a training program"""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    code: Optional[str] = Field(None, max_length=50)
    target_position: Optional[str] = Field(None, max_length=100)
    target_roles: Optional[List[UUID]] = None
    structure_type: Optional[ProgramStructureTypeStr] = None
    time_limit_days: Optional[int] = Field(None, ge=0)
    warning_days_before: Optional[int] = Field(None, ge=0)
    reminder_conditions: Optional[ReminderConditions] = None
    is_template: Optional[bool] = None
    active: Optional[bool] = None
    recert_enabled: Optional[bool] = None
    recert_interval_months: Optional[int] = Field(None, ge=1, le=120)
    recert_anchor_month: Optional[int] = Field(None, ge=1, le=12)
    recert_anchor_day: Optional[int] = Field(None, ge=1, le=31)


class TrainingProgramResponse(TrainingProgramBase, UTCResponseBase):
    """Schema for training program response"""

    id: UUID
    organization_id: UUID
    version: int = 1
    active: bool
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None
    # How many members are on this pipeline. Computed for the list view — the
    # programme cards report it, and without it they rendered a hardcoded zero.
    enrolled_count: int = 0

    model_config = _response_config


# Program Phase Schemas


class ProgramPhaseBase(BaseModel):
    """Base program phase schema"""

    phase_number: int = Field(..., ge=1)
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    prerequisite_phase_ids: Optional[List[UUID]] = None
    time_limit_days: Optional[int] = Field(None, ge=0)
    requires_manual_advancement: bool = False


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
    requires_manual_advancement: Optional[bool] = None


class ProgramPhaseResponse(ProgramPhaseBase, UTCResponseBase):
    """Schema for program phase response"""

    id: UUID
    program_id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = _response_config


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
    # Set True only by the caller that just created ``requirement_id`` for this
    # program — it makes unlinking delete the requirement too. Defaults False so
    # linking an existing department requirement never puts it up for deletion.
    owns_requirement: bool = False


class ProgramRequirementUpdate(BaseModel):
    """Schema for updating a program requirement"""

    is_required: Optional[bool] = None
    is_prerequisite: Optional[bool] = None
    sort_order: Optional[int] = Field(None, ge=0)
    # Move the requirement to a different phase (or None for program-level).
    phase_id: Optional[UUID] = None


class PhaseReorderRequest(BaseModel):
    """Ordered phase IDs; index becomes the new phase_number (1-based)."""

    phase_ids: List[UUID] = Field(..., min_length=1)


class RequirementReorderRequest(BaseModel):
    """Ordered program-requirement IDs; index becomes the new sort_order."""

    program_requirement_ids: List[UUID] = Field(..., min_length=1)


class ProgramRequirementResponse(ProgramRequirementBase, UTCResponseBase):
    """Schema for program requirement response"""

    id: UUID
    program_id: UUID
    phase_id: Optional[UUID] = None
    requirement_id: UUID
    # Surfaced so the editor can warn that edits to a linked-in department
    # requirement apply everywhere it is used, not just in this program.
    owns_requirement: bool = True
    # Nested so the UI can show the requirement's name/type without a second
    # lookup. The endpoints eager-load this relationship; from_attributes reads
    # only declared fields, so without it the name is silently dropped.
    requirement: Optional[TrainingRequirementEnhancedResponse] = None
    created_at: datetime

    model_config = _response_config


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


class ProgramMilestoneResponse(ProgramMilestoneBase, UTCResponseBase):
    """Schema for program milestone response"""

    id: UUID
    program_id: UUID
    phase_id: Optional[UUID] = None
    created_at: datetime

    model_config = _response_config


# Program Enrollment Schemas


class ProgramEnrollmentBase(BaseModel):
    """Base program enrollment schema"""

    target_completion_date: Optional[date] = None
    notes: Optional[str] = None


class ProgramEnrollmentCreate(ProgramEnrollmentBase):
    """Schema for enrolling a member in a program"""

    user_id: UUID
    program_id: UUID


class ProgramEnrollmentWithdraw(BaseModel):
    """Schema for withdrawing from a program enrollment"""

    reason: Optional[str] = Field(None, max_length=500)


class ProgramEnrollmentReopen(BaseModel):
    """Options when an officer reopens an expired enrollment.

    Omitting the date reopens on the old deadline, which is only useful if the
    officer is about to change it another way — the usual call is an extension.
    """

    target_completion_date: Optional[date] = None


class ApplyTrainingRecordRequest(BaseModel):
    """Officer applies an existing training record toward a pipeline requirement."""

    record_id: UUID
    program_id: UUID
    requirement_id: UUID


class ProgramEnrollmentUpdate(BaseModel):
    """Schema for updating a program enrollment"""

    target_completion_date: Optional[date] = None
    current_phase_id: Optional[UUID] = None
    status: Optional[EnrollmentStatusStr] = None
    notes: Optional[str] = None


class ProgramEnrollmentResponse(ProgramEnrollmentBase, UTCResponseBase):
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
    next_recert_reset_at: Optional[date] = None
    last_recert_reset_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = _response_config


class ProgramEnrollmentWithUserResponse(ProgramEnrollmentResponse):
    """Enrollment response enriched with the member's display name.

    Used by the program detail view's Enrollments tab so officers see who is
    enrolled without a second round-trip to resolve each user_id.
    """

    user_name: str
    user_email: Optional[str] = None


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
    # Officer-entered knowledge/skills test score (0-100). Pass/fail is derived
    # from the requirement's passing_score; a pass completes the requirement.
    test_score: Optional[float] = Field(None, ge=0, le=100)
    # Ticked steps of a CHECKLIST requirement, as the full set of step ids that
    # are done. Sending the whole set (rather than one toggle) keeps the write
    # idempotent, so a retry or two officers on the same record cannot leave a
    # step half-applied.
    checklist_done: Optional[List[str]] = None


class RequirementProgressResponse(RequirementProgressBase, UTCResponseBase):
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
    # Nested so progress views (dashboard widget, officer progress modal, member
    # "My Progress") can show the requirement's name/type. Eager-loaded by the
    # callers; from_attributes drops it unless it's declared here.
    requirement: Optional[TrainingRequirementEnhancedResponse] = None
    created_at: datetime
    updated_at: datetime

    model_config = _response_config


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


class SkillEvaluationUpdate(BaseModel):
    """Schema for updating a skill evaluation"""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    category: Optional[str] = Field(None, max_length=100)
    evaluation_criteria: Optional[Dict[str, Any]] = None
    passing_requirements: Optional[str] = None
    required_for_programs: Optional[List[UUID]] = None


class SkillEvaluationResponse(SkillEvaluationBase, UTCResponseBase):
    """Schema for skill evaluation response"""

    id: UUID
    organization_id: UUID
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None

    model_config = _response_config


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


class SkillCheckoffResponse(SkillCheckoffBase, UTCResponseBase):
    """Schema for skill checkoff response"""

    id: UUID
    user_id: UUID
    skill_evaluation_id: UUID
    evaluator_id: UUID
    status: str
    evaluated_at: datetime
    created_at: datetime
    updated_at: datetime

    model_config = _response_config


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
    # Requirement id -> names of the prerequisites still blocking it. Present so
    # the member's page can grey a step out and say what unlocks it, instead of
    # offering work that the API will refuse.
    locked_requirements: Dict[str, List[str]] = {}


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
    # Section (topic-area) categories auto-created to link the requirements.
    categories_created: int = 0
    skipped_count: int
    errors: List[str] = []
    last_updated: Optional[str] = None
    source_url: Optional[str] = None


class RegistryRequirementPreview(BaseModel):
    """One selectable requirement in a registry, for the pick-and-choose import."""

    registry_code: Optional[str] = None
    name: str
    description: Optional[str] = None
    requirement_type: str
    required_hours: Optional[float] = None
    frequency: Optional[str] = None
    already_imported: bool = False
    # Topic-area sections this requirement's hours are distributed across
    # (e.g. Airway, Cardiology, …) — these become linked training categories.
    sections: List[str] = []


class RegistrySelectiveImport(BaseModel):
    """Import options: which registry codes to import (None/omitted = all)."""

    registry_codes: Optional[List[str]] = None
    skip_existing: bool = True


# Atomic Program Build Schemas
#
# The create-pipeline wizard builds a program, its phases, requirements, and
# milestones in one shot. Sending them as one nested payload lets the backend
# persist everything in a single transaction, so a failure part-way can't leave
# an orphaned half-built program behind (the old flow fired one request per
# entity with no rollback).


class ProgramBuildRequirementInput(BaseModel):
    """
    One requirement within a phase during program build — either an existing
    department requirement to link (``requirement_id``) or a new one to create
    (everything else). Exactly one of the two forms, never both.
    """

    requirement_id: Optional[UUID] = Field(
        None,
        description=(
            "Link this existing department requirement instead of creating one. "
            "When set, every definition field below is ignored."
        ),
    )
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    requirement_type: RequirementTypeStr = "hours"
    frequency: str = "one_time"
    required_hours: Optional[float] = Field(None, ge=0)
    required_shifts: Optional[int] = Field(None, ge=0)
    required_calls: Optional[int] = Field(None, ge=0)
    passing_score: Optional[float] = Field(None, ge=0, le=100)
    max_attempts: Optional[int] = Field(None, ge=1)
    checklist_items: Optional[List[ChecklistItem]] = None
    required_courses: Optional[List[str]] = Field(
        None, description="Course IDs that satisfy a 'courses' requirement"
    )
    recency_days: Optional[int] = Field(
        None,
        ge=1,
        le=3650,
        description=(
            "Freshness window — a completion older than this many days does not "
            "count toward the requirement"
        ),
    )
    allows_external_credit: bool = False
    is_required: bool = True
    sort_order: int = Field(default=0, ge=0)

    @field_validator("checklist_items", mode="before")
    @classmethod
    def _coerce_checklist_items(cls, v):
        # Accepts the legacy bare-string form as well as objects, so older
        # clients and the built-in sample templates keep working.
        return coerce_checklist_items(v)

    @model_validator(mode="after")
    def _link_or_define_not_both(self) -> "ProgramBuildRequirementInput":
        if self.requirement_id and self.name:
            raise ValueError(
                "Provide either requirement_id (to link an existing requirement) "
                "or name (to define a new one), not both"
            )
        if not self.requirement_id and not self.name:
            raise ValueError("Each requirement needs a requirement_id or a name")
        return self


class ProgramBuildMilestoneInput(BaseModel):
    """A milestone to create within a phase during program build."""

    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    completion_percentage_threshold: float = Field(default=100, ge=0, le=100)
    notification_message: Optional[str] = None


class ProgramBuildPhaseInput(BaseModel):
    """A phase (with its requirements and milestones) during program build."""

    phase_number: int = Field(..., ge=1)
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    time_limit_days: Optional[int] = Field(None, ge=0)
    requires_manual_advancement: bool = False
    requirements: List[ProgramBuildRequirementInput] = []
    milestones: List[ProgramBuildMilestoneInput] = []


class ProgramBuildRequest(BaseModel):
    """Full nested payload for creating a program and its structure atomically."""

    program: TrainingProgramCreate
    phases: List[ProgramBuildPhaseInput] = []
    # Requirements that belong to the program rather than to any phase. A
    # flexible program has no phases at all, so without these the wizard could
    # only ever produce an empty one.
    requirements: List[ProgramBuildRequirementInput] = []
    milestones: List[ProgramBuildMilestoneInput] = []


class MemberEligibilityResponse(BaseModel):
    """Per-member enrollment eligibility for the enroll picker."""

    user_id: UUID
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    membership_number: Optional[str] = None
    eligible: bool
    # eligible | enrolled | prerequisite | concurrent
    status: str
    reason: Optional[str] = None

    model_config = _response_config


class SampleTemplateSummary(BaseModel):
    """Gallery metadata for a built-in sample program template."""

    key: str
    name: str
    description: Optional[str] = None
    code: Optional[str] = None
    target_position: Optional[str] = None
    structure_type: str
    phase_count: int
    requirement_count: int
    time_limit_days: Optional[int] = None


class SampleTemplateInstantiate(BaseModel):
    """Options when adding a built-in sample template to the caller's org."""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    is_template: bool = True

"""
Training Enhancement Pydantic Schemas

Request and response schemas for recertification pathways, competency tracking,
instructor qualifications, training effectiveness, multi-agency training, and xAPI.
"""

from datetime import date, datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.schemas.base import stamp_naive_datetimes_utc

_response_config = ConfigDict(from_attributes=True)

# ============================================
# Recertification Pathway Schemas
# ============================================


class RecertificationPathwayBase(BaseModel):
    """Base recertification pathway schema"""

    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    source_requirement_id: Optional[UUID] = None
    renewal_type: str = Field(
        "hours", pattern=r"^(hours|courses|assessment|combination)$"
    )
    required_hours: Optional[float] = Field(None, ge=0)
    required_courses: Optional[List[str]] = None
    category_hour_requirements: Optional[List[Dict[str, Any]]] = None
    requires_assessment: bool = False
    assessment_course_id: Optional[UUID] = None
    renewal_window_days: int = Field(90, ge=1, le=365)
    grace_period_days: int = Field(0, ge=0, le=365)
    max_lapse_days: Optional[int] = Field(None, ge=0)
    prerequisite_pathway_ids: Optional[List[str]] = None
    new_expiration_months: Optional[int] = Field(None, ge=1)
    auto_create_record: bool = True


class RecertificationPathwayCreate(RecertificationPathwayBase):
    """Schema for creating a recertification pathway"""


class RecertificationPathwayUpdate(BaseModel):
    """Schema for updating a recertification pathway"""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    source_requirement_id: Optional[UUID] = None
    renewal_type: Optional[str] = Field(
        None, pattern=r"^(hours|courses|assessment|combination)$"
    )
    required_hours: Optional[float] = Field(None, ge=0)
    required_courses: Optional[List[str]] = None
    category_hour_requirements: Optional[List[Dict[str, Any]]] = None
    requires_assessment: Optional[bool] = None
    assessment_course_id: Optional[UUID] = None
    renewal_window_days: Optional[int] = Field(None, ge=1, le=365)
    grace_period_days: Optional[int] = Field(None, ge=0, le=365)
    max_lapse_days: Optional[int] = Field(None, ge=0)
    prerequisite_pathway_ids: Optional[List[str]] = None
    new_expiration_months: Optional[int] = Field(None, ge=1)
    auto_create_record: Optional[bool] = None
    active: Optional[bool] = None


class RecertificationPathwayResponse(RecertificationPathwayBase):
    """Schema for recertification pathway response"""

    id: UUID
    organization_id: UUID
    active: bool
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None

    model_config = _response_config

    @model_validator(mode="after")
    def ensure_utc(self) -> "RecertificationPathwayResponse":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


class RenewalTaskStatus(str, Enum):
    """Status of a renewal task"""

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    EXPIRED = "expired"
    LAPSED = "lapsed"


class RenewalTaskResponse(BaseModel):
    """Schema for renewal task response"""

    id: UUID
    organization_id: UUID
    user_id: UUID
    pathway_id: UUID
    training_record_id: Optional[UUID] = None
    status: RenewalTaskStatus
    certification_expiration_date: date
    renewal_window_opens: date
    grace_period_ends: Optional[date] = None
    hours_completed: float
    courses_completed: Optional[List[str]] = None
    category_hours_completed: Optional[Dict[str, float]] = None
    assessment_passed: bool
    progress_percentage: float
    completed_at: Optional[datetime] = None
    new_record_id: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime
    # Include pathway details for convenience
    pathway_name: Optional[str] = None
    required_hours: Optional[float] = None

    model_config = _response_config

    @model_validator(mode="after")
    def ensure_utc(self) -> "RenewalTaskResponse":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


# ============================================
# Competency Level Schemas
# ============================================


class CompetencyLevelEnum(str, Enum):
    """Dreyfus model competency levels"""

    NOVICE = "novice"
    ADVANCED_BEGINNER = "advanced_beginner"
    COMPETENT = "competent"
    PROFICIENT = "proficient"
    EXPERT = "expert"


class CompetencyMatrixBase(BaseModel):
    """Base competency matrix schema"""

    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    position: str = Field(..., min_length=1, max_length=100)
    role_id: Optional[str] = None
    skill_requirements: List[Dict[str, Any]] = Field(default_factory=list)


class CompetencyMatrixCreate(CompetencyMatrixBase):
    """Schema for creating a competency matrix"""


class CompetencyMatrixUpdate(BaseModel):
    """Schema for updating a competency matrix"""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    position: Optional[str] = Field(None, min_length=1, max_length=100)
    role_id: Optional[str] = None
    skill_requirements: Optional[List[Dict[str, Any]]] = None
    active: Optional[bool] = None


class CompetencyMatrixResponse(CompetencyMatrixBase):
    """Schema for competency matrix response"""

    id: UUID
    organization_id: UUID
    active: bool
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None

    model_config = _response_config

    @model_validator(mode="after")
    def ensure_utc(self) -> "CompetencyMatrixResponse":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


class MemberCompetencyResponse(BaseModel):
    """Schema for member competency response"""

    id: UUID
    organization_id: UUID
    user_id: UUID
    skill_evaluation_id: UUID
    current_level: CompetencyLevelEnum
    previous_level: Optional[CompetencyLevelEnum] = None
    last_evaluated_at: Optional[datetime] = None
    last_evaluator_id: Optional[UUID] = None
    evaluation_count: int
    last_score: Optional[float] = None
    decay_months: Optional[int] = None
    decay_warning_sent: bool
    next_evaluation_due: Optional[date] = None
    score_history: Optional[List[Dict[str, Any]]] = None
    created_at: datetime
    updated_at: datetime
    # Enriched fields
    skill_name: Optional[str] = None

    model_config = _response_config

    @model_validator(mode="after")
    def ensure_utc(self) -> "MemberCompetencyResponse":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


class MemberCompetencyUpdate(BaseModel):
    """Schema for updating a member's competency"""

    current_level: Optional[CompetencyLevelEnum] = None
    decay_months: Optional[int] = Field(None, ge=1)
    notes: Optional[str] = None


# ============================================
# Instructor Qualification Schemas
# ============================================


class InstructorQualificationBase(BaseModel):
    """Base instructor qualification schema"""

    qualification_type: str = Field(
        ..., pattern=r"^(instructor|evaluator|lead_instructor|mentor)$"
    )
    course_id: Optional[UUID] = None
    skill_evaluation_id: Optional[UUID] = None
    category_id: Optional[UUID] = None
    certification_number: Optional[str] = Field(None, max_length=100)
    issuing_agency: Optional[str] = Field(None, max_length=255)
    certification_level: Optional[str] = Field(None, max_length=50)
    issued_date: Optional[date] = None
    expiration_date: Optional[date] = None


class InstructorQualificationCreate(InstructorQualificationBase):
    """Schema for creating an instructor qualification"""

    user_id: UUID


class InstructorQualificationUpdate(BaseModel):
    """Schema for updating an instructor qualification"""

    qualification_type: Optional[str] = Field(
        None, pattern=r"^(instructor|evaluator|lead_instructor|mentor)$"
    )
    course_id: Optional[UUID] = None
    skill_evaluation_id: Optional[UUID] = None
    category_id: Optional[UUID] = None
    certification_number: Optional[str] = Field(None, max_length=100)
    issuing_agency: Optional[str] = Field(None, max_length=255)
    certification_level: Optional[str] = Field(None, max_length=50)
    issued_date: Optional[date] = None
    expiration_date: Optional[date] = None
    active: Optional[bool] = None
    verified: Optional[bool] = None


class InstructorQualificationResponse(InstructorQualificationBase):
    """Schema for instructor qualification response"""

    id: UUID
    organization_id: UUID
    user_id: UUID
    active: bool
    verified: bool
    verified_by: Optional[UUID] = None
    verified_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None
    # Enriched fields
    user_name: Optional[str] = None
    course_name: Optional[str] = None
    skill_name: Optional[str] = None

    model_config = _response_config

    @model_validator(mode="after")
    def ensure_utc(self) -> "InstructorQualificationResponse":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


# ============================================
# Training Effectiveness Schemas
# ============================================


class EvaluationLevelEnum(str, Enum):
    """Kirkpatrick Model levels"""

    REACTION = "reaction"
    LEARNING = "learning"
    BEHAVIOR = "behavior"
    RESULTS = "results"


class TrainingEffectivenessBase(BaseModel):
    """Base training effectiveness schema"""

    training_record_id: Optional[UUID] = None
    training_session_id: Optional[UUID] = None
    course_id: Optional[UUID] = None
    evaluation_level: EvaluationLevelEnum

    # Level 1: Reaction
    survey_responses: Optional[Dict[str, Any]] = None
    overall_rating: Optional[float] = Field(None, ge=1, le=5)

    # Level 2: Learning
    pre_assessment_score: Optional[float] = Field(None, ge=0, le=100)
    post_assessment_score: Optional[float] = Field(None, ge=0, le=100)

    # Level 3: Behavior
    behavior_observations: Optional[Dict[str, Any]] = None
    behavior_rating: Optional[float] = Field(None, ge=1, le=5)

    # Level 4: Results
    results_metrics: Optional[Dict[str, Any]] = None
    results_notes: Optional[str] = None


class TrainingEffectivenessCreate(TrainingEffectivenessBase):
    """Schema for creating a training effectiveness evaluation"""

    user_id: UUID


class TrainingEffectivenessResponse(TrainingEffectivenessBase):
    """Schema for training effectiveness response"""

    id: UUID
    organization_id: UUID
    user_id: UUID
    knowledge_gain_percentage: Optional[float] = None
    evaluated_by: Optional[UUID] = None
    evaluated_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = _response_config

    @model_validator(mode="after")
    def ensure_utc(self) -> "TrainingEffectivenessResponse":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


class TrainingEffectivenessSummary(BaseModel):
    """Aggregate effectiveness metrics for a course or session"""

    course_id: Optional[UUID] = None
    session_id: Optional[UUID] = None
    course_name: Optional[str] = None
    total_evaluations: int
    avg_overall_rating: Optional[float] = None
    avg_knowledge_gain: Optional[float] = None
    avg_behavior_rating: Optional[float] = None
    completion_rate: Optional[float] = None
    evaluations_by_level: Dict[str, int] = Field(default_factory=dict)


# ============================================
# Multi-Agency Training Schemas
# ============================================


class ParticipatingOrganization(BaseModel):
    """Participating organization in multi-agency training"""

    name: str = Field(..., min_length=1, max_length=255)
    role: str = Field("participant", pattern=r"^(host|participant|observer|evaluator)$")
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    participant_count: Optional[int] = Field(None, ge=0)


class MultiAgencyTrainingBase(BaseModel):
    """Base multi-agency training schema"""

    exercise_name: str = Field(..., min_length=1, max_length=255)
    exercise_type: str = Field(
        ...,
        pattern=r"^(joint_training|mutual_aid_drill|regional_exercise|tabletop|full_scale)$",
    )
    description: Optional[str] = None
    training_session_id: Optional[UUID] = None
    training_record_id: Optional[UUID] = None
    participating_organizations: List[ParticipatingOrganization] = Field(
        ..., min_length=1
    )
    lead_agency: Optional[str] = Field(None, max_length=255)
    total_participants: Optional[int] = Field(None, ge=0)
    ics_position_assignments: Optional[List[Dict[str, Any]]] = None
    nims_compliant: bool = False
    after_action_report: Optional[str] = None
    lessons_learned: Optional[List[Dict[str, Any]]] = None
    mutual_aid_agreement_id: Optional[str] = Field(None, max_length=100)
    exercise_date: date


class MultiAgencyTrainingCreate(MultiAgencyTrainingBase):
    """Schema for creating a multi-agency training record"""


class MultiAgencyTrainingUpdate(BaseModel):
    """Schema for updating a multi-agency training record"""

    exercise_name: Optional[str] = Field(None, min_length=1, max_length=255)
    exercise_type: Optional[str] = Field(
        None,
        pattern=r"^(joint_training|mutual_aid_drill|regional_exercise|tabletop|full_scale)$",
    )
    description: Optional[str] = None
    participating_organizations: Optional[List[ParticipatingOrganization]] = None
    lead_agency: Optional[str] = Field(None, max_length=255)
    total_participants: Optional[int] = Field(None, ge=0)
    ics_position_assignments: Optional[List[Dict[str, Any]]] = None
    nims_compliant: Optional[bool] = None
    after_action_report: Optional[str] = None
    lessons_learned: Optional[List[Dict[str, Any]]] = None
    mutual_aid_agreement_id: Optional[str] = Field(None, max_length=100)


class MultiAgencyTrainingResponse(MultiAgencyTrainingBase):
    """Schema for multi-agency training response"""

    id: UUID
    organization_id: UUID
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None

    model_config = _response_config

    @model_validator(mode="after")
    def ensure_utc(self) -> "MultiAgencyTrainingResponse":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


# ============================================
# xAPI / SCORM Schemas
# ============================================


class XAPIStatementCreate(BaseModel):
    """Schema for ingesting an xAPI statement"""

    raw_statement: Dict[str, Any] = Field(...)  # Full xAPI statement JSON
    source_provider_id: Optional[UUID] = None


class XAPIBatchCreate(BaseModel):
    """Schema for batch ingesting xAPI statements"""

    statements: List[Dict[str, Any]] = Field(..., min_length=1, max_length=1000)
    source_provider_id: Optional[UUID] = None


class XAPIStatementResponse(BaseModel):
    """Schema for xAPI statement response"""

    id: UUID
    organization_id: UUID
    actor_email: Optional[str] = None
    actor_name: Optional[str] = None
    user_id: Optional[UUID] = None
    verb_id: str
    verb_display: Optional[str] = None
    object_id: str
    object_name: Optional[str] = None
    score_scaled: Optional[float] = None
    score_raw: Optional[float] = None
    success: Optional[bool] = None
    completion: Optional[bool] = None
    duration_seconds: Optional[int] = None
    context_platform: Optional[str] = None
    processed: bool
    training_record_id: Optional[UUID] = None
    statement_timestamp: datetime
    created_at: datetime

    model_config = _response_config

    @model_validator(mode="after")
    def ensure_utc(self) -> "XAPIStatementResponse":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


class XAPIBatchResponse(BaseModel):
    """Response after batch xAPI ingestion"""

    total: int
    accepted: int
    rejected: int
    errors: List[str] = Field(default_factory=list)


# ============================================
# Document/Certificate Upload Schemas
# ============================================


class DocumentUploadResponse(BaseModel):
    """Response after uploading a document"""

    file_id: str
    file_name: str
    file_size: int
    content_type: str
    upload_url: str
    created_at: datetime


class TrainingRecordAttachment(BaseModel):
    """Schema for a training record attachment"""

    file_id: str
    file_name: str
    file_size: int
    content_type: str
    url: str
    uploaded_at: datetime
    uploaded_by: Optional[UUID] = None


# ============================================
# Report Export Schemas
# ============================================


class ReportExportRequest(BaseModel):
    """Schema for requesting a report export"""

    report_type: str = Field(
        ...,
        pattern=r"^(compliance|individual|department|certification|hours_summary|state_report)$",
    )
    format: str = Field("csv", pattern=r"^(csv|pdf)$")
    user_id: Optional[UUID] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    include_details: bool = True
    filters: Optional[Dict[str, Any]] = None


class ReportExportResponse(BaseModel):
    """Response after generating a report export"""

    report_id: str
    report_type: str
    format: str
    file_name: str
    download_url: str
    generated_at: datetime
    record_count: int


class ComplianceForecast(BaseModel):
    """Predictive compliance forecast"""

    user_id: UUID
    user_name: Optional[str] = None
    current_compliance_percentage: float
    forecast_30_days: float
    forecast_60_days: float
    forecast_90_days: float
    at_risk_requirements: List[Dict[str, Any]] = Field(default_factory=list)
    expiring_certifications: List[Dict[str, Any]] = Field(default_factory=list)


class DepartmentComplianceTrend(BaseModel):
    """Historical compliance trend data"""

    period: str  # "2024-01", "2024-02", etc.
    compliance_percentage: float
    total_members: int
    compliant_members: int
    total_hours: float
    certifications_active: int
    certifications_expired: int

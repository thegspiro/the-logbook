"""
Membership Pipeline Pydantic Schemas

Request and response schemas for the prospective member pipeline endpoints.
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Dict, Any
from datetime import datetime, date
from uuid import UUID


# --- Pipeline Schemas ---

class PipelineStepBase(BaseModel):
    """Base schema for a pipeline step"""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    step_type: str = Field(default="checkbox", description="Step type: action, checkbox, note")
    action_type: Optional[str] = Field(None, description="Action type: send_email, schedule_meeting, collect_document, custom")
    is_first_step: bool = False
    is_final_step: bool = False
    sort_order: int = Field(default=0, ge=0)
    email_template_id: Optional[UUID] = None
    required: bool = True
    config: Optional[Dict[str, Any]] = Field(None, description="Stage-specific configuration (form settings, election config, etc.)")
    inactivity_timeout_days: Optional[int] = Field(None, description="Per-step inactivity timeout override in days")


class PipelineStepCreate(PipelineStepBase):
    """Schema for creating a pipeline step"""
    pass


class PipelineStepUpdate(BaseModel):
    """Schema for updating a pipeline step"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    step_type: Optional[str] = None
    action_type: Optional[str] = None
    is_first_step: Optional[bool] = None
    is_final_step: Optional[bool] = None
    sort_order: Optional[int] = Field(None, ge=0)
    email_template_id: Optional[UUID] = None
    required: Optional[bool] = None
    config: Optional[Dict[str, Any]] = None
    inactivity_timeout_days: Optional[int] = None


class PipelineStepResponse(PipelineStepBase):
    """Schema for pipeline step response"""
    id: UUID
    pipeline_id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PipelineBase(BaseModel):
    """Base schema for a membership pipeline"""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    is_template: bool = False
    is_default: bool = False
    is_active: bool = True
    auto_transfer_on_approval: bool = False
    inactivity_config: Optional[Dict[str, Any]] = Field(None, description="Inactivity timeout and notification settings")


class PipelineCreate(PipelineBase):
    """Schema for creating a pipeline"""
    steps: Optional[List[PipelineStepCreate]] = Field(None, description="Optional initial steps")


class PipelineUpdate(BaseModel):
    """Schema for updating a pipeline"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None
    auto_transfer_on_approval: Optional[bool] = None
    inactivity_config: Optional[Dict[str, Any]] = None


class PipelineResponse(PipelineBase):
    """Schema for pipeline response"""
    id: UUID
    organization_id: UUID
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime
    steps: List[PipelineStepResponse] = []
    prospect_count: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)


class PipelineListResponse(BaseModel):
    """Schema for pipeline list item"""
    id: UUID
    name: str
    description: Optional[str] = None
    is_template: bool
    is_default: bool
    is_active: bool = True
    auto_transfer_on_approval: bool
    step_count: Optional[int] = None
    prospect_count: Optional[int] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class StepReorderRequest(BaseModel):
    """Schema for reordering steps"""
    step_ids: List[UUID] = Field(..., description="Ordered list of step IDs")


# --- Pipeline Stats Schema ---

class PipelineStageStats(BaseModel):
    """Stats for a single pipeline stage"""
    stage_id: UUID
    stage_name: str
    count: int = 0


class PipelineStatsResponse(BaseModel):
    """Pipeline statistics"""
    pipeline_id: UUID
    total_prospects: int = 0
    active_count: int = 0
    approved_count: int = 0
    rejected_count: int = 0
    withdrawn_count: int = 0
    transferred_count: int = 0
    by_step: List[PipelineStageStats] = []
    avg_days_to_transfer: Optional[float] = None
    conversion_rate: Optional[float] = None


class PurgeInactiveRequest(BaseModel):
    """Schema for purging inactive prospects"""
    prospect_ids: Optional[List[UUID]] = Field(None, description="Specific prospect IDs to purge, or all inactive if empty")
    confirm: bool = Field(default=False, description="Must be true to execute purge")


class PurgeInactiveResponse(BaseModel):
    """Response after purging inactive prospects"""
    purged_count: int
    message: str


# --- Prospective Member Schemas ---

class ProspectBase(BaseModel):
    """Base schema for a prospective member"""
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., min_length=1, max_length=255)
    phone: Optional[str] = Field(None, max_length=20)
    mobile: Optional[str] = Field(None, max_length=20)
    date_of_birth: Optional[date] = None
    address_street: Optional[str] = Field(None, max_length=255)
    address_city: Optional[str] = Field(None, max_length=100)
    address_state: Optional[str] = Field(None, max_length=50)
    address_zip: Optional[str] = Field(None, max_length=20)
    interest_reason: Optional[str] = None
    referral_source: Optional[str] = Field(None, max_length=255)
    referred_by: Optional[UUID] = None
    notes: Optional[str] = None


class ProspectCreate(ProspectBase):
    """Schema for creating a prospective member"""
    pipeline_id: Optional[UUID] = Field(None, description="Pipeline to assign, uses org default if not specified")
    metadata_: Optional[Dict[str, Any]] = Field(None, alias="metadata")


class ProspectUpdate(BaseModel):
    """Schema for updating a prospective member"""
    first_name: Optional[str] = Field(None, min_length=1, max_length=100)
    last_name: Optional[str] = Field(None, min_length=1, max_length=100)
    email: Optional[str] = Field(None, min_length=1, max_length=255)
    phone: Optional[str] = Field(None, max_length=20)
    mobile: Optional[str] = Field(None, max_length=20)
    date_of_birth: Optional[date] = None
    address_street: Optional[str] = Field(None, max_length=255)
    address_city: Optional[str] = Field(None, max_length=100)
    address_state: Optional[str] = Field(None, max_length=50)
    address_zip: Optional[str] = Field(None, max_length=20)
    interest_reason: Optional[str] = None
    referral_source: Optional[str] = Field(None, max_length=255)
    referred_by: Optional[UUID] = None
    notes: Optional[str] = None
    status: Optional[str] = Field(None, description="Status: active, approved, rejected, withdrawn")


class StepProgressResponse(BaseModel):
    """Schema for step progress record"""
    id: UUID
    prospect_id: UUID
    step_id: UUID
    status: str
    completed_at: Optional[datetime] = None
    completed_by: Optional[UUID] = None
    notes: Optional[str] = None
    action_result: Optional[Dict[str, Any]] = None
    step: Optional[PipelineStepResponse] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProspectResponse(ProspectBase):
    """Schema for prospective member response"""
    id: UUID
    organization_id: UUID
    pipeline_id: Optional[UUID] = None
    current_step_id: Optional[UUID] = None
    status: str
    metadata_: Optional[Dict[str, Any]] = Field(None, alias="metadata")
    form_submission_id: Optional[UUID] = None
    transferred_user_id: Optional[UUID] = None
    transferred_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    # Enriched fields
    current_step: Optional[PipelineStepResponse] = None
    step_progress: Optional[List[StepProgressResponse]] = None
    pipeline_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class ProspectListResponse(BaseModel):
    """Schema for prospect list item"""
    id: UUID
    first_name: str
    last_name: str
    email: str
    phone: Optional[str] = None
    status: str
    pipeline_id: Optional[UUID] = None
    pipeline_name: Optional[str] = None
    current_step_id: Optional[UUID] = None
    current_step_name: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# --- Step Completion Schemas ---

class CompleteStepRequest(BaseModel):
    """Schema for completing a pipeline step for a prospect"""
    step_id: UUID
    notes: Optional[str] = None
    action_result: Optional[Dict[str, Any]] = None


class AdvanceProspectRequest(BaseModel):
    """Schema for advancing a prospect to the next step"""
    notes: Optional[str] = Field(None, description="Optional notes for the advancement")


# --- Transfer Schema ---

class TransferProspectRequest(BaseModel):
    """Schema for transferring a prospect to full membership"""
    username: Optional[str] = Field(None, description="Username for the new member account, auto-generated if not provided")
    membership_id: Optional[str] = Field(None, description="Membership ID to assign; auto-assigned if not provided and membership ID is enabled")
    rank: Optional[str] = Field(None, description="Initial rank to assign")
    station: Optional[str] = Field(None, description="Station to assign")
    role_ids: Optional[List[UUID]] = Field(None, description="Role IDs to assign to the new member")
    send_welcome_email: bool = Field(default=False, description="Send welcome email with credentials")
    department_email: Optional[str] = Field(None, description="Department email to assign. If not provided and org has an email domain, one is auto-generated.")
    use_personal_as_primary: bool = Field(default=False, description="If true, use the prospect's personal email as the member's primary email instead of a department email")


class TransferProspectResponse(BaseModel):
    """Response after transferring a prospect"""
    success: bool
    prospect_id: Optional[UUID] = None
    user_id: Optional[UUID] = None
    membership_number: Optional[str] = None
    message: str
    existing_member_match: Optional[Dict[str, Any]] = None
    auto_enrollment: Optional[Dict[str, Any]] = None


# --- Activity Log Schema ---

class ActivityLogResponse(BaseModel):
    """Schema for activity log entry"""
    id: UUID
    prospect_id: UUID
    action: str
    details: Optional[Dict[str, Any]] = None
    performed_by: Optional[UUID] = None
    performer_name: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# --- Kanban Board Schema ---

class PipelineKanbanColumn(BaseModel):
    """Schema for a kanban board column (one per step)"""
    step: PipelineStepResponse
    prospects: List[ProspectListResponse] = []
    count: int = 0


class PipelineKanbanResponse(BaseModel):
    """Schema for the full kanban board view"""
    pipeline: PipelineListResponse
    columns: List[PipelineKanbanColumn] = []
    total_prospects: int = 0


# --- Document Schemas ---

class ProspectDocumentResponse(BaseModel):
    """Schema for a prospect document"""
    id: UUID
    prospect_id: UUID
    step_id: Optional[UUID] = None
    document_type: str
    file_name: str
    file_path: str
    file_size: int = 0
    mime_type: Optional[str] = None
    uploaded_by: Optional[UUID] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# --- Election Package Schemas ---

class ElectionPackageCreate(BaseModel):
    """Schema for creating an election package"""
    prospect_id: UUID
    pipeline_id: Optional[UUID] = None
    step_id: Optional[UUID] = None
    coordinator_notes: Optional[str] = None
    package_config: Optional[Dict[str, Any]] = None


class ElectionPackageUpdate(BaseModel):
    """Schema for updating an election package"""
    status: Optional[str] = None
    coordinator_notes: Optional[str] = None
    package_config: Optional[Dict[str, Any]] = None
    applicant_snapshot: Optional[Dict[str, Any]] = None


class ElectionPackageResponse(BaseModel):
    """Schema for an election package"""
    id: UUID
    prospect_id: UUID
    pipeline_id: Optional[UUID] = None
    step_id: Optional[UUID] = None
    election_id: Optional[UUID] = None
    status: str
    applicant_snapshot: Optional[Dict[str, Any]] = None
    coordinator_notes: Optional[str] = None
    package_config: Optional[Dict[str, Any]] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# --- Interview Schemas ---

class InterviewQuestionItem(BaseModel):
    """A single interview question with optional answer"""
    text: str = Field(..., min_length=1)
    type: str = Field(default="freeform", description="Question type: preset or freeform")
    answer: Optional[str] = None


class InterviewCreate(BaseModel):
    """Schema for creating/scheduling an interview"""
    step_id: UUID
    scheduled_at: Optional[datetime] = None
    location: Optional[str] = Field(None, max_length=255)
    interviewer_ids: List[UUID] = Field(default_factory=list, description="User IDs of department members conducting the interview")
    questions: Optional[List[InterviewQuestionItem]] = Field(None, description="Questions to ask — preset from step config or custom")


class InterviewUpdate(BaseModel):
    """Schema for updating an interview"""
    scheduled_at: Optional[datetime] = None
    location: Optional[str] = Field(None, max_length=255)
    interviewer_ids: Optional[List[UUID]] = None
    questions: Optional[List[InterviewQuestionItem]] = None
    notes: Optional[str] = None
    status: Optional[str] = Field(None, description="Status: scheduled, in_progress, completed, cancelled")


class InterviewResponse(BaseModel):
    """Schema for an interview record"""
    id: UUID
    prospect_id: UUID
    step_id: Optional[UUID] = None
    scheduled_at: Optional[datetime] = None
    location: Optional[str] = None
    status: str
    interviewer_ids: List[str] = []
    interviewer_names: Optional[List[str]] = None
    questions: Optional[List[Dict[str, Any]]] = None
    notes: Optional[str] = None
    completed_at: Optional[datetime] = None
    completed_by: Optional[UUID] = None
    step_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class InterviewHistoryResponse(BaseModel):
    """All interview records for a prospect, for reviewing previous interviews"""
    prospect_id: UUID
    prospect_name: str
    interviews: List[InterviewResponse] = []


# --- Reference Check Schemas ---

class ReferenceCheckCreate(BaseModel):
    """Schema for creating a reference check"""
    step_id: UUID
    reference_name: str = Field(..., min_length=1, max_length=200)
    reference_phone: Optional[str] = Field(None, max_length=20)
    reference_email: Optional[str] = Field(None, max_length=255)
    reference_relationship: Optional[str] = Field(None, max_length=100)
    questions: Optional[List[InterviewQuestionItem]] = None


class ReferenceCheckUpdate(BaseModel):
    """Schema for updating a reference check"""
    reference_name: Optional[str] = Field(None, min_length=1, max_length=200)
    reference_phone: Optional[str] = Field(None, max_length=20)
    reference_email: Optional[str] = Field(None, max_length=255)
    reference_relationship: Optional[str] = Field(None, max_length=100)
    contact_method: Optional[str] = Field(None, description="Contact method: phone, email, in_person")
    status: Optional[str] = Field(None, description="Status: pending, attempted, completed, unable_to_reach")
    questions: Optional[List[InterviewQuestionItem]] = None
    notes: Optional[str] = None
    verification_result: Optional[str] = Field(None, description="Result: positive, negative, neutral")


class ReferenceCheckResponse(BaseModel):
    """Schema for a reference check record"""
    id: UUID
    prospect_id: UUID
    step_id: Optional[UUID] = None
    reference_name: str
    reference_phone: Optional[str] = None
    reference_email: Optional[str] = None
    reference_relationship: Optional[str] = None
    contact_method: Optional[str] = None
    status: str
    contacted_at: Optional[datetime] = None
    contacted_by: Optional[UUID] = None
    questions: Optional[List[Dict[str, Any]]] = None
    notes: Optional[str] = None
    verification_result: Optional[str] = None
    step_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# --- Transfer Schema Update ---

class TransferEmailConfig(BaseModel):
    """Email configuration for the transfer/conversion step"""
    department_email: Optional[str] = Field(None, description="Department-assigned email (auto-generated from org domain if configured)")
    use_personal_as_primary: bool = Field(default=False, description="Use the prospect's email as the primary member email")

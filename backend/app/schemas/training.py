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


class RequirementType(str, Enum):
    """Type of training requirement"""
    HOURS = "hours"
    COURSES = "courses"
    CERTIFICATION = "certification"
    SHIFTS = "shifts"
    CALLS = "calls"
    SKILLS_EVALUATION = "skills_evaluation"
    CHECKLIST = "checklist"
    KNOWLEDGE_TEST = "knowledge_test"


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
    prerequisites: Optional[List[str]] = None
    expiration_months: Optional[int] = Field(None, ge=0)
    instructor: Optional[str] = Field(None, max_length=255)
    max_participants: Optional[int] = Field(None, ge=1)
    materials_required: Optional[List[str]] = None
    category_ids: Optional[List[str]] = None  # Categories this course belongs to


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
    prerequisites: Optional[List[str]] = None
    expiration_months: Optional[int] = Field(None, ge=0)
    instructor: Optional[str] = Field(None, max_length=255)
    max_participants: Optional[int] = Field(None, ge=1)
    materials_required: Optional[List[str]] = None
    category_ids: Optional[List[str]] = None
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
    requirement_type: RequirementType
    training_type: Optional[str] = None
    required_hours: Optional[float] = Field(None, ge=0)
    required_courses: Optional[List[str]] = None
    frequency: str
    year: Optional[int] = Field(None, ge=2020, le=2100)
    applies_to_all: bool = True
    required_roles: Optional[List[str]] = None
    start_date: Optional[date] = None
    due_date: Optional[date] = None
    # Due date calculation fields
    due_date_type: DueDateType = DueDateType.CALENDAR_PERIOD
    rolling_period_months: Optional[int] = Field(None, ge=1, le=120)  # 1-10 years
    period_start_month: int = Field(1, ge=1, le=12)  # Month period starts (1=January)
    period_start_day: int = Field(1, ge=1, le=31)  # Day period starts
    # Category requirements - training in these categories satisfies this requirement
    category_ids: Optional[List[str]] = None


class TrainingRequirementCreate(TrainingRequirementBase):
    """Schema for creating a new training requirement"""
    pass


class TrainingRequirementUpdate(BaseModel):
    """Schema for updating a training requirement"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    requirement_type: Optional[RequirementType] = None
    training_type: Optional[str] = None
    required_hours: Optional[float] = Field(None, ge=0)
    required_courses: Optional[List[str]] = None
    frequency: Optional[str] = None
    year: Optional[int] = Field(None, ge=2020, le=2100)
    applies_to_all: Optional[bool] = None
    required_roles: Optional[List[str]] = None
    start_date: Optional[date] = None
    due_date: Optional[date] = None
    # Due date calculation fields
    due_date_type: Optional[DueDateType] = None
    rolling_period_months: Optional[int] = Field(None, ge=1, le=120)
    period_start_month: Optional[int] = Field(None, ge=1, le=12)
    period_start_day: Optional[int] = Field(None, ge=1, le=31)
    category_ids: Optional[List[str]] = None
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


# ============================================
# External Training Integration Schemas
# ============================================


class ExternalProviderType(str, Enum):
    """Supported external training providers"""
    VECTOR_SOLUTIONS = "vector_solutions"
    TARGET_SOLUTIONS = "target_solutions"
    LEXIPOL = "lexipol"
    I_AM_RESPONDING = "i_am_responding"
    CUSTOM_API = "custom_api"


class SyncStatus(str, Enum):
    """Status of sync operations"""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    PARTIAL = "partial"


class ImportStatus(str, Enum):
    """Status of individual record imports"""
    PENDING = "pending"
    IMPORTED = "imported"
    FAILED = "failed"
    SKIPPED = "skipped"
    DUPLICATE = "duplicate"


# External Training Provider Schemas

class ExternalProviderConfig(BaseModel):
    """Provider-specific configuration"""
    # Vector Solutions / TargetSolutions specific
    site_id: Optional[str] = None  # Required for Vector Solutions - the TS site identifier
    page_size: Optional[int] = Field(None, ge=1, le=1000)  # Max records per page (VS max: 1000)
    date_filter_param: Optional[str] = None  # Custom date filter parameter name

    # General endpoint overrides
    records_endpoint: Optional[str] = None  # Override default records endpoint path
    users_endpoint: Optional[str] = None  # Override default users endpoint path
    categories_endpoint: Optional[str] = None  # Override default categories endpoint path
    test_endpoint: Optional[str] = None  # Override default connection test endpoint

    # Custom API support
    param_mapping: Optional[dict] = None  # Map standard param names to provider-specific names
    field_mapping: Optional[dict] = None  # Map standard field names to provider-specific names
    records_path: Optional[str] = None  # JSON path to records array in response (e.g. "data.records")
    additional_headers: Optional[dict] = None
    date_format: Optional[str] = None  # Date format used by the API


class ExternalTrainingProviderBase(BaseModel):
    """Base external training provider schema"""
    name: str = Field(..., min_length=1, max_length=255)
    provider_type: ExternalProviderType
    description: Optional[str] = None
    api_base_url: Optional[str] = Field(None, max_length=500)
    auth_type: str = Field("api_key", pattern=r'^(api_key|oauth2|basic)$')
    config: Optional[ExternalProviderConfig] = None
    auto_sync_enabled: bool = False
    sync_interval_hours: int = Field(24, ge=1, le=168)  # 1 hour to 1 week
    default_category_id: Optional[UUID] = None


class ExternalTrainingProviderCreate(ExternalTrainingProviderBase):
    """Schema for creating a new external training provider"""
    api_key: Optional[str] = None
    api_secret: Optional[str] = None
    client_id: Optional[str] = Field(None, max_length=255)
    client_secret: Optional[str] = None


class ExternalTrainingProviderUpdate(BaseModel):
    """Schema for updating an external training provider"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    api_base_url: Optional[str] = Field(None, max_length=500)
    api_key: Optional[str] = None
    api_secret: Optional[str] = None
    client_id: Optional[str] = Field(None, max_length=255)
    client_secret: Optional[str] = None
    auth_type: Optional[str] = Field(None, pattern=r'^(api_key|oauth2|basic)$')
    config: Optional[ExternalProviderConfig] = None
    auto_sync_enabled: Optional[bool] = None
    sync_interval_hours: Optional[int] = Field(None, ge=1, le=168)
    default_category_id: Optional[UUID] = None
    active: Optional[bool] = None


class ExternalTrainingProviderResponse(ExternalTrainingProviderBase):
    """Schema for external training provider response"""
    id: UUID
    organization_id: UUID
    active: bool
    connection_verified: bool
    last_connection_test: Optional[datetime] = None
    connection_error: Optional[str] = None
    last_sync_at: Optional[datetime] = None
    next_sync_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None
    # Note: api_key, api_secret, client_secret are never returned for security

    model_config = ConfigDict(from_attributes=True)


# External Category Mapping Schemas

class ExternalCategoryMappingBase(BaseModel):
    """Base external category mapping schema"""
    external_category_id: str = Field(..., max_length=255)
    external_category_name: str = Field(..., max_length=255)
    external_category_code: Optional[str] = Field(None, max_length=100)
    internal_category_id: Optional[UUID] = None


class ExternalCategoryMappingCreate(ExternalCategoryMappingBase):
    """Schema for creating a new external category mapping"""
    pass


class ExternalCategoryMappingUpdate(BaseModel):
    """Schema for updating an external category mapping"""
    internal_category_id: Optional[UUID] = None
    is_mapped: Optional[bool] = None


class ExternalCategoryMappingResponse(ExternalCategoryMappingBase):
    """Schema for external category mapping response"""
    id: UUID
    provider_id: UUID
    organization_id: UUID
    is_mapped: bool
    auto_mapped: bool
    created_at: datetime
    updated_at: datetime
    mapped_by: Optional[UUID] = None
    # Include internal category details for convenience
    internal_category_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


# External User Mapping Schemas

class ExternalUserMappingBase(BaseModel):
    """Base external user mapping schema"""
    external_user_id: str = Field(..., max_length=255)
    external_username: Optional[str] = Field(None, max_length=255)
    external_email: Optional[str] = Field(None, max_length=255)
    external_name: Optional[str] = Field(None, max_length=255)
    internal_user_id: Optional[UUID] = None


class ExternalUserMappingCreate(ExternalUserMappingBase):
    """Schema for creating a new external user mapping"""
    pass


class ExternalUserMappingUpdate(BaseModel):
    """Schema for updating an external user mapping"""
    internal_user_id: Optional[UUID] = None
    is_mapped: Optional[bool] = None


class ExternalUserMappingResponse(ExternalUserMappingBase):
    """Schema for external user mapping response"""
    id: UUID
    provider_id: UUID
    organization_id: UUID
    is_mapped: bool
    auto_mapped: bool
    created_at: datetime
    updated_at: datetime
    mapped_by: Optional[UUID] = None
    # Include internal user details for convenience
    internal_user_name: Optional[str] = None
    internal_user_email: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


# Sync Log Schemas

class ExternalTrainingSyncLogResponse(BaseModel):
    """Schema for external training sync log response"""
    id: UUID
    provider_id: UUID
    organization_id: UUID
    sync_type: str
    status: SyncStatus
    started_at: datetime
    completed_at: Optional[datetime] = None
    records_fetched: int
    records_imported: int
    records_updated: int
    records_skipped: int
    records_failed: int
    error_message: Optional[str] = None
    sync_from_date: Optional[date] = None
    sync_to_date: Optional[date] = None
    created_at: datetime
    initiated_by: Optional[UUID] = None

    model_config = ConfigDict(from_attributes=True)


# External Training Import Schemas

class ExternalTrainingImportResponse(BaseModel):
    """Schema for external training import response"""
    id: UUID
    provider_id: UUID
    organization_id: UUID
    sync_log_id: Optional[UUID] = None
    external_record_id: str
    external_user_id: Optional[str] = None
    course_title: str
    course_code: Optional[str] = None
    description: Optional[str] = None
    duration_minutes: Optional[int] = None
    completion_date: Optional[datetime] = None
    score: Optional[float] = None
    passed: Optional[bool] = None
    external_category_name: Optional[str] = None
    training_record_id: Optional[UUID] = None
    user_id: Optional[UUID] = None
    import_status: str
    import_error: Optional[str] = None
    imported_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# Sync Request/Response Schemas

class SyncRequest(BaseModel):
    """Request to trigger a sync operation"""
    sync_type: str = Field("incremental", pattern=r'^(full|incremental)$')
    from_date: Optional[date] = None  # For incremental sync
    to_date: Optional[date] = None


class SyncResponse(BaseModel):
    """Response after initiating a sync"""
    sync_log_id: Optional[UUID] = None  # May be None for background tasks
    status: SyncStatus
    message: str
    records_fetched: int = 0
    records_imported: int = 0
    records_failed: int = 0


class TestConnectionResponse(BaseModel):
    """Response after testing provider connection"""
    success: bool
    message: str
    details: Optional[dict] = None


class ImportRecordRequest(BaseModel):
    """Request to import a specific external record"""
    external_import_id: UUID
    user_id: UUID  # Internal user to assign record to
    category_id: Optional[UUID] = None  # Override category


class BulkImportRequest(BaseModel):
    """Request to bulk import external records"""
    external_import_ids: List[UUID] = Field(..., max_length=500)
    auto_map_users: bool = True  # Try to match users by email
    default_category_id: Optional[UUID] = None


class BulkImportResponse(BaseModel):
    """Response after bulk import"""
    total: int
    imported: int
    skipped: int
    failed: int
    errors: List[str]


# ============================================
# Historical Training Import Schemas
# ============================================


class HistoricalImportParsedRow(BaseModel):
    """A single parsed row from the CSV with match status"""
    row_number: int
    email: Optional[str] = None
    membership_number: Optional[str] = None
    member_name: Optional[str] = None  # Display name from CSV (if available)
    user_id: Optional[str] = None  # Matched internal user ID
    matched_member_name: Optional[str] = None  # Name from system for matched user
    member_matched: bool = False
    course_name: str
    course_code: Optional[str] = None
    course_matched: bool = False
    matched_course_id: Optional[str] = None
    training_type: Optional[str] = None
    completion_date: Optional[date] = None
    expiration_date: Optional[date] = None
    hours_completed: Optional[float] = None
    credit_hours: Optional[float] = None
    certification_number: Optional[str] = None
    issuing_agency: Optional[str] = None
    instructor: Optional[str] = None
    location: Optional[str] = None
    score: Optional[float] = None
    passed: Optional[bool] = None
    notes: Optional[str] = None
    errors: List[str] = []


class UnmatchedCourse(BaseModel):
    """A course from the CSV that doesn't match any existing course"""
    csv_course_name: str
    csv_course_code: Optional[str] = None
    occurrences: int = 1


class HistoricalImportParseResponse(BaseModel):
    """Response from parsing a historical training CSV"""
    total_rows: int
    valid_rows: int
    members_matched: int
    members_unmatched: int
    courses_matched: int
    unmatched_courses: List[UnmatchedCourse]
    column_headers: List[str]
    rows: List[HistoricalImportParsedRow]
    parse_errors: List[str] = []


class CourseMappingEntry(BaseModel):
    """Maps a CSV course to an existing course or creates a new one"""
    csv_course_name: str
    action: str = Field(..., pattern=r'^(map_existing|create_new|skip)$')
    existing_course_id: Optional[str] = None  # If action == map_existing
    new_training_type: Optional[str] = None  # If action == create_new


class HistoricalImportConfirmRequest(BaseModel):
    """Request to confirm and execute a historical import"""
    rows: List[HistoricalImportParsedRow]
    course_mappings: List[CourseMappingEntry] = []
    default_training_type: str = "continuing_education"
    default_status: str = "completed"


class HistoricalImportResult(BaseModel):
    """Result of a confirmed historical import"""
    total: int
    imported: int
    skipped: int
    failed: int
    errors: List[str]

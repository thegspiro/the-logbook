"""
Forms Pydantic Schemas

Request and response schemas for forms-related endpoints.
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Dict, Any
from datetime import datetime
from uuid import UUID


# ============================================
# Form Field Schemas
# ============================================

class FormFieldOption(BaseModel):
    """Option for select/radio/checkbox fields"""
    value: str
    label: str


class FormFieldBase(BaseModel):
    """Base form field schema"""
    label: str = Field(..., min_length=1, max_length=255)
    field_type: str
    placeholder: Optional[str] = Field(None, max_length=255)
    help_text: Optional[str] = None
    default_value: Optional[str] = None
    required: bool = False
    min_length: Optional[int] = Field(None, ge=0)
    max_length: Optional[int] = Field(None, ge=1)
    min_value: Optional[int] = None
    max_value: Optional[int] = None
    validation_pattern: Optional[str] = Field(None, max_length=500)
    options: Optional[List[FormFieldOption]] = None
    sort_order: int = Field(default=0, ge=0)
    width: str = Field(default="full", pattern="^(full|half|third)$")


class FormFieldCreate(FormFieldBase):
    """Schema for creating a form field"""
    pass


class FormFieldUpdate(BaseModel):
    """Schema for updating a form field"""
    label: Optional[str] = Field(None, min_length=1, max_length=255)
    field_type: Optional[str] = None
    placeholder: Optional[str] = Field(None, max_length=255)
    help_text: Optional[str] = None
    default_value: Optional[str] = None
    required: Optional[bool] = None
    min_length: Optional[int] = Field(None, ge=0)
    max_length: Optional[int] = Field(None, ge=1)
    min_value: Optional[int] = None
    max_value: Optional[int] = None
    validation_pattern: Optional[str] = Field(None, max_length=500)
    options: Optional[List[FormFieldOption]] = None
    sort_order: Optional[int] = Field(None, ge=0)
    width: Optional[str] = None


class FormFieldResponse(FormFieldBase):
    """Schema for form field response"""
    id: UUID
    form_id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ============================================
# Form Schemas
# ============================================

class FormBase(BaseModel):
    """Base form schema"""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    category: str = "Operations"
    allow_multiple_submissions: bool = True
    require_authentication: bool = True
    notify_on_submission: bool = False
    notification_emails: Optional[List[str]] = None


class FormCreate(FormBase):
    """Schema for creating a new form"""
    fields: Optional[List[FormFieldCreate]] = None


class FormUpdate(BaseModel):
    """Schema for updating a form"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    category: Optional[str] = None
    status: Optional[str] = None
    allow_multiple_submissions: Optional[bool] = None
    require_authentication: Optional[bool] = None
    notify_on_submission: Optional[bool] = None
    notification_emails: Optional[List[str]] = None


class FormResponse(FormBase):
    """Schema for form response"""
    id: UUID
    organization_id: UUID
    status: str
    version: int
    is_template: bool
    created_at: datetime
    updated_at: datetime
    published_at: Optional[datetime] = None
    created_by: Optional[UUID] = None
    field_count: Optional[int] = None
    submission_count: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)


class FormDetailResponse(FormResponse):
    """Extended form response with fields"""
    fields: List[FormFieldResponse] = []

    model_config = ConfigDict(from_attributes=True)


class FormsListResponse(BaseModel):
    """Schema for paginated forms list"""
    forms: List[FormResponse]
    total: int
    skip: int
    limit: int


# ============================================
# Submission Schemas
# ============================================

class FormSubmissionCreate(BaseModel):
    """Schema for submitting a form"""
    data: Dict[str, Any]  # {field_id: value}


class FormSubmissionResponse(BaseModel):
    """Schema for submission response"""
    id: UUID
    organization_id: UUID
    form_id: UUID
    submitted_by: Optional[UUID] = None
    submitted_at: datetime
    data: Dict[str, Any]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class FormSubmissionDetailResponse(FormSubmissionResponse):
    """Extended submission with submitter info"""
    submitter_name: Optional[str] = None
    form_name: Optional[str] = None


class SubmissionsListResponse(BaseModel):
    """Schema for paginated submissions list"""
    submissions: List[FormSubmissionResponse]
    total: int
    skip: int
    limit: int


# ============================================
# Summary Schemas
# ============================================

class FormsSummary(BaseModel):
    """Schema for forms module summary"""
    total_forms: int
    published_forms: int
    draft_forms: int
    total_submissions: int
    submissions_this_month: int

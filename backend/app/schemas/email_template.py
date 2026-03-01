"""
Email Template Schemas

Pydantic schemas for email template API requests and responses.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class TemplateVariable(BaseModel):
    """Describes an available template variable"""

    name: str
    description: str


class EmailAttachmentResponse(BaseModel):
    """Response schema for an email attachment"""

    id: str
    filename: str
    content_type: str
    file_size: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class EmailTemplateResponse(BaseModel):
    """Response schema for an email template"""

    id: str
    organization_id: str
    template_type: str
    name: str
    description: Optional[str] = None
    subject: str
    html_body: str
    text_body: Optional[str] = None
    css_styles: Optional[str] = None
    is_active: bool
    allow_attachments: bool
    available_variables: List[TemplateVariable] = []
    attachments: List[EmailAttachmentResponse] = []
    created_at: datetime
    updated_at: datetime
    created_by: Optional[str] = None
    updated_by: Optional[str] = None

    model_config = {"from_attributes": True}


class EmailTemplateUpdate(BaseModel):
    """Schema for updating an email template"""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    subject: Optional[str] = Field(None, min_length=1, max_length=500)
    html_body: Optional[str] = Field(None, min_length=1)
    text_body: Optional[str] = None
    css_styles: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None
    allow_attachments: Optional[bool] = None


class EmailTemplatePreviewRequest(BaseModel):
    """Request schema for previewing a rendered email template.

    If ``context`` is not provided (or is empty), the preview endpoint
    will automatically populate it with type-appropriate sample data
    from ``SAMPLE_CONTEXT`` in the email template service.
    """

    subject: Optional[str] = None
    html_body: Optional[str] = None
    text_body: Optional[str] = None
    css_styles: Optional[str] = None
    context: Dict[str, Any] = Field(default_factory=dict)


class EmailTemplatePreviewResponse(BaseModel):
    """Response schema for a rendered email preview"""

    subject: str
    html_body: str
    text_body: Optional[str] = None

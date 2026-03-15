"""
Email Template Schemas

Pydantic schemas for email template API requests and responses.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.schemas.base import stamp_naive_datetimes_utc


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

    @model_validator(mode="after")
    def ensure_utc(self) -> "EmailAttachmentResponse":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


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
    default_cc: Optional[List[str]] = None
    default_bcc: Optional[List[str]] = None
    available_variables: List[TemplateVariable] = []
    attachments: List[EmailAttachmentResponse] = []
    created_at: datetime
    updated_at: datetime
    created_by: Optional[str] = None
    updated_by: Optional[str] = None

    model_config = {"from_attributes": True}

    @model_validator(mode="after")
    def ensure_utc(self) -> "EmailTemplateResponse":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


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
    default_cc: Optional[List[str]] = None
    default_bcc: Optional[List[str]] = None


class EmailTemplatePreviewRequest(BaseModel):
    """Request schema for previewing a rendered email template.

    If ``context`` is not provided (or is empty), the preview endpoint
    will automatically populate it with type-appropriate sample data
    from ``SAMPLE_CONTEXT`` in the email template service.

    If ``member_id`` is provided, the preview will use real member data
    (name, email, etc.) instead of static sample values.
    """

    subject: Optional[str] = None
    html_body: Optional[str] = None
    text_body: Optional[str] = None
    css_styles: Optional[str] = None
    context: Dict[str, Any] = Field(default_factory=dict)
    member_id: Optional[str] = Field(
        None, description="Optional member ID to populate preview with real member data"
    )


class EmailTemplatePreviewResponse(BaseModel):
    """Response schema for a rendered email preview"""

    subject: str
    html_body: str
    text_body: Optional[str] = None


# --- Scheduled Email schemas ---


class ScheduledEmailCreate(BaseModel):
    """Request schema for scheduling an email"""

    template_type: str = Field(..., description="Email template type to use")
    template_id: Optional[str] = Field(
        None, description="Specific template ID (optional)"
    )
    to_emails: List[EmailStr] = Field(..., min_length=1)
    cc_emails: Optional[List[EmailStr]] = None
    bcc_emails: Optional[List[EmailStr]] = None
    context: Dict[str, Any] = Field(default_factory=dict)
    scheduled_at: datetime = Field(
        ..., description="When to send the email (UTC datetime)"
    )


class ScheduledEmailUpdate(BaseModel):
    """Request schema for updating a scheduled email"""

    scheduled_at: Optional[datetime] = None
    status: Optional[str] = Field(None, description="Set to 'cancelled' to cancel")


class ScheduledEmailResponse(BaseModel):
    """Response schema for a scheduled email"""

    id: str
    organization_id: str
    template_id: Optional[str] = None
    template_type: str
    to_emails: List[str]
    cc_emails: Optional[List[str]] = None
    bcc_emails: Optional[List[str]] = None
    context: Dict[str, Any] = {}
    scheduled_at: datetime
    status: str
    sent_at: Optional[datetime] = None
    error_message: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("scheduled_at", "sent_at", "created_at", "updated_at", mode="before")
    @classmethod
    def ensure_utc_timezone(cls, v: datetime | None) -> datetime | None:
        """Attach UTC tzinfo to naive datetimes returned by MySQL."""
        if v is None:
            return v
        if isinstance(v, datetime) and v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v


# --- Message History schemas ---


class MessageHistoryResponse(BaseModel):
    """Response schema for a sent message log entry"""

    id: str
    organization_id: Optional[str] = None
    to_email: str
    cc_emails: Optional[List[str]] = None
    bcc_emails: Optional[List[str]] = None
    subject: str
    template_type: Optional[str] = None
    status: str
    error_message: Optional[str] = None
    recipient_count: int = 1
    sent_at: datetime
    sent_by: Optional[str] = None

    model_config = {"from_attributes": True}

    @model_validator(mode="after")
    def ensure_utc(self) -> "MessageHistoryResponse":
        return stamp_naive_datetimes_utc(self)  # type: ignore[return-value]


class MessageHistoryListResponse(BaseModel):
    """Paginated response for message history"""

    items: List[MessageHistoryResponse]
    total: int
    skip: int
    limit: int


class SendTestEmailRequest(BaseModel):
    """Request schema for sending a test email"""

    to_email: str = Field(..., description="Recipient email address")
    template_id: Optional[str] = Field(
        None, description="Optional template ID to use for the test"
    )

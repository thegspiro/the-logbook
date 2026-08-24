"""
Email Template Schemas

Pydantic schemas for email template API requests and responses.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.schemas.base import UTCResponseBase


class TemplateVariable(BaseModel):
    """Describes an available template variable"""

    name: str
    description: str


class EmailAttachmentResponse(UTCResponseBase):
    """Response schema for an email attachment"""

    id: str
    filename: str
    content_type: str
    file_size: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class EmailTemplateResponse(UTCResponseBase):
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
    footer_key: Optional[str] = None
    header_accent: Optional[str] = None
    status_chip: Optional[str] = None
    layout: Optional[str] = None
    is_active: bool
    allow_attachments: bool
    default_cc: Optional[List[str]] = None
    default_bcc: Optional[List[str]] = None
    available_variables: List[TemplateVariable] = []
    attachments: List[EmailAttachmentResponse] = []
    # Both are computed per request rather than stored, and both answer a
    # question the list view could not previously answer without opening
    # every notice in turn: which of these have we actually changed, and
    # which of them does the department actually send?
    #
    # Defaulted rather than required because they are only populated by the
    # list endpoint. A single-template GET has no reason to run the count,
    # and a caller reading `sent_count == 0` off one would be reading a
    # figure nobody computed.
    is_customized: bool = False
    sent_count: int = 0
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
    footer_key: Optional[str] = Field(
        None,
        max_length=32,
        description=(
            "Key of the footer this template closes with. Empty string means "
            "the department's default footer."
        ),
    )
    header_accent: Optional[str] = Field(
        None,
        description=(
            "Accent hex. Must be one of the seven ACCENT_* constants — the "
            "only colours whose chip tint and white button text have been "
            "checked for contrast."
        ),
    )
    status_chip: Optional[str] = Field(None, max_length=40)
    layout: Optional[str] = Field(None, description="notice | receipt | digest")
    description: Optional[str] = None
    is_active: Optional[bool] = None
    allow_attachments: Optional[bool] = None
    default_cc: Optional[List[EmailStr]] = None
    default_bcc: Optional[List[EmailStr]] = None

    @field_validator("header_accent")
    @classmethod
    def _accent_must_be_a_known_colourway(cls, value: Optional[str]) -> Optional[str]:
        """Reject a hex nobody has checked the contrast of.

        The accent carries white button text and tints the chip behind text of
        its own colour. Both are the sort of thing that looks fine to whoever
        picks it and fails WCAG for the member squinting at a phone in
        daylight, so the choice is limited to the seven that are tested.
        """
        if value is None:
            return None
        from app.services.email_theme import CHIP_TINTS

        normalised = value.strip().lower()
        if normalised not in CHIP_TINTS:
            raise ValueError(
                f"{value!r} is not one of the available accents: "
                + ", ".join(sorted(CHIP_TINTS))
            )
        return normalised

    @field_validator("layout")
    @classmethod
    def _layout_must_be_one_we_render(cls, value: Optional[str]) -> Optional[str]:
        """A layout with no matching content class renders unstyled.

        The stylesheet carries one ``.content`` class per layout, so an
        unrecognised value would put a class on the card that nothing
        defines — and the inliner drops what it cannot match without a word.
        """
        if value is None:
            return None
        from app.services.email_theme import LAYOUTS

        normalised = value.strip().lower()
        if normalised not in LAYOUTS:
            raise ValueError(f"{value!r} is not a layout: " + ", ".join(LAYOUTS))
        return normalised


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
    footer_key: Optional[str] = Field(
        None,
        max_length=32,
        description="Preview with this footer instead of the template's saved one",
    )
    # So the accent swatches and the chip field show their effect before the
    # admin commits to it — the same reason the body is an override.
    header_accent: Optional[str] = None
    status_chip: Optional[str] = Field(None, max_length=40)
    layout: Optional[str] = None
    context: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("header_accent", "layout", mode="before")
    @classmethod
    def _blank_means_not_supplied(cls, value: Any) -> Any:
        """A blank accent or layout is an absent one, not an invalid one.

        Both columns are nullable, and a template that has neither renders
        with the colourway and layout shipped for its type — so "unset" is a
        supported state, and the editor holds it as an empty string like any
        other unfilled field. The endpoint below already falls back to the
        saved value for a falsy override; without this the request never got
        that far, and a template with no stored accent 422'd every preview.

        Only on the preview request: an update carrying a blank accent is a
        different thing entirely, a write that would clear a column the UI
        offers no way to clear, and it stays rejected.
        """
        if isinstance(value, str) and not value.strip():
            return None
        return value

    _check_accent = field_validator("header_accent")(
        EmailTemplateUpdate._accent_must_be_a_known_colourway.__func__
    )
    _check_layout = field_validator("layout")(
        EmailTemplateUpdate._layout_must_be_one_we_render.__func__
    )
    member_id: Optional[str] = Field(
        None, description="Optional member ID to populate preview with real member data"
    )


class EmailTemplatePreviewResponse(BaseModel):
    """Response schema for a rendered email preview"""

    subject: str
    html_body: str
    text_body: Optional[str] = None


# --- Email footer schemas ---


class EmailFooter(BaseModel):
    """One named footer in a department's library."""

    key: str = Field(
        ...,
        min_length=1,
        max_length=32,
        pattern=r"^[a-z0-9][a-z0-9_-]{0,31}$",
        description="Stable identifier templates refer to; not shown to recipients",
    )
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=300)
    lines: List[str] = Field(
        default_factory=list,
        max_length=6,
        description=(
            "The footer's own sentences, in order. May use the organization "
            "variables, e.g. {{organization_name}}."
        ),
    )
    show_contact: bool = Field(
        True, description="Append the phone / email / website line"
    )
    show_mailing_address: bool = Field(
        False,
        description=(
            "Append the department's mailing address — expected on mail to "
            "people outside the department"
        ),
    )

    @field_validator("lines")
    @classmethod
    def _lines_are_reasonable(cls, value: List[str]) -> List[str]:
        for line in value:
            if len(line) > 300:
                raise ValueError("A footer line may not exceed 300 characters")
        return [line for line in value if line.strip()]


class EmailFooterLibrary(BaseModel):
    """A department's whole footer library, saved in one go.

    Saved whole rather than per-footer because the default and the list have
    to stay consistent: a partial save could leave ``default_key`` naming a
    footer that the same request deleted.
    """

    default_key: str = Field(..., min_length=1, max_length=32)
    footers: List[EmailFooter] = Field(..., min_length=1, max_length=12)

    @model_validator(mode="after")
    def _default_exists_and_keys_are_unique(self) -> "EmailFooterLibrary":
        keys = [footer.key for footer in self.footers]
        if len(keys) != len(set(keys)):
            raise ValueError("Two footers cannot share a key")
        if self.default_key not in keys:
            raise ValueError("The default footer must be one of the footers listed")
        return self


class EmailFooterLibraryResponse(BaseModel):
    """The library plus what a template may put in a footer line."""

    default_key: str
    footers: List[EmailFooter]
    variables: List[TemplateVariable] = []
    usage: Dict[str, int] = Field(
        default_factory=dict,
        description="How many templates currently use each footer key",
    )


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


class ScheduledEmailResponse(UTCResponseBase):
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

    @field_validator(
        "scheduled_at", "sent_at", "created_at", "updated_at", mode="before"
    )
    @classmethod
    def ensure_utc_timezone(cls, v: datetime | None) -> datetime | None:
        """Attach UTC tzinfo to naive datetimes returned by MySQL."""
        if v is None:
            return v
        if isinstance(v, datetime) and v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v


# --- Message History schemas ---


class MessageHistoryResponse(UTCResponseBase):
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


class MessageHistoryListResponse(BaseModel):
    """Paginated response for message history"""

    items: List[MessageHistoryResponse]
    total: int
    skip: int
    limit: int


class SendTestEmailRequest(BaseModel):
    """Request schema for sending a test email"""

    to_email: str = Field(
        "",
        description=(
            "Recipient email address. Blank sends to the requesting user — "
            "the 'send a test to me' button has no other address to offer."
        ),
    )
    template_id: Optional[str] = Field(
        None, description="Optional template ID to use for the test"
    )

"""
Attendance waiver request schemas.

``AttendanceWaiverPolicy`` is the department's policy for one workflow. It is
stored as JSON under the organization's settings (the training one at
``settings["training"]["session_waiver_policy"]``, the business-meeting one at
``settings["meetings"]["waiver_policy"]``), so this model is the only
thing that gives the stored value a shape: it validates what an officer saves,
and ``policy_from_settings`` reads the stored value back through it, turning
anything malformed into the disabled default (CLAUDE.md pitfall #19: absence
means today's behaviour, and today members cannot ask).

Responses are snake_case, like the rest of the training module (pitfall #5).
"""

from datetime import date, datetime
from typing import Any, List, Literal, Optional

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)

from app.schemas.base import UTCResponseBase

# Where the training policy is stored: settings[POLICY_SECTION][POLICY_KEY].
# Only the policy endpoint writes it; the generic settings save strips it.
POLICY_SECTION = "training"
POLICY_KEY = "session_waiver_policy"
# The business-meeting policy, stored and protected the same way; the
# Secretary edits it (meetings.manage).
MEETING_POLICY_SECTION = "meetings"
MEETING_POLICY_KEY = "waiver_policy"
# Every (section, key) a policy endpoint owns, for the settings save to strip.
POLICY_LOCATIONS = (
    (POLICY_SECTION, POLICY_KEY),
    (MEETING_POLICY_SECTION, MEETING_POLICY_KEY),
)

MAX_CATEGORIES = 20
MAX_CATEGORY_LENGTH = 100
MAX_APPROVER_POSITIONS = 50
# A reason or a decision note is a few sentences; this bounds a pasted essay.
MAX_TEXT_LENGTH = 2000

DeadlinePreset = Literal["before_start", "24h_after_end", "7d_after_end"]
CapPeriod = Literal["calendar_year", "rolling_12_months"]
ReasonTextMode = Literal["off", "optional", "required"]
AttachmentMode = Literal["off", "optional", "required"]

# Owner decisions, 2026-11-10: PDF, JPEG, PNG or HEIC; 10 MB each; at most
# three per request; kept 365 days after the decision unless the department
# sets otherwise. The upload rules themselves are in
# app/services/attendance_waiver_attachments.py.
MAX_ATTACHMENTS = 3
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
DEFAULT_ATTACHMENT_RETENTION_DAYS = 365
MAX_ATTACHMENT_RETENTION_DAYS = 3650


class AttendanceWaiverPolicy(BaseModel):
    """How a department runs one waiver workflow.

    ``cap`` None means no cap. ``approver_position_ids`` empty means requests
    go straight to the fallback chain (for training the Chief, then training
    managers; for business meetings the Secretary, then meetings managers).

    ``attachment`` says whether a member may, or must, file a document with
    the request. ``attachment_retention_days`` is how long the files are kept
    after a request is closed; the retention task reads it whatever
    ``attachment`` says now, so turning attachments off does not keep the
    files already filed. A policy stored before these fields existed reads
    them at their defaults: attachments off, a year's retention. Only the
    training workflow takes documents today.
    """

    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    deadline: DeadlinePreset = "before_start"
    cap: Optional[int] = Field(default=None, ge=1, le=365)
    cap_period: CapPeriod = "calendar_year"
    categories: List[str] = Field(default_factory=list)
    category_required: bool = False
    reason_text: ReasonTextMode = "optional"
    attachment: AttachmentMode = "off"
    attachment_retention_days: int = Field(
        default=DEFAULT_ATTACHMENT_RETENTION_DAYS,
        ge=1,
        le=MAX_ATTACHMENT_RETENTION_DAYS,
    )
    approver_position_ids: List[str] = Field(default_factory=list)
    # Positions told of each final decision. Informed only: they cannot decide
    # and are never shown the member's reason.
    cc_position_ids: List[str] = Field(default_factory=list)
    # The member who decides the Chief's own request when no one holds the
    # President's office (and the President's when no one holds the Chief's).
    chief_alternate_user_id: Optional[str] = Field(default=None, max_length=36)

    @field_validator("categories")
    @classmethod
    def _clean_categories(cls, value: List[str]) -> List[str]:
        cleaned: List[str] = []
        seen: set[str] = set()
        for raw in value:
            label = (raw or "").strip()
            if not label:
                raise ValueError("A category cannot be blank")
            if len(label) > MAX_CATEGORY_LENGTH:
                raise ValueError(
                    f"A category can be at most {MAX_CATEGORY_LENGTH} characters"
                )
            # Case-insensitive: "Medical" and "medical" would read as one
            # choice to a member and split the history in two.
            key = label.casefold()
            if key in seen:
                raise ValueError(f'The category "{label}" is listed twice')
            seen.add(key)
            cleaned.append(label)
        if len(cleaned) > MAX_CATEGORIES:
            raise ValueError(f"At most {MAX_CATEGORIES} categories")
        return cleaned

    @field_validator("approver_position_ids", "cc_position_ids")
    @classmethod
    def _clean_position_ids(cls, value: List[str]) -> List[str]:
        ids = list(dict.fromkeys(str(v).strip() for v in value))
        if any(not i or len(i) > 36 for i in ids):
            raise ValueError("Invalid position")
        if len(ids) > MAX_APPROVER_POSITIONS:
            raise ValueError(f"At most {MAX_APPROVER_POSITIONS} positions")
        return ids

    @field_validator("chief_alternate_user_id")
    @classmethod
    def _clean_alternate(cls, value: Optional[str]) -> Optional[str]:
        return (value or "").strip() or None

    @model_validator(mode="after")
    def _category_required_needs_categories(self) -> "AttendanceWaiverPolicy":
        if self.category_required and not self.categories:
            raise ValueError("A category cannot be required when there are none")
        return self


def policy_from_settings(raw: Any) -> AttendanceWaiverPolicy:
    """The stored policy, or the disabled default when it is missing or malformed.

    Read defensively: the value is untyped JSON that any settings writer can
    reach, and an exception here would take down every screen that asks.
    """
    if not isinstance(raw, dict):
        return AttendanceWaiverPolicy()
    try:
        return AttendanceWaiverPolicy.model_validate(raw)
    except ValidationError:
        return AttendanceWaiverPolicy()


# ---------------------------------------------------------------------------
# Requests
# ---------------------------------------------------------------------------


class AttendanceWaiverSubmit(BaseModel):
    """A member's request. Category and reason are checked against the policy."""

    event_id: str = Field(..., min_length=1, max_length=36)
    category: Optional[str] = Field(default=None, max_length=MAX_CATEGORY_LENGTH)
    reason: Optional[str] = Field(default=None, max_length=MAX_TEXT_LENGTH)


class AttendanceWaiverDecision(BaseModel):
    note: Optional[str] = Field(default=None, max_length=MAX_TEXT_LENGTH)


class AttendanceWaiverOverride(BaseModel):
    # Blank is refused by the service, which trims first.
    note: str = Field(..., max_length=MAX_TEXT_LENGTH)


class AttendanceWaiverMessage(BaseModel):
    """A decider's question to the member, or the member's answer to it."""

    # Blank is refused by the service, which trims first.
    note: str = Field(..., max_length=MAX_TEXT_LENGTH)


# ---------------------------------------------------------------------------
# Responses
# ---------------------------------------------------------------------------


class AttendanceWaiverEligibilityResponse(UTCResponseBase):
    """Whether a member may ask to be excused from one session, and on what terms.

    ``refusal_code`` is a stable key for a screen to branch on; ``refusal`` is
    the sentence to show. ``cap_used`` and ``cap_remaining`` describe the
    session asked about: under a rolling cap they depend on its date.
    """

    event_id: str
    allowed: bool
    refusal_code: Optional[str] = None
    refusal: Optional[str] = None
    deadline: Optional[datetime] = None
    deadline_preset: DeadlinePreset
    session_date: Optional[date] = None
    cap: Optional[int] = None
    cap_period: CapPeriod
    cap_used: Optional[int] = None
    cap_remaining: Optional[int] = None
    categories: List[str]
    category_required: bool
    reason_text: ReasonTextMode
    attachment: AttachmentMode
    attachment_max_count: int = MAX_ATTACHMENTS
    attachment_max_bytes: int = MAX_ATTACHMENT_BYTES
    existing_request_id: Optional[str] = None
    existing_request_status: Optional[str] = None


class AttendanceWaiverActionResponse(UTCResponseBase):
    id: str
    action: str
    actor_id: Optional[str] = None
    actor_name: Optional[str] = None
    note: Optional[str] = None
    created_at: datetime


class AttendanceWaiverAttachmentResponse(UTCResponseBase):
    """One filed document. ``filename`` is the neutral download name; the
    uploader's own filename is never kept."""

    id: str
    ordinal: int
    filename: str
    mime_type: str
    file_size: int
    uploaded_at: datetime


class AttendanceWaiverRequestResponse(UTCResponseBase):
    """One request, as its member or a decider sees it.

    Only those two ever receive one, which is why ``reason`` is present: it
    may be medical and is shown to nobody else.
    """

    id: str
    workflow: str
    user_id: str
    member_name: Optional[str] = None
    event_id: Optional[str] = None
    event_title: str
    event_start: datetime
    session_date: date
    status: str
    category: Optional[str] = None
    reason: Optional[str] = None
    submitted_at: datetime
    decided_at: Optional[datetime] = None
    decided_by: Optional[str] = None
    decided_by_name: Optional[str] = None
    chief_override: bool
    # When a pending request closes undecided (expires_at_for); None once it
    # is settled. Screens show it rather than working it out.
    expires_at: Optional[datetime] = None
    # Open while a decider's question waits on the member's answer.
    info_requested_at: Optional[datetime] = None
    # Open while a rescheduled session waits on the member to confirm.
    reconfirm_requested_at: Optional[datetime] = None
    can_withdraw: bool = False
    # The member may answer the open question / confirm the new date.
    can_respond: bool = False
    can_confirm: bool = False
    # The viewer may ask the member a question (a decider, while pending).
    can_request_info: bool = False
    can_decide: bool = False
    can_override: bool = False
    # Whether the viewer may file another document now: the member, while the
    # request is pending, the policy takes attachments and fewer than the
    # limit are filed.
    can_attach: bool = False
    attachments: List[AttendanceWaiverAttachmentResponse] = Field(default_factory=list)
    actions: List[AttendanceWaiverActionResponse] = Field(default_factory=list)


class AttendanceWaiverRequestPage(UTCResponseBase):
    items: List[AttendanceWaiverRequestResponse]
    total: int
    skip: int
    limit: int

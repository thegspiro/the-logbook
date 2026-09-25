"""
Suggestion Box Pydantic Schemas

Three audiences read suggestions, and each gets its own response shape so a
field cannot leak across by being "optional" in a shared one:

* box administrators (``suggestions.manage``) see box configuration only;
* a box's reviewers see the full submission, internal note included;
* the submitter sees their own submission, and — only in a follow-up box —
  its disposition and thread. Never the internal note.
"""

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

from app.models.suggestion import SuggestionAnonymityMode, SuggestionDisposition
from app.schemas.base import UTCResponseBase

_RESPONSE_CONFIG = ConfigDict(
    from_attributes=True, alias_generator=to_camel, populate_by_name=True
)
_REQUEST_CONFIG = ConfigDict(alias_generator=to_camel, populate_by_name=True)

MAX_TITLE_LENGTH = 200
MAX_DETAILS_LENGTH = 10000
MAX_MESSAGE_LENGTH = 5000
MAX_PUBLIC_RESPONSE_LENGTH = 2000
# A follow-up key is secrets.token_urlsafe(32): 43 characters. The bounds
# only keep an absurd body out of the hash; the lookup is what validates it.
_KEY_MIN, _KEY_MAX = 20, 100

AnonymityMode = Literal["allowed", "required", "disabled"]
Disposition = Literal[
    "new", "under_review", "accepted", "implemented", "declined", "duplicate"
]

# Keep the Literal types above honest against the model enums they mirror.
assert set(AnonymityMode.__args__) == {m.value for m in SuggestionAnonymityMode}
assert set(Disposition.__args__) == {d.value for d in SuggestionDisposition}


def _strip_required(value: str) -> str:
    value = (value or "").strip()
    if not value:
        raise ValueError("must not be blank")
    return value


# ---------------------------------------------------------------------------
# Box administration
# ---------------------------------------------------------------------------


class SuggestionBoxWrite(BaseModel):
    """Create or fully replace a box, reviewers included."""

    model_config = _REQUEST_CONFIG

    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=2000)
    anonymity_mode: AnonymityMode = "allowed"
    follow_up_enabled: bool = False
    is_active: bool = True
    reviewer_position_ids: List[str] = Field(default_factory=list, max_length=50)
    reviewer_member_ids: List[str] = Field(default_factory=list, max_length=200)
    # None leaves the box's watchers as they are, so a client written before
    # watchers existed can still PUT a box without clearing them.
    watcher_position_ids: Optional[List[str]] = Field(None, max_length=50)
    watcher_member_ids: Optional[List[str]] = Field(None, max_length=200)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        return _strip_required(value)

    @field_validator("description")
    @classmethod
    def _description(cls, value: Optional[str]) -> Optional[str]:
        value = (value or "").strip()
        return value or None

    @field_validator("reviewer_position_ids", "reviewer_member_ids")
    @classmethod
    def _dedupe(cls, value: List[str]) -> List[str]:
        return list(dict.fromkeys(v.strip() for v in value if v and v.strip()))

    @field_validator("watcher_position_ids", "watcher_member_ids")
    @classmethod
    def _dedupe_optional(cls, value: Optional[List[str]]) -> Optional[List[str]]:
        if value is None:
            return None
        return list(dict.fromkeys(v.strip() for v in value if v and v.strip()))


class ReviewerRef(UTCResponseBase):
    model_config = _RESPONSE_CONFIG

    id: str
    name: str


class SuggestionBoxAdminResponse(UTCResponseBase):
    model_config = _RESPONSE_CONFIG

    id: str
    name: str
    description: Optional[str] = None
    anonymity_mode: str
    follow_up_enabled: bool
    is_active: bool
    reviewer_positions: List[ReviewerRef]
    reviewer_members: List[ReviewerRef]
    watcher_positions: List[ReviewerRef] = Field(default_factory=list)
    watcher_members: List[ReviewerRef] = Field(default_factory=list)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ReviewerOptions(UTCResponseBase):
    model_config = _RESPONSE_CONFIG

    positions: List[ReviewerRef]
    members: List[ReviewerRef]


# ---------------------------------------------------------------------------
# Member-facing
# ---------------------------------------------------------------------------


class SuggestionBoxPublic(UTCResponseBase):
    """What a member sees when choosing a box. No reviewer identities: who
    reads a complaints box is the department's to publish, not the form's."""

    model_config = _RESPONSE_CONFIG

    id: str
    name: str
    description: Optional[str] = None
    anonymity_mode: str
    follow_up_enabled: bool


class SubmissionReceipt(UTCResponseBase):
    model_config = _RESPONSE_CONFIG

    # None for an anonymous submission: the submitter has no use for it, and
    # the key (when there is one) is the only handle they need.
    id: Optional[str] = None
    is_anonymous: bool
    follow_up_key: Optional[str] = None


class AttachmentResponse(UTCResponseBase):
    model_config = _RESPONSE_CONFIG

    id: str
    file_name: str
    content_type: str
    file_size: int


class ThreadMessageResponse(UTCResponseBase):
    model_config = _RESPONSE_CONFIG

    id: str
    author_role: str
    # Reviewer name, or the named submitter's; None for an anonymous submitter.
    author_name: Optional[str] = None
    is_mine: bool = False
    body: str
    created_at: datetime
    # "day" when the timestamp was truncated to protect an anonymous author.
    timestamp_precision: Literal["exact", "day"] = "exact"


class MySuggestionSummary(UTCResponseBase):
    model_config = _RESPONSE_CONFIG

    id: str
    box_id: str
    box_name: str
    title: str
    follow_up_enabled: bool
    # Only in follow-up boxes; a one-way box reports nothing back.
    disposition: Optional[str] = None
    message_count: int = 0
    created_at: datetime


class TimelineEntry(UTCResponseBase):
    """A step the submitter can see. The first entry is always receipt
    (``disposition`` "new", no response), dated like the submission itself."""

    model_config = _RESPONSE_CONFIG

    disposition: str
    public_response: Optional[str] = None
    created_at: datetime
    timestamp_precision: Literal["exact", "day"] = "exact"


class SubmitterSuggestionDetail(UTCResponseBase):
    """The submitter's view — shared by named submitters and key holders."""

    model_config = _RESPONSE_CONFIG

    id: Optional[str] = None
    box_name: str
    title: str
    details: str
    is_anonymous: bool
    follow_up_enabled: bool
    disposition: Optional[str] = None
    attachments: List[AttachmentResponse]
    messages: List[ThreadMessageResponse]
    # Empty in a one-way box, where the submitter sees no status at all.
    timeline: List[TimelineEntry] = Field(default_factory=list)
    created_at: datetime
    timestamp_precision: Literal["exact", "day"] = "exact"


class MessageCreate(BaseModel):
    model_config = _REQUEST_CONFIG

    body: str = Field(..., min_length=1, max_length=MAX_MESSAGE_LENGTH)

    @field_validator("body")
    @classmethod
    def _body(cls, value: str) -> str:
        return _strip_required(value)


class FollowUpKeyRequest(BaseModel):
    """Keys travel in a POST body, never a URL, so they stay out of access
    logs, browser history and Referer headers."""

    model_config = _REQUEST_CONFIG

    key: str = Field(..., min_length=_KEY_MIN, max_length=_KEY_MAX)


class FollowUpMessageCreate(FollowUpKeyRequest):
    body: str = Field(..., min_length=1, max_length=MAX_MESSAGE_LENGTH)

    @field_validator("body")
    @classmethod
    def _body(cls, value: str) -> str:
        return _strip_required(value)


# ---------------------------------------------------------------------------
# Reviewer-facing
# ---------------------------------------------------------------------------


class ReviewSuggestionSummary(UTCResponseBase):
    model_config = _RESPONSE_CONFIG

    id: str
    box_id: str
    box_name: str
    title: str
    is_anonymous: bool
    submitter_name: Optional[str] = None
    disposition: str
    message_count: int = 0
    attachment_count: int = 0
    created_at: datetime
    timestamp_precision: Literal["exact", "day"] = "exact"
    # True when the member reaches this item by a forward, not as a reviewer
    # of its box.
    via_forward: bool = False


class ReviewSuggestionList(UTCResponseBase):
    model_config = _RESPONSE_CONFIG

    items: List[ReviewSuggestionSummary]
    total: int


class ForwardResponse(UTCResponseBase):
    model_config = _RESPONSE_CONFIG

    id: str
    kind: Literal["position", "member"]
    target_id: Optional[str] = None
    name: str
    forwarded_by_name: Optional[str] = None
    created_at: Optional[datetime] = None


class ForwardCreate(BaseModel):
    model_config = _REQUEST_CONFIG

    position_ids: List[str] = Field(default_factory=list, max_length=50)
    member_ids: List[str] = Field(default_factory=list, max_length=200)

    @field_validator("position_ids", "member_ids")
    @classmethod
    def _dedupe(cls, value: List[str]) -> List[str]:
        return list(dict.fromkeys(v.strip() for v in value if v and v.strip()))


class ReviewSuggestionDetail(UTCResponseBase):
    model_config = _RESPONSE_CONFIG

    id: str
    box_id: str
    box_name: str
    title: str
    details: str
    is_anonymous: bool
    submitter_name: Optional[str] = None
    follow_up_enabled: bool
    # False for an anonymous submission in a follow-up box whose submitter
    # took no key — nobody can read a reply, so the UI should not invite one.
    can_follow_up: bool
    disposition: str
    internal_note: Optional[str] = None
    disposition_updated_by_name: Optional[str] = None
    disposition_updated_at: Optional[datetime] = None
    attachments: List[AttachmentResponse]
    messages: List[ThreadMessageResponse]
    created_at: datetime
    timestamp_precision: Literal["exact", "day"] = "exact"
    # Only the box's own reviewers forward or withdraw; someone reaching the
    # item by a forward cannot pass it on.
    can_forward: bool = False
    via_forward: bool = False
    forwards: List[ForwardResponse] = Field(default_factory=list)
    timeline: List[TimelineEntry] = Field(default_factory=list)


class ReviewSummary(UTCResponseBase):
    model_config = _RESPONSE_CONFIG

    is_reviewer: bool
    open_count: int
    boxes: List[SuggestionBoxPublic]


class DispositionUpdate(BaseModel):
    """Both fields follow the update contract: omit to leave alone, send
    ``null`` (note only) to clear."""

    model_config = _REQUEST_CONFIG

    disposition: Optional[Disposition] = None
    internal_note: Optional[str] = Field(None, max_length=MAX_DETAILS_LENGTH)
    # Shown to the submitter on their timeline. Not a stored field to clear:
    # each one is a new step, so a blank value simply adds nothing.
    public_response: Optional[str] = Field(None, max_length=MAX_PUBLIC_RESPONSE_LENGTH)

    @field_validator("public_response")
    @classmethod
    def _public_response(cls, value: Optional[str]) -> Optional[str]:
        value = (value or "").strip()
        return value or None

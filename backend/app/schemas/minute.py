"""
Meeting Minutes Pydantic Schemas

Request and response schemas for meeting minutes, templates, and related endpoints.
"""

import re
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from app.models.minute import MinutesAttachmentCategory, MinutesMeetingType
from app.schemas.base import UTCResponseBase
from app.utils.minutes_attendance import COUNTS_TOWARD_QUORUM, derive_status

_response_config = ConfigDict(from_attributes=True)

# MeetingMinutes.meeting_type / MinutesTemplate.meeting_type are strict MySQL
# ENUMs; SQLAlchemy doesn't validate the string on bind, so an out-of-set value
# reaches MySQL and 500s. Validate at the request schema (MM2-2, the B1
# latent-500 class). This set includes 'executive' — the value the executive-
# session read restriction keys on — so a valid restricted-minutes create is
# unaffected.
_MINUTES_MEETING_TYPES = {e.value for e in MinutesMeetingType}


def _validate_minutes_meeting_type(value: Optional[str]) -> Optional[str]:
    if value is None:
        return value
    normalized = value.lower() if isinstance(value, str) else value
    if normalized not in _MINUTES_MEETING_TYPES:
        raise ValueError(
            f"Invalid meeting_type '{value}'. Must be one of: "
            f"{', '.join(sorted(_MINUTES_MEETING_TYPES))}"
        )
    return normalized


# ============================================
# Section Schemas (for dynamic sections)
# ============================================


class SectionEntry(BaseModel):
    """A single content section within minutes or a template"""

    order: int = Field(..., ge=0, description="Display order")
    key: str = Field(
        ..., min_length=1, max_length=100, description="Unique key for the section"
    )
    title: str = Field(..., min_length=1, max_length=200, description="Display title")
    content: str = Field(default="", description="Section content (minutes only)")
    required: bool = Field(
        default=False,
        description="Copied from the outline; a required section needs content "
        "before the minutes can be circulated",
    )


class TemplateSectionEntry(BaseModel):
    """A section definition within a template"""

    order: int = Field(..., ge=0)
    key: str = Field(..., min_length=1, max_length=100)
    title: str = Field(..., min_length=1, max_length=200)
    default_content: str = Field(default="", description="Default content to pre-fill")
    required: bool = Field(default=False, description="Whether the section is required")


# ============================================
# Header / Footer Config Schemas
# ============================================


class HeaderConfig(BaseModel):
    """Document header configuration"""

    org_name: Optional[str] = Field(
        None, max_length=200, description="Organization name for header"
    )
    logo_url: Optional[str] = Field(None, description="URL to organization logo")
    subtitle: Optional[str] = Field(
        None,
        max_length=300,
        description="Subtitle line (e.g., 'Official Meeting Minutes')",
    )
    show_date: bool = Field(default=True, description="Show meeting date in header")
    show_meeting_type: bool = Field(
        default=True, description="Show meeting type in header"
    )


class FooterConfig(BaseModel):
    """Document footer configuration"""

    left_text: Optional[str] = Field(
        None, max_length=200, description="Left-aligned footer text"
    )
    center_text: Optional[str] = Field(
        None, max_length=200, description="Center footer text"
    )
    right_text: Optional[str] = Field(
        None, max_length=200, description="Right-aligned footer text"
    )
    show_page_numbers: bool = Field(default=True, description="Show page numbers")
    confidentiality_notice: Optional[str] = Field(
        None, max_length=500, description="Confidentiality or distribution notice"
    )


# ============================================
# Template Schemas
# ============================================


_SECTION_KEY_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_]*$")


def _validate_outline_sections(
    value: Optional[List["TemplateSectionEntry"]],
) -> Optional[List["TemplateSectionEntry"]]:
    """An outline is an ordered list of sections with unique keys.

    The order given is the order kept: ``order`` is renumbered 0..n so two
    sections can never tie and a gap never leaves the list ambiguous. A key is
    what a section is known by from outline to minutes, so it must be unique and
    URL-safe.
    """
    if value is None:
        return value
    keys: set[str] = set()
    for section in value:
        if not _SECTION_KEY_PATTERN.match(section.key):
            raise ValueError(
                f"Section key '{section.key}' must be lowercase letters, "
                "digits and underscores"
            )
        if section.key in keys:
            raise ValueError(f"Section key '{section.key}' is used twice")
        keys.add(section.key)
    ordered = sorted(value, key=lambda s: s.order)
    return [s.model_copy(update={"order": index}) for index, s in enumerate(ordered)]


class TemplateCreate(BaseModel):
    """Schema for creating a minutes template"""

    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    meeting_type: str = Field(default="business")
    is_default: bool = False
    sections: List[TemplateSectionEntry]
    header_config: Optional[HeaderConfig] = None
    footer_config: Optional[FooterConfig] = None

    _check_meeting_type = field_validator("meeting_type")(
        _validate_minutes_meeting_type
    )
    _check_sections = field_validator("sections")(_validate_outline_sections)


class TemplateUpdate(BaseModel):
    """Schema for updating a minutes template"""

    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    meeting_type: Optional[str] = None
    is_default: Optional[bool] = None
    sections: Optional[List[TemplateSectionEntry]] = None
    header_config: Optional[HeaderConfig] = None
    footer_config: Optional[FooterConfig] = None

    _check_meeting_type = field_validator("meeting_type")(
        _validate_minutes_meeting_type
    )
    _check_sections = field_validator("sections")(_validate_outline_sections)


class TemplateResponse(UTCResponseBase):
    """Template response schema"""

    id: str
    organization_id: str
    name: str
    description: Optional[str] = None
    meeting_type: str
    is_default: bool
    sections: List[TemplateSectionEntry]
    header_config: Optional[HeaderConfig] = None
    footer_config: Optional[FooterConfig] = None
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = _response_config


class TemplateListItem(UTCResponseBase):
    """Compact template listing"""

    id: str
    name: str
    meeting_type: str
    is_default: bool
    section_count: int
    created_at: datetime

    model_config = _response_config


# ============================================
# Motion Schemas
# ============================================


class MotionBase(BaseModel):
    """Base motion schema"""

    motion_text: str = Field(
        ..., min_length=1, max_length=2000, description="Text of the motion"
    )
    moved_by: Optional[str] = Field(
        None, max_length=200, description="Name of person who moved"
    )
    seconded_by: Optional[str] = Field(
        None, max_length=200, description="Name of person who seconded"
    )
    discussion_notes: Optional[str] = None
    status: str = Field(
        default="passed", description="Motion result: passed, failed, tabled, withdrawn"
    )
    votes_for: Optional[int] = Field(None, ge=0)
    votes_against: Optional[int] = Field(None, ge=0)
    votes_abstain: Optional[int] = Field(None, ge=0)
    election_id: Optional[str] = Field(
        None, max_length=36, description="The ballot that decided this motion"
    )
    ballot_item_id: Optional[str] = Field(
        None, max_length=100, description="The item on that ballot"
    )

    @model_validator(mode="after")
    def _item_needs_election(self):
        if self.ballot_item_id and not self.election_id:
            raise ValueError("A ballot item needs the election it belongs to")
        return self


class MotionCreate(MotionBase):
    """Schema for creating a motion"""

    order: int = Field(default=0, ge=0, description="Display order within the minutes")


class MotionUpdate(BaseModel):
    """Schema for updating a motion"""

    motion_text: Optional[str] = Field(None, min_length=1, max_length=2000)
    moved_by: Optional[str] = Field(None, max_length=200)
    seconded_by: Optional[str] = Field(None, max_length=200)
    discussion_notes: Optional[str] = None
    status: Optional[str] = None
    votes_for: Optional[int] = Field(None, ge=0)
    votes_against: Optional[int] = Field(None, ge=0)
    votes_abstain: Optional[int] = Field(None, ge=0)
    order: Optional[int] = Field(None, ge=0)
    election_id: Optional[str] = Field(None, max_length=36)
    ballot_item_id: Optional[str] = Field(None, max_length=100)


class MotionResponse(MotionBase):
    """Motion response schema"""

    id: str
    minutes_id: str
    order: int
    election_title: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = _response_config


# ============================================
# Action Item Schemas
# ============================================


class ActionItemBase(BaseModel):
    """Base action item schema"""

    description: str = Field(
        ..., min_length=1, max_length=2000, description="Description of the action item"
    )
    assignee_id: Optional[str] = Field(None, description="UUID of the assigned user")
    assignee_name: Optional[str] = Field(
        None, max_length=200, description="Name of the assignee (for display)"
    )
    due_date: Optional[datetime] = None
    priority: str = Field(
        default="medium", description="Priority: low, medium, high, urgent"
    )


class ActionItemCreate(ActionItemBase):
    """Schema for creating an action item"""


class ActionItemUpdate(BaseModel):
    """Schema for updating an action item"""

    description: Optional[str] = Field(None, min_length=1, max_length=2000)
    assignee_id: Optional[str] = None
    assignee_name: Optional[str] = Field(None, max_length=200)
    due_date: Optional[datetime] = None
    priority: Optional[str] = None
    status: Optional[str] = Field(
        None, description="Status: pending, in_progress, completed, cancelled, overdue"
    )
    completion_notes: Optional[str] = None


class ActionItemAssignee(BaseModel):
    """A member who may be assigned an action item (W52-6)."""

    id: str
    name: str


class ActionItemResponse(ActionItemBase):
    """Action item response schema"""

    id: str
    minutes_id: str
    status: str
    completed_at: Optional[datetime] = None
    completion_notes: Optional[str] = None
    carried_from_id: Optional[str] = None
    carried_forward_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = _response_config


class OpenActionItem(ActionItemResponse):
    """An open item from an earlier meeting, offered for carry-forward"""

    minutes_title: str
    meeting_date: datetime


class MyActionItem(ActionItemResponse):
    """An item assigned to the caller, with where it came from"""

    minutes_title: str
    meeting_date: datetime
    minutes_status: str


class CarryForwardRequest(BaseModel):
    """Open items to copy into a set of minutes"""

    item_ids: List[str] = Field(..., min_length=1, max_length=100)

    @field_validator("item_ids")
    @classmethod
    def _unique(cls, value: List[str]) -> List[str]:
        return list(dict.fromkeys(value))


# ============================================
# Meeting Minutes Schemas
# ============================================


AttendanceStatus = Literal[
    "present", "late", "left_early", "excused", "absent", "guest"
]


class AttendeeEntry(BaseModel):
    """Individual attendee record

    ``status`` is the record and ``present`` is derived from it (see
    ``app.utils.minutes_attendance``). A client that sends only ``present``
    gets the matching status; one that sends both gets its ``status``, with
    ``present`` corrected to agree, so the two can never disagree in storage.
    """

    user_id: Optional[str] = None
    name: str = Field(..., min_length=1, max_length=200)
    role: Optional[str] = Field(None, max_length=100)
    status: Optional[AttendanceStatus] = None
    present: bool = True
    note: Optional[str] = Field(None, max_length=300)

    @model_validator(mode="after")
    def _settle_status(self) -> "AttendeeEntry":
        if self.status is None:
            self.status = derive_status({"present": self.present})  # type: ignore[assignment]
        self.present = self.status in COUNTS_TOWARD_QUORUM
        return self


def _reject_duplicate_attendees(
    value: Optional[List[AttendeeEntry]],
) -> Optional[List[AttendeeEntry]]:
    """One roll-call line per member: a member listed twice would count twice
    toward quorum."""
    if not value:
        return value
    seen: set[str] = set()
    for entry in value:
        if entry.user_id:
            if entry.user_id in seen:
                raise ValueError("A member can be listed only once in attendance")
            seen.add(entry.user_id)
    return value


class MinutesBase(BaseModel):
    """Base meeting minutes schema"""

    title: str = Field(
        ..., min_length=1, max_length=300, description="Title of the meeting minutes"
    )
    meeting_type: str = Field(
        default="business",
        description="Meeting type: business, special, committee, board, "
        "trustee, executive, annual, other",
    )
    meeting_date: datetime = Field(..., description="Date and time of the meeting")
    location: Optional[str] = Field(None, max_length=300)
    called_by: Optional[str] = Field(
        None, max_length=200, description="Person who called the meeting"
    )
    called_to_order_at: Optional[datetime] = None
    adjourned_at: Optional[datetime] = None
    attendees: Optional[List[AttendeeEntry]] = None
    quorum_met: Optional[bool] = None
    quorum_count: Optional[int] = Field(None, ge=0)
    event_id: Optional[str] = Field(None, description="Optional link to an event")


class MinutesCreate(MinutesBase):
    """Schema for creating meeting minutes"""

    template_id: Optional[str] = Field(
        None, description="Template to use for section structure"
    )
    sections: Optional[List[SectionEntry]] = Field(
        None, description="Content sections (if not using template)"
    )
    header_config: Optional[HeaderConfig] = None
    footer_config: Optional[FooterConfig] = None
    motions: Optional[List[MotionCreate]] = Field(
        None, description="Motions to create with the minutes"
    )
    action_items: Optional[List[ActionItemCreate]] = Field(
        None, description="Action items to create with the minutes"
    )
    # Legacy fields still accepted for backward compat
    agenda: Optional[str] = None
    old_business: Optional[str] = None
    new_business: Optional[str] = None
    treasurer_report: Optional[str] = None
    chief_report: Optional[str] = None
    committee_reports: Optional[str] = None
    announcements: Optional[str] = None
    notes: Optional[str] = None

    _check_meeting_type = field_validator("meeting_type")(
        _validate_minutes_meeting_type
    )
    _check_attendees = field_validator("attendees")(_reject_duplicate_attendees)


class MinutesUpdate(BaseModel):
    """Schema for updating meeting minutes"""

    title: Optional[str] = Field(None, min_length=1, max_length=300)
    meeting_type: Optional[str] = None
    meeting_date: Optional[datetime] = None
    location: Optional[str] = Field(None, max_length=300)
    called_by: Optional[str] = Field(None, max_length=200)
    called_to_order_at: Optional[datetime] = None
    adjourned_at: Optional[datetime] = None
    attendees: Optional[List[AttendeeEntry]] = None
    quorum_met: Optional[bool] = None
    quorum_count: Optional[int] = Field(None, ge=0)
    event_id: Optional[str] = None
    sections: Optional[List[SectionEntry]] = Field(
        None, description="Full sections replacement"
    )
    header_config: Optional[HeaderConfig] = None
    footer_config: Optional[FooterConfig] = None
    # Legacy fields still accepted
    agenda: Optional[str] = None
    old_business: Optional[str] = None
    new_business: Optional[str] = None
    treasurer_report: Optional[str] = None
    chief_report: Optional[str] = None
    committee_reports: Optional[str] = None
    announcements: Optional[str] = None
    notes: Optional[str] = None

    _check_meeting_type = field_validator("meeting_type")(
        _validate_minutes_meeting_type
    )
    _check_attendees = field_validator("attendees")(_reject_duplicate_attendees)


class MinutesResponse(UTCResponseBase):
    """Meeting minutes response schema"""

    id: str
    organization_id: str
    title: str
    meeting_type: str
    meeting_date: datetime
    location: Optional[str] = None
    called_by: Optional[str] = None
    called_to_order_at: Optional[datetime] = None
    adjourned_at: Optional[datetime] = None
    attendees: Optional[List[AttendeeEntry]] = None
    quorum_met: Optional[bool] = None
    quorum_count: Optional[int] = None
    event_id: Optional[str] = None
    template_id: Optional[str] = None
    sections: List[SectionEntry] = []
    header_config: Optional[HeaderConfig] = None
    footer_config: Optional[FooterConfig] = None
    published_document_id: Optional[str] = None
    status: str
    submitted_at: Optional[datetime] = None
    submitted_by: Optional[str] = None
    approved_at: Optional[datetime] = None
    approved_by: Optional[str] = None
    rejected_at: Optional[datetime] = None
    rejected_by: Optional[str] = None
    rejection_reason: Optional[str] = None
    adopted_on: Optional[datetime] = None
    adopted_as_amended: Optional[bool] = None
    adopting_minutes_id: Optional[str] = None
    adopting_minutes_title: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    motions: List[MotionResponse] = []
    action_items: List[ActionItemResponse] = []

    model_config = _response_config


class MinutesListItem(UTCResponseBase):
    """Compact response for listing minutes"""

    id: str
    title: str
    meeting_type: str
    meeting_date: datetime
    status: str
    location: Optional[str] = None
    called_by: Optional[str] = None
    template_id: Optional[str] = None
    # The meeting record these minutes were written from, so the meetings list
    # can link to them instead of offering to create a second set.
    meeting_id: Optional[str] = None
    motions_count: int = 0
    action_items_count: int = 0
    open_action_items: int = 0
    created_at: datetime

    model_config = _response_config


class MinutesAdopt(BaseModel):
    """What the body did when it adopted the minutes"""

    adopted_on: Optional[datetime] = Field(
        None, description="When the body voted; defaults to now"
    )
    adopting_minutes_id: Optional[str] = Field(
        None,
        max_length=36,
        description="The minutes of the meeting at which these were adopted",
    )
    as_amended: Optional[bool] = Field(
        None,
        description="Adopted as amended; defaults to whether any suggestion "
        "was accepted",
    )


class ApplyOutline(BaseModel):
    """Which outline to lay over draft minutes"""

    template_id: str = Field(..., min_length=1, max_length=36)


class MinutesReject(BaseModel):
    """Schema for rejecting minutes"""

    reason: str = Field(
        ..., min_length=10, max_length=500, description="Reason for rejection"
    )


class MinutesReopen(BaseModel):
    """Schema for reopening approved minutes for a correction (MM-17)"""

    reason: str = Field(
        ...,
        min_length=10,
        max_length=500,
        description="What needs correcting; recorded in the audit trail",
    )


class MinutesSearchResult(UTCResponseBase):
    """Full-text search result"""

    id: str
    title: str
    meeting_type: str
    meeting_date: datetime
    status: str
    snippet: str = Field(..., description="Matching text snippet")
    match_field: str = Field(..., description="Which field matched")

    model_config = _response_config


# ============================================
# Attendance Suggestions
# ============================================


class AttendanceSuggestions(BaseModel):
    """A starting roll for the minutes, for the secretary to correct.

    Nothing is saved: the entries come back so the roll call can be reviewed
    and then written with the ordinary minutes update.
    """

    source: Literal["event", "roster"]
    event_title: Optional[str] = None
    entries: List[AttendeeEntry]


# ============================================
# Election Results
# ============================================


class BallotItemRef(BaseModel):
    """A ballot item a motion can be tied to"""

    id: str
    title: str


class ImportableElection(UTCResponseBase):
    """A closed election whose result can be filed with the minutes"""

    id: str
    title: str
    election_type: Optional[str] = None
    closed_at: Optional[datetime] = None
    positions: Optional[List[str]] = None
    already_imported: bool = False
    # Held at this meeting's event or recorded against its meeting record.
    linked_to_meeting: bool = False
    ballot_items: List[BallotItemRef] = []

    model_config = _response_config


class ElectionResultCapture(BaseModel):
    """Which election's result to freeze into the minutes"""

    election_id: str = Field(..., min_length=1, max_length=36)


class MinutesElectionResultResponse(UTCResponseBase):
    """An election result as it was filed with the minutes"""

    id: str
    minutes_id: str
    election_id: Optional[str] = None
    election_title: str
    election_closed_at: Optional[datetime] = None
    snapshot: Dict[str, Any]
    is_addendum: bool = False
    captured_by: Optional[str] = None
    captured_by_name: Optional[str] = None
    created_at: datetime

    model_config = _response_config


# ============================================
# Attachments
# ============================================

_ATTACHMENT_CATEGORIES = {c.value for c in MinutesAttachmentCategory}


def validate_attachment_category(value: str) -> str:
    normalized = (value or "").strip().lower()
    if normalized not in _ATTACHMENT_CATEGORIES:
        raise ValueError(
            f"Invalid category '{value}'. Must be one of: "
            f"{', '.join(sorted(_ATTACHMENT_CATEGORIES))}"
        )
    return normalized


class MinutesAttachmentResponse(UTCResponseBase):
    """A file kept with the minutes"""

    id: str
    minutes_id: str
    title: str
    category: str
    description: Optional[str] = None
    original_name: str
    mime_type: str
    file_size: int
    sha256: str
    uploaded_by: Optional[str] = None
    uploaded_by_name: Optional[str] = None
    uploaded_at: datetime

    model_config = _response_config


# ============================================
# Revisions
# ============================================


class MinutesRevisionResponse(UTCResponseBase):
    """One approved version of the minutes"""

    id: str
    minutes_id: str
    version: int
    content_hash: str
    submitted_by: Optional[str] = None
    submitted_by_name: Optional[str] = None
    approved_by: Optional[str] = None
    approved_by_name: Optional[str] = None
    approved_at: datetime
    superseded_at: Optional[datetime] = None
    superseded_by: Optional[str] = None
    superseded_by_name: Optional[str] = None
    superseded_reason: Optional[str] = None

    model_config = _response_config


class MinutesRevisionDetail(MinutesRevisionResponse):
    """An approved version with the content it recorded"""

    snapshot: Dict[str, Any]


class MinutesVerification(BaseModel):
    """Whether the minutes still match the version that was approved"""

    verified: bool
    version: Optional[int] = None
    content_hash: Optional[str] = None
    current_hash: Optional[str] = None
    changed: List[str] = []
    detail: str


# ============================================
# Closed Sessions
# ============================================


class ClosedSessionParticipant(BaseModel):
    """One person in the room for a closed session"""

    user_id: Optional[str] = Field(None, max_length=36)
    name: str = Field(..., min_length=1, max_length=200)
    joined_at: Optional[datetime] = None
    left_at: Optional[datetime] = None

    @model_validator(mode="after")
    def _left_after_joined(self):
        if self.joined_at and self.left_at and self.left_at < self.joined_at:
            raise ValueError(f"{self.name} left before they joined")
        return self


def _validate_participants(
    value: Optional[List[ClosedSessionParticipant]],
) -> Optional[List[ClosedSessionParticipant]]:
    if not value:
        return value
    seen: set[str] = set()
    for person in value:
        if person.user_id:
            if person.user_id in seen:
                raise ValueError("A member can be listed only once in a closed session")
            seen.add(person.user_id)
    return value


class ClosedSessionBase(BaseModel):
    reason: str = Field(..., min_length=1, max_length=300)
    legal_basis: Optional[str] = Field(None, max_length=300)
    started_at: datetime
    ended_at: Optional[datetime] = None
    motion_id: Optional[str] = Field(
        None, max_length=36, description="The motion that moved into closed session"
    )
    participants: Optional[List[ClosedSessionParticipant]] = Field(None, max_length=300)
    summary: Optional[str] = Field(
        None,
        max_length=4000,
        description="What may be said publicly, e.g. 'no action was taken'",
    )

    _check_participants = field_validator("participants")(_validate_participants)

    @model_validator(mode="after")
    def _ends_after_start(self):
        if self.ended_at and self.ended_at < self.started_at:
            raise ValueError("A closed session cannot end before it starts")
        return self


class ClosedSessionCreate(ClosedSessionBase):
    """Schema for recording a closed session"""


class ClosedSessionUpdate(BaseModel):
    """Schema for changing a closed session"""

    reason: Optional[str] = Field(None, min_length=1, max_length=300)
    legal_basis: Optional[str] = Field(None, max_length=300)
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    motion_id: Optional[str] = Field(None, max_length=36)
    participants: Optional[List[ClosedSessionParticipant]] = Field(None, max_length=300)
    summary: Optional[str] = Field(None, max_length=4000)

    _check_participants = field_validator("participants")(_validate_participants)


class ClosedSessionResponse(UTCResponseBase):
    """A closed session as recorded"""

    id: str
    minutes_id: str
    motion_id: Optional[str] = None
    reason: str
    legal_basis: Optional[str] = None
    started_at: datetime
    ended_at: Optional[datetime] = None
    participants: List[ClosedSessionParticipant] = []
    summary: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = _response_config


# ============================================
# Member Suggestions
# ============================================


class SuggestionCreate(BaseModel):
    """A change a member proposes while the minutes are circulated"""

    section_key: Optional[str] = Field(
        None, max_length=100, description="The section it is about; none = overall"
    )
    comment: str = Field(..., min_length=3, max_length=2000)
    proposed_text: Optional[str] = Field(
        None, max_length=10000, description="Replacement wording, if offered"
    )

    @field_validator("comment")
    @classmethod
    def _comment_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Say what should change")
        return value.strip()


class SuggestionResolve(BaseModel):
    """The secretary's answer to a suggestion"""

    status: Literal["accepted", "declined"]
    note: Optional[str] = Field(None, max_length=1000)


class SuggestionResponse(UTCResponseBase):
    """A suggestion with its author and answer"""

    id: str
    minutes_id: str
    section_key: Optional[str] = None
    comment: str
    proposed_text: Optional[str] = None
    status: str
    resolution_note: Optional[str] = None
    resolved_by: Optional[str] = None
    resolved_by_name: Optional[str] = None
    resolved_at: Optional[datetime] = None
    created_by: Optional[str] = None
    created_by_name: Optional[str] = None
    created_at: datetime

    model_config = _response_config

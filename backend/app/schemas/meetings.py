"""
Meeting Minutes Pydantic Schemas

Request and response schemas for meeting minutes endpoints.
"""

from datetime import date, datetime, time
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.meeting import ActionItemStatus, MeetingStatus, MeetingType
from app.schemas.base import UTCResponseBase
from app.utils.agenda_items import (
    MAX_AGENDA_ITEMS,
    MAX_ITEM_DOCUMENTS,
    MAX_MOTION_TEXT,
    MAX_NOTES,
    MAX_PRESENTER,
    MAX_TITLE,
    is_valid_item_key,
    normalize_agenda_items,
)

# Meeting.meeting_type/status and MeetingActionItem.status are strict MySQL ENUMs;
# SQLAlchemy doesn't validate the string on bind (validate_strings=False), so a
# value outside the set reaches MySQL and 500s (or stores '' under non-strict
# mode). `MeetingsService.update_meeting`/`update_action_item` hand the value to
# `apply_updates`, which checks nullability but not enum membership, so — unlike
# the MinuteService paths that coerce through the enum constructor — nothing
# rejects a bad value before the bind. Validate them at the request schema so a
# bad value is a clean 422 instead (MM2-2/MM2-3, the B1 latent-500 class).
_MEETING_TYPES = {e.value for e in MeetingType}
_MEETING_STATUSES = {e.value for e in MeetingStatus}
_ACTION_ITEM_STATUSES = {e.value for e in ActionItemStatus}


def _validate_enum(value: Optional[str], valid: set, field: str) -> Optional[str]:
    if value is None:
        return value
    normalized = value.lower() if isinstance(value, str) else value
    if normalized not in valid:
        raise ValueError(
            f"Invalid {field} '{value}'. Must be one of: " f"{', '.join(sorted(valid))}"
        )
    return normalized


def _validate_meeting_type(value: Optional[str]) -> Optional[str]:
    return _validate_enum(value, _MEETING_TYPES, "meeting_type")


def _validate_meeting_status(value: Optional[str]) -> Optional[str]:
    return _validate_enum(value, _MEETING_STATUSES, "status")


def _validate_action_item_status(value: Optional[str]) -> Optional[str]:
    return _validate_enum(value, _ACTION_ITEM_STATUSES, "status")


# ============================================
# Meeting Attendee Schemas
# ============================================


class MeetingAttendeeCreate(BaseModel):
    """Schema for adding a meeting attendee"""

    user_id: UUID
    present: bool = True
    excused: bool = False


class MeetingAttendeeResponse(UTCResponseBase):
    """Schema for meeting attendee response"""

    id: UUID
    meeting_id: UUID
    user_id: UUID
    present: bool
    excused: bool
    user_name: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ============================================
# Meeting Action Item Schemas
# ============================================


class ActionItemCreate(BaseModel):
    """Schema for creating an action item"""

    description: str = Field(..., min_length=1)
    assigned_to: Optional[UUID] = None
    due_date: Optional[date] = None
    priority: int = Field(default=0, ge=0, le=2)


class ActionItemUpdate(BaseModel):
    """Schema for updating an action item"""

    description: Optional[str] = Field(None, min_length=1)
    assigned_to: Optional[UUID] = None
    due_date: Optional[date] = None
    status: Optional[str] = None
    priority: Optional[int] = Field(None, ge=0, le=2)
    completion_notes: Optional[str] = None

    _check_status = field_validator("status")(_validate_action_item_status)


class ActionItemResponse(UTCResponseBase):
    """Schema for action item response"""

    id: UUID
    meeting_id: UUID
    organization_id: UUID
    description: str
    assigned_to: Optional[UUID] = None
    assignee_name: Optional[str] = None
    due_date: Optional[date] = None
    status: str
    priority: int = 0
    completed_at: Optional[datetime] = None
    completion_notes: Optional[str] = None
    created_by: Optional[UUID] = None
    source: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ============================================
# Meeting Schemas
# ============================================


class AgendaDocument(BaseModel):
    """A Documents-library file an agenda item points at."""

    id: str = Field(..., min_length=1, max_length=36)
    name: str = Field(default="", max_length=255)


class AgendaItem(BaseModel):
    """One item on a meeting's agenda."""

    key: str = Field(
        ...,
        description="Stable across edits; the minutes section made from this item "
        "is named agenda-<key>",
    )
    title: str = Field(..., min_length=1, max_length=MAX_TITLE)
    presenter: str = Field(default="", max_length=MAX_PRESENTER)
    notes: str = Field(default="", max_length=MAX_NOTES)
    needs_motion: bool = False
    motion_text: str = Field(default="", max_length=MAX_MOTION_TEXT)
    documents: List[AgendaDocument] = Field(
        default_factory=list, max_length=MAX_ITEM_DOCUMENTS
    )

    @field_validator("key")
    @classmethod
    def _check_key(cls, value: str) -> str:
        if not is_valid_item_key(value):
            raise ValueError(
                "An agenda item key is lowercase letters, digits, - or _, "
                "up to 50 characters"
            )
        return value

    @field_validator("title")
    @classmethod
    def _check_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("An agenda item needs a title")
        return value


def _validate_agenda_items(value: Optional[List["AgendaItem"]]):
    if value is None:
        return value
    keys = [item.key for item in value]
    if len(set(keys)) != len(keys):
        raise ValueError("Each agenda item needs its own key")
    return value


class MeetingCreate(BaseModel):
    """Schema for creating a meeting"""

    title: str = Field(..., min_length=1, max_length=255)
    meeting_type: str = "business"
    meeting_date: date
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    location: Optional[str] = Field(None, max_length=255)
    called_by: Optional[str] = Field(None, max_length=255)
    agenda: Optional[str] = None
    agenda_items: Optional[List[AgendaItem]] = Field(None, max_length=MAX_AGENDA_ITEMS)
    notes: Optional[str] = None
    motions: Optional[str] = None
    attendees: Optional[List[MeetingAttendeeCreate]] = None
    action_items: Optional[List[ActionItemCreate]] = None

    _check_meeting_type = field_validator("meeting_type")(_validate_meeting_type)
    _check_agenda_items = field_validator("agenda_items")(_validate_agenda_items)


class MeetingUpdate(BaseModel):
    """Schema for updating a meeting"""

    title: Optional[str] = Field(None, min_length=1, max_length=255)
    meeting_type: Optional[str] = None
    meeting_date: Optional[date] = None
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    location: Optional[str] = Field(None, max_length=255)
    called_by: Optional[str] = Field(None, max_length=255)
    status: Optional[str] = None
    agenda: Optional[str] = None
    agenda_items: Optional[List[AgendaItem]] = Field(None, max_length=MAX_AGENDA_ITEMS)
    notes: Optional[str] = None
    motions: Optional[str] = None

    _check_meeting_type = field_validator("meeting_type")(_validate_meeting_type)
    _check_status = field_validator("status")(_validate_meeting_status)
    _check_agenda_items = field_validator("agenda_items")(_validate_agenda_items)


class MeetingResponse(UTCResponseBase):
    """Schema for meeting response"""

    id: UUID
    organization_id: UUID
    title: str
    meeting_type: str
    meeting_date: date
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    location: Optional[str] = None
    called_by: Optional[str] = None
    status: str
    agenda: Optional[str] = None
    agenda_items: List[AgendaItem] = Field(default_factory=list)
    notes: Optional[str] = None
    motions: Optional[str] = None
    approved_by: Optional[UUID] = None
    approved_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None
    creator_name: Optional[str] = None
    attendee_count: Optional[int] = 0
    action_item_count: Optional[int] = 0

    model_config = ConfigDict(from_attributes=True)

    @field_validator("agenda_items", mode="before")
    @classmethod
    def _read_agenda_items(cls, value):
        return normalize_agenda_items(value)


class MeetingDetailResponse(MeetingResponse):
    """Extended meeting response with attendees and action items"""

    attendees: List[MeetingAttendeeResponse] = []
    action_items: List[ActionItemResponse] = []

    model_config = ConfigDict(from_attributes=True)


class MeetingsListResponse(BaseModel):
    """Schema for paginated meetings list"""

    meetings: List[MeetingResponse]
    total: int
    skip: int
    limit: int


# ============================================
# Summary Schemas
# ============================================


class MeetingsSummary(BaseModel):
    """Schema for meetings module summary"""

    total_meetings: int
    meetings_this_month: int
    open_action_items: int
    pending_approval: int

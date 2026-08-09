"""
Meeting Minutes Pydantic Schemas

Request and response schemas for meeting minutes endpoints.
"""

from datetime import date, datetime, time
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.meeting import MeetingType
from app.schemas.base import UTCResponseBase

# Meeting.meeting_type is a strict MySQL ENUM; SQLAlchemy doesn't validate the
# string on bind (validate_strings=False), so a value outside this set reaches
# MySQL and 500s (or stores '' under non-strict mode). Validate it at the request
# schema so a bad value is a clean 422 instead (MM2-2, the B1 latent-500 class).
_MEETING_TYPES = {e.value for e in MeetingType}


def _validate_meeting_type(value: Optional[str]) -> Optional[str]:
    if value is None:
        return value
    normalized = value.lower() if isinstance(value, str) else value
    if normalized not in _MEETING_TYPES:
        raise ValueError(
            f"Invalid meeting_type '{value}'. Must be one of: "
            f"{', '.join(sorted(_MEETING_TYPES))}"
        )
    return normalized


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
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ============================================
# Meeting Schemas
# ============================================


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
    notes: Optional[str] = None
    motions: Optional[str] = None
    attendees: Optional[List[MeetingAttendeeCreate]] = None
    action_items: Optional[List[ActionItemCreate]] = None

    _check_meeting_type = field_validator("meeting_type")(_validate_meeting_type)


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
    notes: Optional[str] = None
    motions: Optional[str] = None

    _check_meeting_type = field_validator("meeting_type")(_validate_meeting_type)


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

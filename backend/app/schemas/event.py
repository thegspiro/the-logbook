"""
Event Pydantic Schemas

Request and response schemas for event-related endpoints.
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Dict, Any
from datetime import datetime
from uuid import UUID


# Event Schemas

class EventBase(BaseModel):
    """Base event schema"""
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    event_type: str = Field(..., description="Event type: business_meeting, public_education, training, social, fundraiser, ceremony, other")
    location_id: Optional[UUID] = Field(None, description="FK to Location table for predefined locations")
    location: Optional[str] = Field(None, max_length=300, description="Free-text location for 'Other Location' option")
    location_details: Optional[str] = None
    start_datetime: datetime
    end_datetime: datetime
    requires_rsvp: bool = Field(default=False)
    rsvp_deadline: Optional[datetime] = None
    max_attendees: Optional[int] = Field(default=None, ge=1)
    allowed_rsvp_statuses: Optional[List[str]] = Field(default=None, description="Allowed RSVP statuses. Defaults to ['going', 'not_going']")
    is_mandatory: bool = Field(default=False)
    eligible_roles: Optional[List[str]] = Field(default=None, description="Role slugs, null means all members")
    allow_guests: bool = Field(default=False)
    send_reminders: bool = Field(default=True)
    reminder_hours_before: int = Field(default=24, ge=1, le=168)  # 1 hour to 1 week
    custom_fields: Optional[Dict[str, Any]] = None
    attachments: Optional[List[Dict[str, str]]] = None


class EventCreate(EventBase):
    """Schema for creating a new event"""
    pass


class EventUpdate(BaseModel):
    """Schema for updating an event"""
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    event_type: Optional[str] = None
    location_id: Optional[UUID] = Field(None, description="FK to Location table for predefined locations")
    location: Optional[str] = Field(None, max_length=300, description="Free-text location for 'Other Location' option")
    location_details: Optional[str] = None
    start_datetime: Optional[datetime] = None
    end_datetime: Optional[datetime] = None
    requires_rsvp: Optional[bool] = None
    rsvp_deadline: Optional[datetime] = None
    max_attendees: Optional[int] = Field(None, ge=1)
    allowed_rsvp_statuses: Optional[List[str]] = None
    is_mandatory: Optional[bool] = None
    eligible_roles: Optional[List[str]] = None
    allow_guests: Optional[bool] = None
    send_reminders: Optional[bool] = None
    reminder_hours_before: Optional[int] = Field(None, ge=1, le=168)
    custom_fields: Optional[Dict[str, Any]] = None
    attachments: Optional[List[Dict[str, str]]] = None


class EventCancel(BaseModel):
    """Schema for cancelling an event"""
    cancellation_reason: str = Field(..., min_length=10, max_length=500)


class EventResponse(EventBase):
    """Schema for event response"""
    id: UUID
    organization_id: UUID
    actual_start_time: Optional[datetime] = None
    actual_end_time: Optional[datetime] = None
    is_cancelled: bool = False
    cancellation_reason: Optional[str] = None
    cancelled_at: Optional[datetime] = None
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    # Additional computed fields
    rsvp_count: Optional[int] = None
    going_count: Optional[int] = None
    not_going_count: Optional[int] = None
    maybe_count: Optional[int] = None
    user_rsvp_status: Optional[str] = None  # Current user's RSVP status
    location_name: Optional[str] = None  # Name of the location if location_id is set

    model_config = ConfigDict(from_attributes=True)


class EventListItem(BaseModel):
    """Schema for event list items"""
    id: UUID
    title: str
    event_type: str
    start_datetime: datetime
    end_datetime: datetime
    location_id: Optional[UUID] = None
    location: Optional[str] = None
    location_name: Optional[str] = None  # Resolved location name if location_id is set
    requires_rsvp: bool
    is_mandatory: bool
    is_cancelled: bool
    rsvp_count: Optional[int] = None
    going_count: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)


# RSVP Schemas

class RSVPBase(BaseModel):
    """Base RSVP schema"""
    status: str = Field(..., description="RSVP status: going, not_going, maybe")
    guest_count: int = Field(default=0, ge=0, le=10)
    notes: Optional[str] = Field(None, max_length=500)


class RSVPCreate(RSVPBase):
    """Schema for creating/updating an RSVP"""
    pass


class RSVPResponse(RSVPBase):
    """Schema for RSVP response"""
    id: UUID
    event_id: UUID
    user_id: UUID
    responded_at: datetime
    updated_at: datetime
    checked_in: bool = False
    checked_in_at: Optional[datetime] = None

    # User details (populated by service)
    user_name: Optional[str] = None
    user_email: Optional[str] = None

    # Attendance duration (populated when event has actual times)
    attendance_duration_minutes: Optional[float] = None

    model_config = ConfigDict(from_attributes=True)


class CheckInRequest(BaseModel):
    """Schema for checking in an attendee"""
    user_id: UUID


class RecordActualTimes(BaseModel):
    """Schema for recording actual event start/end times"""
    actual_start_time: Optional[datetime] = Field(None, description="When the event actually started")
    actual_end_time: Optional[datetime] = Field(None, description="When the event actually ended")


class QRCheckInData(BaseModel):
    """Schema for QR code check-in data"""
    event_id: str
    event_name: str
    event_type: Optional[str] = None
    event_description: Optional[str] = None  # Event description for display
    start_datetime: str
    end_datetime: str
    actual_end_time: Optional[str] = None
    check_in_start: str
    check_in_end: str
    is_valid: bool
    location: Optional[str] = None
    location_id: Optional[str] = None
    location_name: Optional[str] = None


class EventStats(BaseModel):
    """Event statistics"""
    event_id: UUID
    total_rsvps: int
    going_count: int
    not_going_count: int
    maybe_count: int
    checked_in_count: int
    total_guests: int
    capacity_percentage: Optional[float] = None  # If max_attendees is set

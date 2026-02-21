"""
Event Pydantic Schemas

Request and response schemas for event-related endpoints.
"""

from pydantic import BaseModel, Field, ConfigDict, model_validator
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
    allow_guests: bool = Field(default=False)
    send_reminders: bool = Field(default=True)
    reminder_schedule: List[int] = Field(default=[24], description="Hours before event to send reminders (e.g. [168, 24] for 1 week + 1 day)")
    check_in_window_type: Optional[str] = Field(default="flexible", description="Check-in window type: flexible, strict, window")
    check_in_minutes_before: Optional[int] = Field(default=30, description="Minutes before event start to allow check-in")
    check_in_minutes_after: Optional[int] = Field(default=15, description="For 'window' type: minutes after event start")
    require_checkout: bool = Field(default=False, description="Require manual check-out")
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
    allow_guests: Optional[bool] = None
    send_reminders: Optional[bool] = None
    reminder_schedule: Optional[List[int]] = None
    check_in_window_type: Optional[str] = None
    check_in_minutes_before: Optional[int] = None
    check_in_minutes_after: Optional[int] = None
    require_checkout: Optional[bool] = None
    custom_fields: Optional[Dict[str, Any]] = None
    attachments: Optional[List[Dict[str, str]]] = None


class EventCancel(BaseModel):
    """Schema for cancelling an event"""
    cancellation_reason: str = Field(..., min_length=10, max_length=500)
    send_notifications: bool = Field(default=False, description="Send cancellation notifications to RSVPs")


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
    updated_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    # Recurrence fields
    is_recurring: bool = False
    recurrence_pattern: Optional[str] = None
    recurrence_end_date: Optional[datetime] = None
    recurrence_custom_days: Optional[List[int]] = None
    recurrence_parent_id: Optional[UUID] = None

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
    checked_out_at: Optional[datetime] = None

    # User details (populated by service)
    user_name: Optional[str] = None
    user_email: Optional[str] = None

    # Attendance duration (populated when event has actual times)
    attendance_duration_minutes: Optional[int] = None

    # Override fields (for manager adjustments)
    override_check_in_at: Optional[datetime] = None
    override_check_out_at: Optional[datetime] = None
    override_duration_minutes: Optional[int] = None
    overridden_by: Optional[UUID] = None
    overridden_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class CheckInRequest(BaseModel):
    """Schema for checking in an attendee"""
    user_id: UUID


class SelfCheckInRequest(BaseModel):
    """Schema for self check-in/check-out via QR code"""
    is_checkout: bool = Field(default=False, description="Set to true for check-out")


class ManagerAddAttendee(BaseModel):
    """Schema for a manager adding someone to an event"""
    user_id: UUID
    status: str = Field(default="going", description="RSVP status: going, not_going, maybe")
    checked_in: bool = Field(default=False, description="Mark as checked in immediately")
    notes: Optional[str] = Field(None, max_length=500)


class RSVPOverride(BaseModel):
    """Schema for manager overriding attendance details"""
    override_check_in_at: Optional[datetime] = Field(None, description="Override check-in time")
    override_check_out_at: Optional[datetime] = Field(None, description="Override check-out time")
    override_duration_minutes: Optional[int] = Field(None, ge=0, description="Override total attendance duration in minutes")


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
    require_checkout: bool = Field(default=False, description="Whether this event requires checkout")


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


class CheckInActivity(BaseModel):
    """Recent check-in activity for monitoring"""
    user_id: UUID
    user_name: str
    user_email: str
    checked_in_at: datetime
    rsvp_status: str
    guest_count: int


class CheckInMonitoringStats(BaseModel):
    """Real-time check-in monitoring statistics"""
    event_id: UUID
    event_name: str
    event_type: str
    start_datetime: datetime
    end_datetime: datetime
    is_check_in_active: bool
    check_in_window_start: datetime
    check_in_window_end: datetime

    # Counts
    total_eligible_members: int
    total_rsvps: int
    total_checked_in: int
    check_in_rate: float  # Percentage of eligible members checked in

    # Recent activity
    recent_check_ins: List[CheckInActivity]

    # Time-based stats
    avg_check_in_time_minutes: Optional[float] = None  # Average time before event start
    last_check_in_at: Optional[datetime] = None


# ============================================================
# Event Templates
# ============================================================

class EventTemplateCreate(BaseModel):
    """Schema for creating an event template"""
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    event_type: str = Field(default="other")
    default_title: Optional[str] = Field(None, max_length=200)
    default_description: Optional[str] = None
    default_location_id: Optional[UUID] = None
    default_location: Optional[str] = Field(None, max_length=300)
    default_location_details: Optional[str] = None
    default_duration_minutes: Optional[int] = Field(None, ge=1)
    requires_rsvp: bool = False
    max_attendees: Optional[int] = Field(None, ge=1)
    is_mandatory: bool = False
    allow_guests: bool = False
    check_in_window_type: Optional[str] = None
    check_in_minutes_before: Optional[int] = Field(default=30, ge=0)
    check_in_minutes_after: Optional[int] = Field(default=15, ge=0)
    require_checkout: bool = False
    send_reminders: bool = True
    reminder_schedule: List[int] = Field(default=[24])
    custom_fields_template: Optional[Dict[str, Any]] = None


class EventTemplateUpdate(BaseModel):
    """Schema for updating an event template"""
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    event_type: Optional[str] = None
    default_title: Optional[str] = Field(None, max_length=200)
    default_description: Optional[str] = None
    default_location_id: Optional[UUID] = None
    default_location: Optional[str] = Field(None, max_length=300)
    default_location_details: Optional[str] = None
    default_duration_minutes: Optional[int] = Field(None, ge=1)
    requires_rsvp: Optional[bool] = None
    max_attendees: Optional[int] = Field(None, ge=1)
    is_mandatory: Optional[bool] = None
    allow_guests: Optional[bool] = None
    check_in_window_type: Optional[str] = None
    check_in_minutes_before: Optional[int] = Field(None, ge=0)
    check_in_minutes_after: Optional[int] = Field(None, ge=0)
    require_checkout: Optional[bool] = None
    send_reminders: Optional[bool] = None
    reminder_schedule: Optional[List[int]] = None
    custom_fields_template: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None


class EventTemplateResponse(BaseModel):
    """Schema for event template response"""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    organization_id: UUID
    name: str
    description: Optional[str] = None
    event_type: str
    default_title: Optional[str] = None
    default_description: Optional[str] = None
    default_location_id: Optional[UUID] = None
    default_location: Optional[str] = None
    default_location_details: Optional[str] = None
    default_duration_minutes: Optional[int] = None
    requires_rsvp: bool
    max_attendees: Optional[int] = None
    is_mandatory: bool
    allow_guests: bool
    check_in_window_type: Optional[str] = None
    check_in_minutes_before: Optional[int] = None
    check_in_minutes_after: Optional[int] = None
    require_checkout: bool
    send_reminders: bool
    reminder_schedule: List[int] = Field(default=[24])
    custom_fields_template: Optional[Dict[str, Any]] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


# ============================================================
# Recurring Events
# ============================================================

class RecurringEventCreate(BaseModel):
    """Schema for creating a recurring event series"""
    # Base event data
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    event_type: str = Field(default="other")
    location_id: Optional[UUID] = None
    location: Optional[str] = Field(None, max_length=300)
    location_details: Optional[str] = None

    # Schedule
    start_datetime: datetime  # Start of first occurrence
    end_datetime: datetime  # End of first occurrence (defines duration)
    recurrence_pattern: str = Field(..., description="daily, weekly, biweekly, monthly, custom")
    recurrence_end_date: datetime  # When the series ends
    recurrence_custom_days: Optional[List[int]] = Field(None, description="For custom: weekday numbers (0=Mon, 6=Sun)")

    # Event settings (same as EventCreate)
    requires_rsvp: bool = False
    rsvp_deadline: Optional[datetime] = None
    max_attendees: Optional[int] = Field(None, ge=1)
    is_mandatory: bool = False
    allow_guests: bool = False
    send_reminders: bool = True
    reminder_schedule: List[int] = Field(default=[24])
    check_in_window_type: Optional[str] = Field(default="flexible")
    check_in_minutes_before: Optional[int] = Field(default=30, ge=0)
    check_in_minutes_after: Optional[int] = Field(default=15, ge=0)
    require_checkout: bool = False
    template_id: Optional[UUID] = None  # Created from a template

    @model_validator(mode="after")
    def validate_custom_days(self):
        if self.recurrence_pattern == "custom" and not self.recurrence_custom_days:
            raise ValueError("recurrence_custom_days is required when recurrence_pattern is 'custom'")
        return self

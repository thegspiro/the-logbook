"""
Event Pydantic Schemas

Request and response schemas for event-related endpoints.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.base import UTCResponseBase

_response_config = ConfigDict(from_attributes=True)

# ============================================================
# Event Module Settings
# ============================================================


class RequestPipelineTask(BaseModel):
    """A single task in the event request pipeline."""

    id: str = Field(..., min_length=1, max_length=100)
    label: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=500)


class EmailTriggerConfig(BaseModel):
    """Configuration for a single email trigger."""

    enabled: Optional[bool] = None
    notify_assignee: Optional[bool] = None
    notify_requester: Optional[bool] = None
    days: Optional[List[int]] = None


class RequestPipelineUpdate(BaseModel):
    """Settings for the event request pipeline."""

    min_lead_time_days: Optional[int] = Field(None, ge=0)
    default_assignee_id: Optional[str] = None
    public_progress_visible: Optional[bool] = None
    tasks: Optional[List[RequestPipelineTask]] = None
    email_triggers: Optional[Dict[str, EmailTriggerConfig]] = None


class EventDefaultsUpdate(BaseModel):
    """Default settings for new events."""

    event_type: Optional[str] = Field(None, max_length=100)
    check_in_window_type: Optional[str] = Field(None, max_length=50)
    check_in_minutes_before: Optional[int] = Field(None, ge=0)
    check_in_minutes_after: Optional[int] = Field(None, ge=0)
    require_checkout: Optional[bool] = None
    requires_rsvp: Optional[bool] = None
    allowed_rsvp_statuses: Optional[List[str]] = None
    allow_guests: Optional[bool] = None
    is_mandatory: Optional[bool] = None
    send_reminders: Optional[bool] = None
    reminder_schedule: Optional[List[int]] = None
    default_reminder_time: Optional[str] = Field(None, max_length=10)
    default_duration_minutes: Optional[int] = Field(None, ge=1)


class OutreachEventType(BaseModel):
    """An outreach event type option."""

    value: str = Field(..., min_length=1, max_length=100)
    label: str = Field(..., min_length=1, max_length=200)


class EventCategoryConfig(BaseModel):
    """A custom event category with value, label, and color."""

    value: str = Field(..., min_length=1, max_length=100)
    label: str = Field(..., min_length=1, max_length=200)
    color: str = Field(..., max_length=200)


class EventSettingsUpdate(BaseModel):
    """
    Schema for updating event module settings.

    Only keys present in EVENT_SETTINGS_DEFAULTS are accepted.
    All fields are optional for partial updates.
    """

    enabled_event_types: Optional[List[str]] = None
    visible_event_types: Optional[List[str]] = None
    event_type_labels: Optional[Dict[str, str]] = None
    custom_event_categories: Optional[List[EventCategoryConfig]] = None
    visible_custom_categories: Optional[List[str]] = None
    outreach_event_types: Optional[List[OutreachEventType]] = None
    request_pipeline: Optional[RequestPipelineUpdate] = None
    defaults: Optional[EventDefaultsUpdate] = None


# Event Schemas


class EventBase(BaseModel):
    """Base event schema"""

    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    event_type: str = Field(
        ...,
        description=(
            "Event type: business_meeting, public_education,"
            " training, social, fundraiser, ceremony, other"
        ),
    )
    location_id: Optional[UUID] = Field(
        None, description="FK to Location table for predefined locations"
    )
    location: Optional[str] = Field(
        None,
        max_length=300,
        description="Free-text location for 'Other Location' option",
    )
    location_details: Optional[str] = None
    start_datetime: datetime
    end_datetime: datetime
    requires_rsvp: bool = Field(default=False)
    rsvp_deadline: Optional[datetime] = None
    max_attendees: Optional[int] = Field(default=None, ge=1)
    allowed_rsvp_statuses: Optional[List[str]] = Field(
        default=None,
        description="Allowed RSVP statuses. Defaults to ['going', 'not_going']",
    )
    is_mandatory: bool = Field(default=False)
    allow_guests: bool = Field(default=False)
    send_reminders: bool = Field(default=True)
    reminder_schedule: List[int] = Field(
        default=[24],
        description=(
            "Hours before event to send reminders"
            " (e.g. [168, 24] for 1 week + 1 day)"
        ),
    )
    check_in_window_type: Optional[str] = Field(
        default="flexible", description="Check-in window type: flexible, strict, window"
    )
    check_in_minutes_before: Optional[int] = Field(
        default=30, description="Minutes before event start to allow check-in"
    )
    check_in_minutes_after: Optional[int] = Field(
        default=15, description="For 'window' type: minutes after event start"
    )
    require_checkout: bool = Field(
        default=False, description="Require manual check-out"
    )
    custom_category: Optional[str] = Field(
        None,
        max_length=100,
        description="Organization-defined custom event category",
    )
    custom_fields: Optional[Dict[str, Any]] = None
    attachments: Optional[List[Dict[str, str]]] = None
    is_draft: bool = False


class EventCreate(EventBase):
    """Schema for creating a new event"""

    @model_validator(mode="after")
    def validate_dates(self) -> "EventCreate":
        if self.end_datetime <= self.start_datetime:
            raise ValueError("end_datetime must be after start_datetime")
        if self.requires_rsvp and self.rsvp_deadline is None:
            raise ValueError("rsvp_deadline is required when requires_rsvp is True")
        return self


class EventUpdate(BaseModel):
    """Schema for updating an event"""

    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    event_type: Optional[str] = None
    location_id: Optional[UUID] = Field(
        None, description="FK to Location table for predefined locations"
    )
    location: Optional[str] = Field(
        None,
        max_length=300,
        description="Free-text location for 'Other Location' option",
    )
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
    custom_category: Optional[str] = Field(
        None,
        max_length=100,
        description="Organization-defined custom event category",
    )
    custom_fields: Optional[Dict[str, Any]] = None
    attachments: Optional[List[Dict[str, str]]] = None
    is_draft: Optional[bool] = None

    @model_validator(mode="after")
    def validate_dates(self) -> "EventUpdate":
        if self.start_datetime and self.end_datetime:
            if self.end_datetime <= self.start_datetime:
                raise ValueError("end_datetime must be after start_datetime")
        return self


class EventCancel(BaseModel):
    """Schema for cancelling an event"""

    cancellation_reason: str = Field(..., min_length=10, max_length=500)
    send_notifications: bool = Field(
        default=False, description="Send cancellation notifications to RSVPs"
    )


class EventResponse(EventBase, UTCResponseBase):
    """Schema for event response"""

    id: UUID
    organization_id: UUID
    actual_start_time: Optional[datetime] = None
    actual_end_time: Optional[datetime] = None
    is_draft: bool = False
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
    recurrence_weekday: Optional[int] = None
    recurrence_week_ordinal: Optional[int] = None
    recurrence_month: Optional[int] = None
    recurrence_exceptions: Optional[List[str]] = None
    rolling_recurrence: bool = False
    recurrence_parent_id: Optional[UUID] = None
    template_id: Optional[UUID] = None

    # Additional computed fields
    rsvp_count: Optional[int] = None
    going_count: Optional[int] = None
    not_going_count: Optional[int] = None
    maybe_count: Optional[int] = None
    user_rsvp_status: Optional[str] = None  # Current user's RSVP status
    location_name: Optional[str] = None  # Name of the location if location_id is set

    model_config = _response_config


class EventListItem(UTCResponseBase):
    """Schema for event list items"""

    id: UUID
    title: str
    event_type: str
    custom_category: Optional[str] = None
    start_datetime: datetime
    end_datetime: datetime
    location_id: Optional[UUID] = None
    location: Optional[str] = None
    location_name: Optional[str] = None  # Resolved location name if location_id is set
    requires_rsvp: bool
    is_mandatory: bool
    is_draft: bool = False
    is_cancelled: bool
    is_recurring: bool = False
    recurrence_parent_id: Optional[UUID] = None
    rsvp_count: Optional[int] = None
    going_count: Optional[int] = None
    user_rsvp_status: Optional[str] = None

    model_config = _response_config


# RSVP Schemas


class RSVPBase(BaseModel):
    """Base RSVP schema"""

    status: str = Field(..., description="RSVP status: going, not_going, maybe")
    guest_count: int = Field(default=0, ge=0, le=10)
    notes: Optional[str] = Field(None, max_length=500)
    dietary_restrictions: Optional[str] = Field(None, max_length=500)
    accessibility_needs: Optional[str] = Field(None, max_length=500)


class RSVPCreate(RSVPBase):
    """Schema for creating/updating an RSVP"""


class RSVPResponse(RSVPBase, UTCResponseBase):
    """Schema for RSVP response"""

    id: UUID
    event_id: UUID
    user_id: UUID
    responded_at: datetime
    updated_at: datetime
    checked_in: bool = False
    checked_in_at: Optional[datetime] = None
    checked_out_at: Optional[datetime] = None

    dietary_restrictions: Optional[str] = None
    accessibility_needs: Optional[str] = None

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

    model_config = _response_config


class CheckInRequest(BaseModel):
    """Schema for checking in an attendee"""

    user_id: UUID


class SelfCheckInRequest(BaseModel):
    """Schema for self check-in/check-out via QR code"""

    is_checkout: bool = Field(default=False, description="Set to true for check-out")


class ManagerAddAttendee(BaseModel):
    """Schema for a manager adding someone to an event"""

    user_id: UUID
    status: str = Field(
        default="going", description="RSVP status: going, not_going, maybe"
    )
    checked_in: bool = Field(
        default=False, description="Mark as checked in immediately"
    )
    notes: Optional[str] = Field(None, max_length=500)


class BulkAddAttendees(BaseModel):
    """Schema for bulk-adding multiple attendees to an event"""

    user_ids: List[UUID]
    status: str = Field(
        default="going", description="RSVP status: going, not_going, maybe"
    )


class RSVPOverride(BaseModel):
    """Schema for manager overriding attendance details"""

    override_check_in_at: Optional[datetime] = Field(
        None, description="Override check-in time"
    )
    override_check_out_at: Optional[datetime] = Field(
        None, description="Override check-out time"
    )
    override_duration_minutes: Optional[int] = Field(
        None, ge=0, description="Override total attendance duration in minutes"
    )


class RecordActualTimes(BaseModel):
    """Schema for recording actual event start/end times"""

    actual_start_time: Optional[datetime] = Field(
        None, description="When the event actually started"
    )
    actual_end_time: Optional[datetime] = Field(
        None, description="When the event actually ended"
    )


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
    require_checkout: bool = Field(
        default=False, description="Whether this event requires checkout"
    )
    timezone: Optional[str] = Field(
        default=None, description="Organization IANA timezone for display"
    )


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


class CheckInActivity(UTCResponseBase):
    """Recent check-in activity for monitoring"""

    user_id: UUID
    user_name: str
    user_email: str
    checked_in_at: datetime
    rsvp_status: str
    guest_count: int


class CheckInMonitoringStats(UTCResponseBase):
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


class EventTemplateResponse(UTCResponseBase):
    """Schema for event template response"""

    model_config = _response_config

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


class RSVPHistoryResponse(UTCResponseBase):
    """Schema for RSVP history response"""

    id: UUID
    rsvp_id: UUID
    event_id: UUID
    user_id: UUID
    old_status: Optional[str] = None
    new_status: str
    changed_at: datetime
    changed_by: Optional[UUID] = None

    # Populated by service
    user_name: Optional[str] = None
    changer_name: Optional[str] = None

    model_config = _response_config


# ============================================================
# Event Notifications
# ============================================================


class EventNotificationType(str, Enum):
    """Types of event notifications."""

    ANNOUNCEMENT = "announcement"
    REMINDER = "reminder"
    FOLLOW_UP = "follow_up"
    MISSED_EVENT = "missed_event"
    CHECK_IN_CONFIRMATION = "check_in_confirmation"


class EventNotificationTarget(str, Enum):
    """Target audience for event notifications."""

    ALL = "all"
    GOING = "going"
    NOT_RESPONDED = "not_responded"
    CHECKED_IN = "checked_in"
    NOT_CHECKED_IN = "not_checked_in"


class EventNotificationRequest(BaseModel):
    """Schema for sending an event notification."""

    notification_type: EventNotificationType = Field(
        ..., description="Type of notification to send"
    )
    message: Optional[str] = Field(
        None,
        max_length=2000,
        description="Optional custom message to include in the notification",
    )
    target: EventNotificationTarget = Field(
        default=EventNotificationTarget.ALL,
        description="Target audience for the notification",
    )


class EventNotificationResponse(BaseModel):
    """Response after sending an event notification."""

    message: str
    recipients_count: int


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
    recurrence_pattern: str = Field(
        ...,
        description=(
            "daily, weekly, biweekly, monthly, monthly_weekday, "
            "annually, annually_weekday, custom"
        ),
    )
    recurrence_end_date: Optional[datetime] = (
        None  # When the series ends (auto-set for rolling)
    )
    rolling_recurrence: bool = Field(
        default=False,
        description="Auto-extend series on a rolling 12-month window",
    )
    recurrence_custom_days: Optional[List[int]] = Field(
        None, description="For custom: weekday numbers (0=Mon, 6=Sun)"
    )
    recurrence_weekday: Optional[int] = Field(
        None,
        ge=0,
        le=6,
        description="For monthly_weekday/annually_weekday: weekday (0=Mon, 6=Sun)",
    )
    recurrence_week_ordinal: Optional[int] = Field(
        None,
        description="Which occurrence: 1=first, 2=second, ..., 5=fifth, -1=last",
    )
    recurrence_month: Optional[int] = Field(
        None,
        ge=1,
        le=12,
        description="For annually_weekday: target month (1=Jan, 12=Dec)",
    )

    recurrence_exceptions: Optional[List[str]] = None

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
    custom_category: Optional[str] = Field(
        None,
        max_length=100,
        description="Organization-defined custom event category",
    )
    custom_fields: Optional[Dict[str, Any]] = None
    attachments: Optional[List[Dict[str, str]]] = None
    allowed_rsvp_statuses: Optional[List[str]] = Field(
        default=None,
        description="Allowed RSVP statuses. Defaults to ['going', 'not_going']",
    )
    template_id: Optional[UUID] = None  # Created from a template

    @model_validator(mode="after")
    def validate_recurrence_fields(self):
        if not self.rolling_recurrence and not self.recurrence_end_date:
            raise ValueError(
                "recurrence_end_date is required unless rolling_recurrence is true"
            )
        if self.recurrence_pattern == "custom" and not self.recurrence_custom_days:
            raise ValueError(
                "recurrence_custom_days is required when recurrence_pattern is 'custom'"
            )
        if self.recurrence_pattern in ("monthly_weekday", "annually_weekday"):
            if self.recurrence_weekday is None:
                raise ValueError(
                    "recurrence_weekday is required for monthly_weekday/annually_weekday"
                )
            if self.recurrence_week_ordinal is None:
                raise ValueError(
                    "recurrence_week_ordinal is required for monthly_weekday/annually_weekday"
                )
        if self.recurrence_pattern == "annually_weekday":
            if self.recurrence_month is None:
                raise ValueError("recurrence_month is required for annually_weekday")
        return self


# ============================================================
# Analytics Schemas (#44, #46, #47)
# ============================================================


class EventTypeDistribution(BaseModel):
    """Count of events per event type."""

    event_type: str
    count: int


class MonthlyEventCount(BaseModel):
    """Number of events per month (for trend chart)."""

    month: str  # "YYYY-MM"
    count: int


class TopEventByAttendance(UTCResponseBase):
    """An event ranked by check-in attendance."""

    event_id: str
    title: str
    event_type: str
    start_datetime: datetime
    going_count: int
    checked_in_count: int
    attendance_rate: float  # checked_in / going as 0-1


class AnalyticsSummary(BaseModel):
    """Aggregated analytics for the attendance trends dashboard."""

    total_events: int
    total_rsvps: int
    total_checked_in: int
    avg_attendance_rate: float  # 0-1
    check_in_rate: float  # 0-1
    avg_checkin_minutes_before: Optional[float] = None
    event_type_distribution: List[EventTypeDistribution]
    monthly_event_counts: List[MonthlyEventCount]
    top_events: List[TopEventByAttendance]

"""
Event Request Pydantic Schemas

Request and response schemas for the public outreach event request pipeline.
Supports flexible date preferences, configurable pipeline tasks, comments,
assignment, scheduling with room booking, and postponement.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

from app.schemas.base import UTCResponseBase


class EventRequestCreate(BaseModel):
    """Schema for creating a new event request (public submission)."""

    contact_name: str = Field(..., min_length=1, max_length=255)
    contact_email: EmailStr
    contact_phone: Optional[str] = Field(None, max_length=50)
    organization_name: Optional[str] = Field(None, max_length=255)

    outreach_type: str = Field(
        ...,
        description="Type of outreach event (configurable per department, e.g., fire_safety_demo, station_tour)",
    )
    description: str = Field(..., min_length=10, max_length=2000)

    # Flexible date preferences
    date_flexibility: str = Field(
        default="flexible",
        description="How specific the date preference is: specific_dates, general_timeframe, or flexible",
    )
    preferred_date_start: Optional[datetime] = None
    preferred_date_end: Optional[datetime] = None
    preferred_timeframe: Optional[str] = Field(
        None,
        max_length=500,
        description="Free-text date preference, e.g., 'A Saturday morning in March'",
    )
    preferred_time_of_day: Optional[str] = Field(
        default="flexible",
        description="Preferred time of day: morning, afternoon, evening, or flexible",
    )

    audience_size: Optional[int] = Field(None, ge=1, le=10000)
    age_group: Optional[str] = Field(None, max_length=100)
    venue_preference: str = Field(
        default="their_location",
        description="Where the event should be held: their_location, our_station, either",
    )
    venue_address: Optional[str] = Field(None, max_length=500)
    special_requests: Optional[str] = Field(None, max_length=2000)

    # Honeypot: hidden from real users, filled in by bots. Aliased to a
    # plausible field name for the same reason the forms module does it — a
    # field called "honeypot" is one a scraper skips. Only the public route
    # reads it; an authenticated create ignores it.
    hp_website: Optional[str] = Field(None, alias="website", max_length=255)

    model_config = ConfigDict(populate_by_name=True)


class EventRequestStatusUpdate(BaseModel):
    """Schema for updating the status of an event request (admin action)."""

    status: str = Field(
        ...,
        description="New status: in_progress, scheduled, postponed, completed, declined, cancelled",
    )
    notes: Optional[str] = Field(None, max_length=2000)
    decline_reason: Optional[str] = Field(None, max_length=2000)
    assigned_to: Optional[str] = None
    event_id: Optional[str] = None


class EventRequestAssign(BaseModel):
    """Schema for assigning/reassigning a coordinator."""

    assigned_to: str = Field(..., description="User ID to assign this request to")
    notes: Optional[str] = Field(None, max_length=500)


class EventRequestSchedule(BaseModel):
    """Schema for scheduling a confirmed date, optionally with a room."""

    event_date: datetime = Field(..., description="Confirmed event start date/time")
    event_end_date: Optional[datetime] = Field(
        None, description="Confirmed event end date/time"
    )
    location_id: Optional[str] = Field(None, description="Location/room ID for booking")
    notes: Optional[str] = Field(None, max_length=500)
    create_calendar_event: bool = Field(
        default=True,
        description="Whether to create a calendar Event record",
    )

    @model_validator(mode="after")
    def _end_after_start(self) -> "EventRequestSchedule":
        """An end before the start books a negative-length room reservation.

        The double-booking check compares the requested window against existing
        events, so a reversed window overlaps nothing and the conflict guard
        silently passes.
        """
        if self.event_end_date and self.event_end_date < self.event_date:
            raise ValueError("event_end_date must not be before event_date")
        return self


class StaffingRoleNeed(BaseModel):
    """How many people the department needs in one outreach role."""

    role: str = Field(..., min_length=1, max_length=100)
    count: int = Field(default=1, ge=1, le=50)


class EventRequestStaffingCreate(BaseModel):
    """Schema for opening a volunteer signup sheet on a scheduled request.

    Roles, not crew positions: nobody rides a seat on an engine at a school
    visit, so the sheet asks for tour guides and educators. Role values come
    from the department's own ``events.outreach_roles`` setting, which is
    checked server-side — a role nobody can select is a seat that never fills.
    """

    roles: List[StaffingRoleNeed] = Field(
        ...,
        min_length=1,
        description='Roles needed, e.g. [{"role": "tour_guide", "count": 2}]',
    )
    notes: Optional[str] = Field(None, max_length=500)


class EventRequestVolunteerSignup(UTCResponseBase):
    """One member who has signed up to cover an outreach event."""

    user_id: str
    member_name: str
    position: str
    outreach_role: Optional[str] = None
    outreach_role_label: Optional[str] = None
    status: str
    assigned_at: Optional[datetime] = None


class StaffingRoleStatus(BaseModel):
    """One role on the sheet, and how full it is."""

    role: str
    label: str
    total: int
    filled: int
    remaining: int


class EventRequestStaffingResponse(UTCResponseBase):
    """Volunteer staffing state for a scheduled request."""

    shift_id: Optional[str] = None
    shift_date: Optional[datetime] = None
    slots_total: int = 0
    slots_filled: int = 0
    roles: List[StaffingRoleStatus] = []
    volunteers: List[EventRequestVolunteerSignup] = []
    volunteer_call_sent_at: Optional[datetime] = None


class EventRequestVolunteerCall(BaseModel):
    """Schema for emailing the membership asking for help on a request."""

    message: Optional[str] = Field(
        None,
        max_length=2000,
        description="Extra note from the coordinator, shown above the details",
    )
    membership_types: Optional[List[str]] = Field(
        None,
        description=(
            "Restrict the call to these membership types. Omit to email every "
            "active member."
        ),
    )


class EventRequestVolunteerCallResult(UTCResponseBase):
    """Result of a volunteer call."""

    message: str
    recipients: int
    skipped_opted_out: int
    volunteer_call_sent_at: datetime


class EventRequestPostpone(BaseModel):
    """Schema for postponing a request (with or without a new date)."""

    reason: Optional[str] = Field(None, max_length=2000)
    new_event_date: Optional[datetime] = Field(None, description="Optional new date")
    new_event_end_date: Optional[datetime] = None


class EventRequestComment(BaseModel):
    """Schema for adding a comment to the request thread."""

    message: str = Field(..., min_length=1, max_length=5000)


class EventRequestPublicCancel(BaseModel):
    """Schema for a requester cancelling their own request."""

    reason: Optional[str] = Field(None, max_length=2000)


class TaskCompletionUpdate(BaseModel):
    """Schema for toggling a pipeline task on a request."""

    task_id: str = Field(..., description="The pipeline task ID to toggle")
    completed: bool = Field(..., description="Whether the task is completed")
    notes: Optional[str] = Field(None, max_length=500)


class EmailTemplateCreate(BaseModel):
    """Schema for creating an email template."""

    name: str = Field(..., min_length=1, max_length=200)
    subject: str = Field(..., min_length=1, max_length=500)
    body_html: str = Field(..., min_length=1)
    body_text: Optional[str] = None
    trigger: Optional[str] = Field(
        None,
        description="Auto-send trigger: on_submitted, on_scheduled, on_postponed, days_before_event, etc.",
    )
    trigger_days_before: Optional[int] = Field(None, ge=1, le=90)


class EmailTemplateUpdate(BaseModel):
    """Schema for updating an email template."""

    name: Optional[str] = Field(None, max_length=200)
    subject: Optional[str] = Field(None, max_length=500)
    body_html: Optional[str] = None
    body_text: Optional[str] = None
    trigger: Optional[str] = None
    trigger_days_before: Optional[int] = Field(None, ge=1, le=90)
    is_active: Optional[bool] = None


class EmailTemplateResponse(UTCResponseBase):
    """Response schema for an email template."""

    id: str
    name: str
    subject: str
    body_html: str
    body_text: Optional[str] = None
    trigger: Optional[str] = None
    trigger_days_before: Optional[int] = None
    is_active: bool = True
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SendTemplateEmail(BaseModel):
    """Schema for manually sending a template email to the requester."""

    template_id: str = Field(..., description="Email template ID to send")
    additional_context: Optional[Dict[str, str]] = Field(
        None, description="Extra template variables"
    )


class EventRequestActivityResponse(UTCResponseBase):
    """Response schema for a single activity log entry."""

    id: str
    action: str
    old_status: Optional[str] = None
    new_status: Optional[str] = None
    notes: Optional[str] = None
    details: Optional[dict] = None
    performed_by: Optional[str] = None
    performer_name: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class EventRequestResponse(UTCResponseBase):
    """Full response schema for an event request."""

    id: str
    organization_id: str
    contact_name: str
    contact_email: str
    contact_phone: Optional[str] = None
    organization_name: Optional[str] = None
    outreach_type: str
    description: str

    # Flexible date preferences
    date_flexibility: str = "flexible"
    preferred_date_start: Optional[datetime] = None
    preferred_date_end: Optional[datetime] = None
    preferred_timeframe: Optional[str] = None
    preferred_time_of_day: Optional[str] = None

    audience_size: Optional[int] = None
    age_group: Optional[str] = None
    venue_preference: str
    venue_address: Optional[str] = None
    special_requests: Optional[str] = None

    status: str
    assigned_to: Optional[str] = None
    assignee_name: Optional[str] = None
    reviewer_notes: Optional[str] = None
    decline_reason: Optional[str] = None
    task_completions: Optional[Dict[str, Any]] = None
    event_id: Optional[str] = None
    event_date: Optional[datetime] = None
    event_end_date: Optional[datetime] = None
    event_location_id: Optional[str] = None
    event_location_name: Optional[str] = None
    staffing_shift_id: Optional[str] = None
    staffing_roles: Optional[List[Dict[str, Any]]] = None
    volunteer_call_sent_at: Optional[datetime] = None
    status_token: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    activity_log: List[EventRequestActivityResponse] = []

    model_config = {"from_attributes": True}


class EventRequestListItem(UTCResponseBase):
    """Lightweight list item for event requests."""

    id: str
    contact_name: str
    contact_email: str
    organization_name: Optional[str] = None
    outreach_type: str
    status: str
    date_flexibility: str = "flexible"
    preferred_date_start: Optional[datetime] = None
    preferred_timeframe: Optional[str] = None
    audience_size: Optional[int] = None
    assigned_to: Optional[str] = None
    assignee_name: Optional[str] = None
    task_completions: Optional[Dict[str, Any]] = None
    event_date: Optional[datetime] = None
    staffing_shift_id: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class EventRequestPublicStatus(UTCResponseBase):
    """Public-facing status response (limited info, no internal notes).

    UTCResponseBase, not BaseModel: MySQL hands back naive datetimes, and the
    status page a requester opens ran them through ``new Date()``, which reads
    an unmarked string as *local* time. A department in UTC-05:00 was telling
    the public their 6pm demo was at 1pm.
    """

    contact_name: str
    outreach_type: str
    status: str
    date_flexibility: str = "flexible"
    preferred_date_start: Optional[datetime] = None
    preferred_date_end: Optional[datetime] = None
    preferred_timeframe: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    event_date: Optional[datetime] = None
    decline_reason: Optional[str] = None
    # Optionally visible pipeline progress (configurable per department)
    task_progress: Optional[Dict[str, Any]] = None
    can_cancel: bool = True

"""
Event Request Pydantic Schemas

Request and response schemas for the public outreach event request pipeline.
Supports flexible date preferences, configurable pipeline tasks, comments,
assignment, scheduling with room booking, and postponement.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, EmailStr, Field


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
    event_end_date: Optional[datetime] = Field(None, description="Confirmed event end date/time")
    location_id: Optional[str] = Field(None, description="Location/room ID for booking")
    notes: Optional[str] = Field(None, max_length=500)
    create_calendar_event: bool = Field(
        default=True,
        description="Whether to create a calendar Event record",
    )


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
    is_active: Optional[int] = None


class EmailTemplateResponse(BaseModel):
    """Response schema for an email template."""

    id: str
    name: str
    subject: str
    body_html: str
    body_text: Optional[str] = None
    trigger: Optional[str] = None
    trigger_days_before: Optional[int] = None
    is_active: int = 1
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SendTemplateEmail(BaseModel):
    """Schema for manually sending a template email to the requester."""

    template_id: str = Field(..., description="Email template ID to send")
    additional_context: Optional[Dict[str, str]] = Field(
        None, description="Extra template variables"
    )


class EventRequestActivityResponse(BaseModel):
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


class EventRequestResponse(BaseModel):
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
    status_token: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    activity_log: List[EventRequestActivityResponse] = []

    model_config = {"from_attributes": True}


class EventRequestListItem(BaseModel):
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
    created_at: datetime

    model_config = {"from_attributes": True}


class EventRequestPublicStatus(BaseModel):
    """Public-facing status response (limited info, no internal notes)."""

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

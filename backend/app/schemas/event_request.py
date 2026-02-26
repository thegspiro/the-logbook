"""
Event Request Pydantic Schemas

Request and response schemas for the public outreach event request pipeline.
"""

from datetime import datetime
from typing import List, Optional

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
    preferred_date_start: Optional[datetime] = None
    preferred_date_end: Optional[datetime] = None
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
        description="New status: under_review, approved, scheduled, declined, cancelled, completed",
    )
    notes: Optional[str] = Field(None, max_length=2000)
    decline_reason: Optional[str] = Field(None, max_length=2000)
    assigned_to: Optional[str] = None
    event_id: Optional[str] = None


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
    preferred_date_start: Optional[datetime] = None
    preferred_date_end: Optional[datetime] = None
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
    event_id: Optional[str] = None
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
    preferred_date_start: Optional[datetime] = None
    audience_size: Optional[int] = None
    assigned_to: Optional[str] = None
    assignee_name: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class EventRequestPublicStatus(BaseModel):
    """Public-facing status response (limited info, no internal notes)."""

    contact_name: str
    outreach_type: str
    status: str
    preferred_date_start: Optional[datetime] = None
    preferred_date_end: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    event_date: Optional[datetime] = None
    decline_reason: Optional[str] = None

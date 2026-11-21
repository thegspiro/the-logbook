"""
Event Request Pydantic Schemas

Request and response schemas for the public outreach event request pipeline.
Supports flexible date preferences, configurable pipeline tasks, comments,
assignment, scheduling with room booking, and postponement.
"""

from datetime import date, datetime
from typing import Any, Dict, List, Optional

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)

from app.models.event_request import STAFF_ENTERED_SOURCES
from app.schemas.base import UTCResponseBase, as_utc


def calendar_date(value: Any) -> Any:
    """A requested date as the calendar day the requester wrote.

    Requested dates are plain dates (owner decision, 2026-11-20). A client that
    still sends a datetime — this endpoint took one until then — gets the date
    written in it, with no timezone conversion: "2027-01-15T00:00:00Z" is the
    15th, because converting it is what used to turn the 15th into the 14th.
    """
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str) and "T" in value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
        except ValueError:
            return value
    return value


class EventRequestCreate(BaseModel):
    """Schema for creating a new event request (public submission)."""

    contact_name: str = Field(..., min_length=1, max_length=255)
    contact_email: EmailStr
    contact_phone: Optional[str] = Field(None, max_length=50)
    organization_name: Optional[str] = Field(None, max_length=255)

    outreach_type: str = Field(
        ...,
        min_length=1,
        # Matches EventRequest.outreach_type's String(100). Without the cap a
        # longer value reached MySQL as a DataError and a member of the public
        # got a 500 on a form they filled in correctly.
        max_length=100,
        description="Type of outreach event (configurable per department, e.g., fire_safety_demo, station_tour)",
    )
    description: str = Field(..., min_length=10, max_length=2000)

    # Flexible date preferences
    date_flexibility: str = Field(
        default="flexible",
        description="How specific the date preference is: specific_dates, general_timeframe, or flexible",
    )
    preferred_date_start: Optional[date] = None
    preferred_date_end: Optional[date] = None
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

    _calendar_dates = field_validator(
        "preferred_date_start", "preferred_date_end", mode="before"
    )(calendar_date)

    @model_validator(mode="after")
    def _date_range_ordered(self) -> "EventRequestCreate":
        """A window that ends before it starts is not a date preference.

        ``EventRequestSchedule`` has refused a reversed window since the room
        double-booking check was added; intake did not, so a requester could
        store one and the coordinator's board rendered "March 20 – March 3".
        """
        if (
            self.preferred_date_start
            and self.preferred_date_end
            and self.preferred_date_end < self.preferred_date_start
        ):
            raise ValueError(
                "preferred_date_end must not be before preferred_date_start"
            )
        return self


class EventRequestStaffCreate(BaseModel):
    """A request a coordinator enters for somebody who phoned, wrote or came by.

    Differs from the public ``EventRequestCreate`` where the person typing is
    not the requester: an email is optional when there is a phone number (a
    caller may give only that), the description may be short (it is the
    coordinator's note of a conversation, not a stranger's first message).
    """

    source: str = Field(
        ...,
        description="How the request arrived: phone, email, in_person or other",
    )
    contact_name: str = Field(..., min_length=1, max_length=255)
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = Field(None, max_length=50)
    organization_name: Optional[str] = Field(None, max_length=255)

    outreach_type: str = Field(..., min_length=1, max_length=100)
    description: str = Field(..., min_length=1, max_length=2000)

    date_flexibility: str = "flexible"
    preferred_date_start: Optional[date] = None
    preferred_date_end: Optional[date] = None
    preferred_timeframe: Optional[str] = Field(None, max_length=500)

    _calendar_dates = field_validator(
        "preferred_date_start", "preferred_date_end", mode="before"
    )(calendar_date)
    preferred_time_of_day: Optional[str] = "flexible"

    audience_size: Optional[int] = Field(None, ge=1, le=10000)
    age_group: Optional[str] = Field(None, max_length=100)
    venue_preference: str = "their_location"
    venue_address: Optional[str] = Field(None, max_length=500)
    special_requests: Optional[str] = Field(None, max_length=2000)

    # Coordinator to assign now. Omitted: the department's default coordinator,
    # as for a public submission.
    assigned_to: Optional[str] = None
    # Whether the requester gets the "request received" email with their status
    # link. Ignored when there is no email to send it to.
    notify_requester: bool = True

    @model_validator(mode="after")
    def _check(self) -> "EventRequestStaffCreate":
        allowed = {source.value for source in STAFF_ENTERED_SOURCES}
        if self.source not in allowed:
            raise ValueError("source must be one of: " + ", ".join(sorted(allowed)))
        if self.contact_phone is not None:
            self.contact_phone = self.contact_phone.strip() or None
        if not self.contact_email and not self.contact_phone:
            raise ValueError("Enter an email address or a phone number.")
        if (
            self.preferred_date_start
            and self.preferred_date_end
            and self.preferred_date_end < self.preferred_date_start
        ):
            raise ValueError(
                "preferred_date_end must not be before preferred_date_start"
            )
        return self


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

        Assigned back rather than only compared: `schedule_request` hands these
        straight to `EventCreate`, whose own `validate_dates` compares them
        again. Normalising a copy left the naive value on the model and moved
        the `TypeError` one layer down — still an uncaught 500, just from a
        different validator.
        """
        self.event_date = as_utc(self.event_date)
        if self.event_end_date:
            self.event_end_date = as_utc(self.event_end_date)
            # `<=`, not `<`: an end *equal* to the start is a zero-length
            # booking, which `EventCreate` and `EventUpdate` both refuse. The
            # create branch in `schedule_request` builds `EventCreate` outside
            # an exception handler, so letting it through turned a coordinator
            # typo into a 500 rather than a 422 at this boundary — and a
            # zero-length window overlaps nothing, so the room double-booking
            # check passed it silently on the way there. Matches
            # `EventRequestPostpone._new_window_ordered`.
            if self.event_end_date <= self.event_date:
                raise ValueError("event_end_date must be after event_date")
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


class EventStaffingResponse(EventRequestStaffingResponse):
    """The signup sheet that staffs an event, whichever owns it.

    ``request_id`` is set when the sheet belongs to the request the event was
    scheduled from; the event page sends the organizer there to change it.
    """

    request_id: Optional[str] = None


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

    @model_validator(mode="after")
    def _new_window_ordered(self) -> "EventRequestPostpone":
        """The same rule ``EventRequestSchedule`` enforces, on the other path
        that sets a confirmed date.

        Without it an end at or before the start is taken at face value:
        ``resolve_confirmed_end`` returns an explicit end unchanged, the request
        stores the reversed interval, ``sync_staffing_shift_date`` moves the
        signup sheet to a zero-or-negative window, and
        ``sync_calendar_event_date`` swallows the calendar service's rejection
        by design — so the endpoint reports success while the request, the sheet
        and the calendar disagree about when the event is.

        An end with no start is meaningless here too: `postpone_request` only
        reads the end when a new date is given, so silently ignoring it would
        discard something the caller asked for.
        """
        if self.new_event_end_date and not self.new_event_date:
            raise ValueError("new_event_end_date requires new_event_date")
        if self.new_event_date:
            self.new_event_date = as_utc(self.new_event_date)
        if self.new_event_end_date:
            self.new_event_end_date = as_utc(self.new_event_end_date)
            # new_event_date is set here — the first check refuses an end
            # without a start — but the narrowing does not reach this line.
            if self.new_event_date and self.new_event_end_date <= self.new_event_date:
                raise ValueError("new_event_end_date must be after new_event_date")
        return self


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
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    organization_name: Optional[str] = None
    outreach_type: str
    description: str

    # Flexible date preferences
    date_flexibility: str = "flexible"
    preferred_date_start: Optional[date] = None
    preferred_date_end: Optional[date] = None
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
    # How it arrived: "web" for the public form, otherwise how a coordinator
    # said it came in (EventRequestSource).
    source: str = "web"
    created_at: datetime
    updated_at: datetime
    activity_log: List[EventRequestActivityResponse] = []

    model_config = {"from_attributes": True}


class EventRequestListItem(UTCResponseBase):
    """Lightweight list item for event requests."""

    id: str
    contact_name: str
    contact_email: Optional[str] = None
    organization_name: Optional[str] = None
    outreach_type: str
    status: str
    date_flexibility: str = "flexible"
    preferred_date_start: Optional[date] = None
    preferred_timeframe: Optional[str] = None
    audience_size: Optional[int] = None
    assigned_to: Optional[str] = None
    assignee_name: Optional[str] = None
    task_completions: Optional[Dict[str, Any]] = None
    event_date: Optional[datetime] = None
    staffing_shift_id: Optional[str] = None
    # Intake flagged the request as arriving inside the department's lead time
    # (a `lead_time_warning` activity row); see `short_notice_request_ids`.
    short_notice: bool = False
    source: str = "web"
    # Seats on the request's live signup sheet; both null when it has none.
    staffing_slots_filled: Optional[int] = None
    staffing_slots_total: Optional[int] = None
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
    preferred_date_start: Optional[date] = None
    preferred_date_end: Optional[date] = None
    preferred_timeframe: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    event_date: Optional[datetime] = None
    decline_reason: Optional[str] = None
    # Optionally visible pipeline progress (configurable per department)
    task_progress: Optional[Dict[str, Any]] = None
    can_cancel: bool = True
    # The department's IANA timezone. The requester's browser may be anywhere,
    # and the scheduled time is the department's local time.
    timezone: Optional[str] = None

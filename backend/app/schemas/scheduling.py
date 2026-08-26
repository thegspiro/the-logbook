"""
Scheduling Pydantic Schemas

Request and response schemas for scheduling/shift management endpoints.
"""

from datetime import date, datetime
from enum import Enum as PyEnum
from typing import Annotated, Any, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.call_tracking import MAX_CALLS_PER_SHIFT, CallTrackingMode
from app.schemas.base import UTCResponseBase

_response_config = ConfigDict(from_attributes=True)


# ============================================
# Position Slot
# ============================================


class PositionSlot(BaseModel):
    """A single position seat on a shift or apparatus.

    Each slot represents one seat to fill.  Two EMTs = two separate
    ``PositionSlot`` objects.  ``required=True`` means the slot must be
    filled for the shift to be considered adequately staffed.
    """

    position: str
    required: bool = True


# ============================================
# Shift Schemas
# ============================================


class ShiftCreate(BaseModel):
    """Schema for creating a shift"""

    shift_date: date
    start_time: datetime
    end_time: Optional[datetime] = None
    apparatus_id: Optional[str] = None
    station_id: Optional[str] = None
    shift_officer_id: Optional[str] = None
    color: Optional[str] = None
    positions: Optional[List[Any]] = None
    min_staffing: Optional[int] = None
    notes: Optional[str] = None
    activities: Optional[Any] = None

    @model_validator(mode="after")
    def validate_shift_times(self) -> "ShiftCreate":
        if self.end_time is not None and self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")
        return self


class ShiftUpdate(BaseModel):
    """Schema for updating a shift"""

    shift_date: Optional[date] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    apparatus_id: Optional[str] = None
    station_id: Optional[str] = None
    shift_officer_id: Optional[str] = None
    color: Optional[str] = None
    positions: Optional[List[Any]] = None
    min_staffing: Optional[int] = None
    notes: Optional[str] = None
    activities: Optional[Any] = None

    @model_validator(mode="after")
    def validate_shift_times(self) -> "ShiftUpdate":
        if (
            self.start_time is not None
            and self.end_time is not None
            and self.end_time <= self.start_time
        ):
            raise ValueError("end_time must be after start_time")
        return self


class ShiftRosterSeat(UTCResponseBase):
    """One occupied seat on a shift, as carried by every shift response.

    Deliberately thin: a calendar needs who holds which seat, not the full
    assignment record. Anything richer (training slots, evaluator, notes)
    stays on the assignment endpoints.
    """

    assignment_id: UUID
    user_id: UUID
    user_name: Optional[str] = None
    position: Optional[str] = None
    # What this member is doing at a community outreach event. NULL on a duty
    # shift, where `position` already says it.
    outreach_role: Optional[str] = None
    outreach_role_label: Optional[str] = None
    status: Optional[str] = None
    is_training: bool = False

    model_config = _response_config


class OutreachRoleSlot(UTCResponseBase):
    """One role on a community outreach signup sheet, and how full it is."""

    role: str
    label: str
    total: int
    filled: int
    remaining: int

    model_config = _response_config


class ShiftResponse(UTCResponseBase):
    """Schema for shift response"""

    id: UUID
    organization_id: UUID
    shift_date: date
    start_time: datetime
    end_time: Optional[datetime] = None
    apparatus_id: Optional[str] = None
    apparatus_name: Optional[str] = None
    apparatus_unit_number: Optional[str] = None
    # `_enrich_shift_dict` has always computed this — resolved across both
    # apparatus tables, lowercased — but the schema did not project it, so it
    # was dropped on serialization and every shift reached the client with no
    # type. The report form keys its per-apparatus skill and task defaults on
    # it, so those mappings could never apply to any shift in any department:
    # "+ Add" appended a blank task row on an engine and a ladder alike.
    apparatus_type: Optional[str] = None
    platoon: Optional[str] = None
    positions: Optional[List[Any]] = None
    apparatus_positions: Optional[List[Any]] = None
    min_staffing: Optional[int] = None
    station_id: Optional[str] = None
    shift_officer_id: Optional[UUID] = None
    shift_officer_name: Optional[str] = None
    color: Optional[str] = None
    notes: Optional[str] = None
    activities: Optional[Any] = None
    # A community outreach signup sheet rather than duty coverage. Its seats
    # are named by outreach role, not by crew position, so a member browsing
    # Open Shifts is offered "Tour Guide" instead of "Firefighter".
    is_outreach: bool = False
    outreach_roles: List[OutreachRoleSlot] = Field(default_factory=list)
    attendee_count: Optional[int] = 0
    roster: List[ShiftRosterSeat] = Field(default_factory=list)
    call_count: int = 0
    total_hours: Optional[float] = None
    is_finalized: bool = False
    finalized_at: Optional[datetime] = None
    finalized_by: Optional[UUID] = None
    status: str = "scheduled"
    cancelled_at: Optional[datetime] = None
    cancelled_by: Optional[UUID] = None
    cancellation_reason: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None

    model_config = _response_config


# ============================================
# Shift Attendance Schemas
# ============================================


class ShiftAttendanceCreate(BaseModel):
    """Schema for recording shift attendance"""

    user_id: UUID
    checked_in_at: Optional[datetime] = None
    checked_out_at: Optional[datetime] = None


class ShiftAttendanceUpdate(BaseModel):
    """Schema for updating shift attendance"""

    checked_in_at: Optional[datetime] = None
    checked_out_at: Optional[datetime] = None
    duration_minutes: Optional[int] = None


class ManualHoursEntry(BaseModel):
    """A single member's manually-entered hours for shift finalization."""

    user_id: UUID
    hours: float = Field(..., gt=0, le=48)


class MemberCallCredit(BaseModel):
    """One member's personal call credit for a shift.

    Distinct from the shift's own call count on purpose. A member who came on
    at 0300 was not on the 2200 call, so credit is per-member and is capped at
    — never derived from, and never summed into — the shift total.
    """

    user_id: UUID
    call_count: int = Field(..., ge=0, le=MAX_CALLS_PER_SHIFT)


class ShiftFinalizeRequest(BaseModel):
    """Optional request body for finalizing a shift."""

    manual_hours: Optional[List[ManualHoursEntry]] = None
    # Finalize despite outstanding end-of-shift checks (org enforcement on).
    # The reason is recorded in the audit log.
    override_incomplete_checks: bool = False
    override_reason: Optional[str] = None
    # Crew-to-crew handoff captured at finalize.
    pass_down_notes: Optional[str] = None

    # -- Call volume (count-only tracking) --------------------------------
    # How many calls this shift's apparatus ran. None means "not answered",
    # which is deliberately distinct from 0 ("we ran none"): one is a gap in
    # the record and the other is data, and a report that conflates them
    # understates the department's quiet nights as missing.
    reported_call_count: Optional[int] = Field(
        default=None, ge=0, le=MAX_CALLS_PER_SHIFT
    )
    # {"ems": 3, "fire": 1} keyed by the org's own type slugs. Must not exceed
    # reported_call_count; the remainder is recorded as unclassified.
    reported_call_types: Optional[dict[str, int]] = None
    # Per-member credit. Omitted members default to the shift's count.
    member_call_counts: Optional[List[MemberCallCredit]] = None
    # Calls another unit already logged that this shift's apparatus was also
    # on. Attaching instead of re-reporting is what keeps one incident counted
    # once for the department when two units roll.
    attach_call_ids: Optional[List[UUID]] = None

    @model_validator(mode="after")
    def _validate_call_volume(self) -> "ShiftFinalizeRequest":
        if self.reported_call_types:
            for slug, count in self.reported_call_types.items():
                if not slug or not slug.strip():
                    raise ValueError("Call type slug cannot be blank")
                if count < 0:
                    raise ValueError("Call type counts cannot be negative")
            if self.reported_call_count is None:
                raise ValueError(
                    "A call-type breakdown needs a total call count as well"
                )
            if sum(self.reported_call_types.values()) > self.reported_call_count:
                raise ValueError("Call types add up to more than the total call count")
        if self.member_call_counts and self.reported_call_count is not None:
            for entry in self.member_call_counts:
                if entry.call_count > self.reported_call_count:
                    raise ValueError(
                        "A member cannot be credited with more calls than the "
                        "apparatus ran"
                    )
        return self


class CallTypeOption(BaseModel):
    """One department-defined call type.

    ``slug`` is the stored value and is permanent; ``label`` is display-only.
    Storing the label instead would orphan every historical call the first time
    somebody corrected a typo in settings.
    """

    slug: str = Field(..., min_length=1, max_length=50, pattern=r"^[a-z0-9_]+$")
    label: str = Field(..., min_length=1, max_length=100)


class CallTrackingSettings(BaseModel):
    """How the department records call volume.

    Defaults to ``detailed`` — what every existing org already does. A missing
    setting must never read as "off" (pitfall #19): that would silently stop
    call logging for every installation on upgrade.
    """

    mode: str = Field(default=CallTrackingMode.DETAILED)
    call_types: List[CallTypeOption] = Field(default_factory=list)

    @model_validator(mode="after")
    def _validate(self) -> "CallTrackingSettings":
        if self.mode not in CallTrackingMode.ALL:
            raise ValueError(f"mode must be one of {', '.join(CallTrackingMode.ALL)}")
        seen = set()
        for entry in self.call_types:
            if entry.slug in seen:
                raise ValueError(f"Duplicate call type slug: {entry.slug}")
            seen.add(entry.slug)
        return self


class CloseoutAttendanceEntry(BaseModel):
    """One member's actual on/off times, as confirmed by the officer."""

    user_id: UUID
    checked_in_at: Optional[datetime] = None
    checked_out_at: Optional[datetime] = None

    @model_validator(mode="after")
    def _order(self) -> "CloseoutAttendanceEntry":
        if (
            self.checked_in_at
            and self.checked_out_at
            and self.checked_out_at <= self.checked_in_at
        ):
            raise ValueError("A member cannot leave before they arrived")
        return self


class CloseoutAttendanceRequest(BaseModel):
    """Step 1 of close-out — who was on, and when."""

    entries: List[CloseoutAttendanceEntry] = Field(default_factory=list)


class CloseoutCallsRequest(BaseModel):
    """Step 2 of close-out — how many calls the apparatus ran.

    Carries no incident detail, for the same reason the finalize payload does
    not: there is nowhere to put an address or a narrative, so none can arrive.
    """

    reported_call_count: Optional[int] = Field(
        default=None, ge=0, le=MAX_CALLS_PER_SHIFT
    )
    reported_call_types: Optional[dict[str, int]] = None
    attach_call_ids: Optional[List[UUID]] = None

    @model_validator(mode="after")
    def _validate(self) -> "CloseoutCallsRequest":
        if self.reported_call_types:
            if self.reported_call_count is None:
                raise ValueError(
                    "A call-type breakdown needs a total call count as well"
                )
            if any(v < 0 for v in self.reported_call_types.values()):
                raise ValueError("Call type counts cannot be negative")
            if sum(self.reported_call_types.values()) > self.reported_call_count:
                raise ValueError("Call types add up to more than the total call count")
        return self


class CloseoutMemberState(UTCResponseBase):
    """A member's saved close-out state, for redisplay on resume."""

    user_id: UUID
    user_name: str = ""
    checked_in_at: Optional[datetime] = None
    checked_out_at: Optional[datetime] = None
    hours: float = 0.0
    # None means the officer has not set credit yet — the wizard shows the
    # apparatus count, not a deliberate zero.
    call_count: Optional[int] = None
    missing_checkout: bool = False


class CloseoutAttachableCall(UTCResponseBase):
    """A call another unit logged that this shift's apparatus may also claim."""

    id: UUID
    call_date: date
    call_type: Optional[str] = None
    source: str
    apparatus_ids: List[str] = Field(default_factory=list)


class CloseoutStateResponse(UTCResponseBase):
    """Everything the close-out wizard needs, including where to resume."""

    shift_id: UUID
    is_finalized: bool
    # 0 = not started, 1 = attendance saved, 2 = calls saved.
    closeout_step: int = 0
    call_tracking_mode: str
    call_types: List[CallTypeOption] = Field(default_factory=list)
    members: List[CloseoutMemberState] = Field(default_factory=list)
    combined_hours: float = 0.0
    reported_call_count: int = 0
    reported_call_types: dict[str, int] = Field(default_factory=dict)
    attachable_calls: List[CloseoutAttachableCall] = Field(default_factory=list)


class ShiftCancelRequest(BaseModel):
    """Optional request body for cancelling a shift."""

    reason: Optional[str] = None


class ShiftReopenRequest(BaseModel):
    """Request body for reopening a finalized shift for corrections."""

    reason: Optional[str] = None


class ShiftAttendanceResponse(UTCResponseBase):
    """Schema for shift attendance response"""

    id: UUID
    shift_id: UUID
    user_id: UUID
    user_name: Optional[str] = None
    checked_in_at: Optional[datetime] = None
    checked_out_at: Optional[datetime] = None
    duration_minutes: Optional[int] = None
    call_count: Optional[int] = None
    created_at: datetime

    model_config = _response_config


# ============================================
# Shift Detail & List Schemas
# ============================================


class PlatoonRosterEntry(BaseModel):
    """A platoon member's status for a specific shift."""

    user_id: UUID
    user_name: str
    # "assigned" (on the shift), "on_leave" (approved time-off / leave that
    # date), or "available" (in the platoon, not assigned, could fill in).
    status: str

    model_config = _response_config


class PlatoonMember(BaseModel):
    """A member shown in the department-wide platoon overview."""

    user_id: UUID
    user_name: str
    rank: Optional[str] = None

    model_config = _response_config


class PlatoonGroup(BaseModel):
    """A platoon (or the unassigned bucket) and its members.

    ``platoon`` is ``None`` for members with no platoon assigned.
    """

    platoon: Optional[str] = None
    member_count: int = 0
    members: List[PlatoonMember] = []

    model_config = _response_config


class PlatoonOverviewResponse(BaseModel):
    """Department-wide platoon roster: every platoon plus the unassigned bucket."""

    platoons_enabled: bool = False
    groups: List[PlatoonGroup] = []

    model_config = _response_config


class PlatoonBulkAssign(BaseModel):
    """Assign a platoon (or clear it, with ``platoon=None``) for many members."""

    user_ids: List[UUID] = Field(..., min_length=1, max_length=500)
    platoon: Optional[str] = Field(None, max_length=20)


class PlatoonBulkAssignResult(BaseModel):
    """Result of a bulk platoon assignment."""

    updated: int = 0
    platoon: Optional[str] = None

    model_config = _response_config


class ShiftDetailResponse(ShiftResponse):
    """Extended shift response with attendees"""

    attendees: List[ShiftAttendanceResponse] = []
    # Full duty-platoon roster for the shift's platoon (when set), so officers
    # can see who is on, who is on leave, and who could fill in / be held over.
    platoon_roster: List[PlatoonRosterEntry] = []
    # Whether check-in is inside its window, and the reason when it is not.
    # Declared so the response model does not strip them: the check-in screen
    # disables its button on these rather than reimplementing the rule, and
    # undeclared keys leave it offering an action the API refuses.
    checkin_open: bool = True
    checkin_closed_reason: Optional[str] = None

    model_config = _response_config


class ShiftsListResponse(BaseModel):
    """Schema for paginated shifts list"""

    shifts: List[ShiftResponse]
    total: int
    skip: int
    limit: int


# ============================================
# Summary Schemas
# ============================================


class SchedulingSummary(BaseModel):
    """Schema for scheduling module summary.

    The shift counts are of *scheduled* shifts; the hours figure is of hours
    actually *worked* (from attendance). The names carry that distinction
    because the two are routinely compared and will not match.
    """

    shifts_scheduled: int
    shifts_scheduled_this_week: int
    shifts_scheduled_this_month: int
    hours_worked_this_month: float


class SchedulingWidgetFilters(BaseModel):
    """Saved defaults for the scheduling dashboard widgets."""

    station_id: Optional[str] = Field(None, max_length=100)
    platoon: Optional[str] = Field(None, max_length=20)
    horizon_days: int = Field(14, ge=1, le=93)


class SchedulingWidgetPreferences(BaseModel):
    widgets: dict[str, SchedulingWidgetFilters] = Field(default_factory=dict)


class SchedulingWidgetSummary(BaseModel):
    timezone: str
    window_start: datetime
    window_end: datetime
    today_staffing: int
    future_coverage_gaps: int
    open_slots: int
    pending_staffing_changes: int
    incomplete_closeouts: int
    workload_imbalance: int
    special_operations: int
    scheduling_enabled: bool = True


# ============================================
# Shift Call Schemas
# ============================================


class ShiftCallCreate(BaseModel):
    """Schema for creating a shift call"""

    # Length bounds mirror the String(100) DB columns (a clean 422 instead of
    # a DB-level error) and cap the Text/JSON columns against oversized
    # payloads. responding_members holds user-id strings.
    incident_number: Optional[str] = Field(None, max_length=100)
    incident_type: str = Field(min_length=1, max_length=100)
    dispatched_at: Optional[datetime] = None
    on_scene_at: Optional[datetime] = None
    cleared_at: Optional[datetime] = None
    cancelled_en_route: bool = False
    medical_refusal: bool = False
    responding_members: Optional[List[Annotated[str, Field(max_length=64)]]] = Field(
        None, max_length=100
    )
    notes: Optional[str] = Field(None, max_length=2000)


class ShiftCallUpdate(BaseModel):
    """Schema for updating a shift call"""

    incident_number: Optional[str] = Field(None, max_length=100)
    incident_type: Optional[str] = Field(None, min_length=1, max_length=100)
    dispatched_at: Optional[datetime] = None
    on_scene_at: Optional[datetime] = None
    cleared_at: Optional[datetime] = None
    cancelled_en_route: Optional[bool] = None
    medical_refusal: Optional[bool] = None
    responding_members: Optional[List[Annotated[str, Field(max_length=64)]]] = Field(
        None, max_length=100
    )
    notes: Optional[str] = Field(None, max_length=2000)


class ShiftCallResponse(UTCResponseBase):
    """Schema for shift call response"""

    id: UUID
    organization_id: UUID
    shift_id: UUID
    incident_number: Optional[str] = None
    incident_type: str
    dispatched_at: Optional[datetime] = None
    on_scene_at: Optional[datetime] = None
    cleared_at: Optional[datetime] = None
    cancelled_en_route: bool = False
    medical_refusal: bool = False
    responding_members: Optional[List[str]] = None
    notes: Optional[str] = None
    created_at: datetime

    model_config = _response_config


# ============================================
# Enums
# ============================================


class ShiftPosition(str, PyEnum):
    """Enum for shift positions"""

    OFFICER = "officer"
    DRIVER = "driver"
    FIREFIGHTER = "firefighter"
    EMS = "ems"
    CAPTAIN = "captain"
    LIEUTENANT = "lieutenant"
    PROBATIONARY = "probationary"
    VOLUNTEER = "volunteer"
    OTHER = "other"


class AssignmentStatus(str, PyEnum):
    """Enum for shift assignment statuses"""

    ASSIGNED = "assigned"
    CONFIRMED = "confirmed"
    DECLINED = "declined"
    PENDING = "pending"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"


class SwapRequestStatus(str, PyEnum):
    """Enum for shift swap request statuses"""

    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"
    CANCELLED = "cancelled"


class TimeOffStatus(str, PyEnum):
    """Enum for time off request statuses"""

    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"
    CANCELLED = "cancelled"


class PatternType(str, PyEnum):
    """Enum for shift pattern types"""

    DAILY = "daily"
    WEEKLY = "weekly"
    PLATOON = "platoon"
    CUSTOM = "custom"


# ============================================
# Shift Template Schemas
# ============================================


class ShiftTemplateCreate(BaseModel):
    """Schema for creating a shift template"""

    name: str
    description: Optional[str] = None
    start_time_of_day: str
    end_time_of_day: str
    duration_hours: float
    color: Optional[str] = None
    positions: Optional[Any] = None
    min_staffing: int = 1
    category: Optional[str] = "standard"
    apparatus_type: Optional[str] = None
    apparatus_id: Optional[str] = None
    is_default: bool = False
    open_to_all_members: bool = False


class ShiftTemplateUpdate(BaseModel):
    """Schema for updating a shift template"""

    name: Optional[str] = None
    description: Optional[str] = None
    start_time_of_day: Optional[str] = None
    end_time_of_day: Optional[str] = None
    duration_hours: Optional[float] = None
    color: Optional[str] = None
    positions: Optional[Any] = None
    min_staffing: Optional[int] = None
    category: Optional[str] = None
    apparatus_type: Optional[str] = None
    apparatus_id: Optional[str] = None
    is_default: Optional[bool] = None
    open_to_all_members: Optional[bool] = None


class ShiftTemplateResponse(UTCResponseBase):
    """Schema for shift template response"""

    id: UUID
    organization_id: UUID
    name: str
    description: Optional[str] = None
    start_time_of_day: str
    end_time_of_day: str
    duration_hours: float
    color: Optional[str] = None
    positions: Optional[Any] = None
    min_staffing: int = 1
    category: Optional[str] = "standard"
    apparatus_type: Optional[str] = None
    apparatus_id: Optional[str] = None
    is_default: bool = False
    is_active: bool = True
    open_to_all_members: bool = False
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None

    model_config = _response_config


# ============================================
# Shift Pattern Schemas
# ============================================


class ShiftPatternCreate(BaseModel):
    """Schema for creating a shift pattern"""

    name: str
    description: Optional[str] = None
    pattern_type: PatternType
    template_id: Optional[UUID] = None
    rotation_days: Optional[int] = None
    days_on: Optional[int] = None
    days_off: Optional[int] = None
    schedule_config: Optional[Any] = None
    start_date: date
    end_date: Optional[date] = None
    assigned_members: Optional[Any] = None


class ShiftPatternUpdate(BaseModel):
    """Schema for updating a shift pattern"""

    name: Optional[str] = None
    description: Optional[str] = None
    pattern_type: Optional[PatternType] = None
    template_id: Optional[UUID] = None
    rotation_days: Optional[int] = None
    days_on: Optional[int] = None
    days_off: Optional[int] = None
    schedule_config: Optional[Any] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    assigned_members: Optional[Any] = None


class ShiftPatternResponse(UTCResponseBase):
    """Schema for shift pattern response"""

    id: UUID
    organization_id: UUID
    name: str
    description: Optional[str] = None
    pattern_type: PatternType
    template_id: Optional[UUID] = None
    rotation_days: Optional[int] = None
    days_on: Optional[int] = None
    days_off: Optional[int] = None
    schedule_config: Optional[Any] = None
    start_date: date
    end_date: Optional[date] = None
    assigned_members: Optional[Any] = None
    is_active: bool = True
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None

    model_config = _response_config


class GenerateShiftsRequest(BaseModel):
    """Schema for requesting shift generation from a pattern"""

    start_date: date
    end_date: date


# ============================================
# Shift Assignment Schemas
# ============================================


class ShiftAssignmentCreate(BaseModel):
    """Schema for creating a shift assignment"""

    user_id: UUID
    position: ShiftPosition = ShiftPosition.FIREFIGHTER
    # Required when the shift is a community-outreach signup sheet, ignored
    # otherwise. See ShiftAssignment.outreach_role.
    outreach_role: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = None
    # Training slot: mark this seat as a supervised training/rider position and
    # optionally link the trainee's program and the evaluating officer.
    is_training: bool = False
    training_program_id: Optional[str] = None
    training_evaluator_id: Optional[str] = None


class ShiftAssignmentUpdate(BaseModel):
    """Schema for updating a shift assignment"""

    position: Optional[ShiftPosition] = None
    assignment_status: Optional[AssignmentStatus] = None
    notes: Optional[str] = None
    is_training: Optional[bool] = None
    training_program_id: Optional[str] = None
    training_evaluator_id: Optional[str] = None


class EmbeddedShiftInfo(BaseModel):
    """Minimal shift data embedded in assignment responses."""

    id: str
    shift_date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    notes: Optional[str] = None
    apparatus_id: Optional[str] = None
    # Resolved so a member's own shift list can name the rig. Without these the
    # row could only show a date and a position — the id alone is not something
    # anyone can read.
    apparatus_name: Optional[str] = None
    apparatus_unit_number: Optional[str] = None
    shift_officer_id: Optional[str] = None
    color: Optional[str] = None


class ShiftAssignmentResponse(UTCResponseBase):
    """Schema for shift assignment response"""

    id: UUID
    organization_id: UUID
    shift_id: UUID
    user_id: UUID
    user_name: Optional[str] = None
    position: ShiftPosition
    outreach_role: Optional[str] = None
    outreach_role_label: Optional[str] = None
    assignment_status: AssignmentStatus
    assigned_by: Optional[UUID] = None
    confirmed_at: Optional[datetime] = None
    notes: Optional[str] = None
    is_training: bool = False
    training_program_id: Optional[str] = None
    training_program_name: Optional[str] = None
    training_evaluator_id: Optional[str] = None
    training_evaluator_name: Optional[str] = None
    shift: Optional[EmbeddedShiftInfo] = None
    # Soft, non-blocking advisories attached by the endpoint (EVOC driver
    # eligibility, overtime/hours). Declared here so response_model does not
    # strip them from the assign/signup responses.
    evoc_warnings: Optional[List[Any]] = None
    overtime_warnings: Optional[List[str]] = None
    created_at: datetime
    updated_at: datetime

    model_config = _response_config


# ============================================
# Shift Swap Request Schemas
# ============================================


class ShiftSwapRequestCreate(BaseModel):
    """Schema for creating a shift swap request"""

    offering_shift_id: UUID
    requesting_shift_id: Optional[UUID] = None
    target_user_id: Optional[UUID] = None
    reason: Optional[str] = None


class ShiftSwapReview(BaseModel):
    """Schema for reviewing a shift swap request"""

    status: SwapRequestStatus
    reviewer_notes: Optional[str] = None


class ShiftSwapOfferResponseRequest(BaseModel):
    """A member answering an offer of someone else's seat.

    Distinct from ``ShiftSwapReview``: that carries a manager's verdict on any
    swap, this one is the answer from the member the offer was made to.
    """

    accept: bool
    note: Optional[str] = None


class ShiftSwapRequestResponse(UTCResponseBase):
    """Schema for shift swap request response"""

    id: UUID
    organization_id: UUID
    requesting_user_id: UUID
    requesting_user_name: Optional[str] = None
    target_user_id: Optional[UUID] = None
    target_user_name: Optional[str] = None
    offering_shift_id: UUID
    offering_shift_date: Optional[date] = None
    offering_shift_start_time: Optional[str] = None
    requesting_shift_id: Optional[UUID] = None
    requesting_shift_date: Optional[date] = None
    requesting_shift_start_time: Optional[str] = None
    status: SwapRequestStatus
    reason: Optional[str] = None
    reviewed_by: Optional[UUID] = None
    reviewer_notes: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = _response_config


class ShiftSwapRequestsPage(BaseModel):
    """Paginated shift swap request response."""

    items: List[ShiftSwapRequestResponse]
    total: int
    skip: int
    limit: int


class TradeCandidateResponse(BaseModel):
    """A member who could take over the caller's seat on a shift."""

    user_id: str
    user_name: Optional[str] = None
    rank: Optional[str] = None
    rank_display_name: Optional[str] = None
    position: str
    shifts_this_month: int = 0
    owes_trade: bool = False

    model_config = _response_config


# ============================================
# Standing Shift Schemas
# ============================================


class StandingShiftPattern(str, PyEnum):
    """How often a standing shift claim repeats."""

    WEEKLY = "weekly"
    BIWEEKLY = "biweekly"
    MONTHLY = "monthly"


class StandingShiftPeriod(str, PyEnum):
    """Which half of the day a standing claim targets."""

    DAY = "day"
    NIGHT = "night"


class StandingShiftBase(BaseModel):
    """The pattern a standing claim repeats on."""

    pattern: StandingShiftPattern = StandingShiftPattern.WEEKLY
    # 0 = Sunday … 6 = Saturday, matching the member-facing weekday picker.
    weekday: int = Field(..., ge=0, le=6)
    period: StandingShiftPeriod = StandingShiftPeriod.DAY
    start_date: date
    end_date: date
    apparatus_id: Optional[str] = None

    @model_validator(mode="after")
    def _check_range(self) -> "StandingShiftBase":
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class StandingShiftCreate(StandingShiftBase):
    """Schema for creating a standing shift claim."""

    position: ShiftPosition = ShiftPosition.FIREFIGHTER


class StandingShiftResponse(UTCResponseBase):
    """Schema for a standing shift claim."""

    id: UUID
    organization_id: UUID
    user_id: UUID
    pattern: str
    weekday: int
    period: str
    position: str
    apparatus_id: Optional[str] = None
    start_date: date
    end_date: date
    is_active: bool = True
    ended_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = _response_config


class StandingShiftPreviewDate(BaseModel):
    """One date in a standing series, and whether it can be claimed.

    ``status`` is reported for every date rather than only the claimable ones:
    a preview that silently dropped the rest would understate the commitment
    the member is about to make.
    """

    date: date
    shift_id: Optional[str] = None
    # available | conflict | already_yours | no_shift
    status: str


class StandingShiftPreviewResponse(BaseModel):
    """The dates a standing claim would cover, with conflicts flagged."""

    dates: List[StandingShiftPreviewDate]
    claimable_count: int = 0
    conflict_count: int = 0
    missing_count: int = 0


class StandingShiftCreateResult(BaseModel):
    """What creating a standing claim actually did."""

    claim: StandingShiftResponse
    claimed: int = 0
    skipped: int = 0
    no_shift: int = 0


# ============================================
# Shift Time Off Schemas
# ============================================


class ShiftTimeOffCreate(BaseModel):
    """Schema for creating a time off request"""

    start_date: date
    end_date: date
    reason: Optional[str] = None

    @model_validator(mode="after")
    def validate_date_range(self) -> "ShiftTimeOffCreate":
        if self.end_date < self.start_date:
            raise ValueError("end_date must not be before start_date")
        return self


class ShiftTimeOffReview(BaseModel):
    """Schema for reviewing a time off request"""

    status: TimeOffStatus
    reviewer_notes: Optional[str] = None


class ShiftTimeOffResponse(UTCResponseBase):
    """Schema for time off request response"""

    id: UUID
    organization_id: UUID
    user_id: UUID
    user_name: Optional[str] = None
    start_date: date
    end_date: date
    status: TimeOffStatus
    reason: Optional[str] = None
    reviewer_notes: Optional[str] = None
    approved_by: Optional[UUID] = None
    approved_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = _response_config


class ShiftTimeOffRequestsPage(BaseModel):
    """Paginated time-off request response."""

    items: List[ShiftTimeOffResponse]
    total: int
    skip: int
    limit: int


# ============================================
# Shift Signup (Member Self-Service)
# ============================================


class ShiftSignupRequest(BaseModel):
    """Schema for a member signing up for an open shift position"""

    position: ShiftPosition = ShiftPosition.FIREFIGHTER
    # Required on a community-outreach signup sheet and ignored everywhere
    # else. Its vocabulary is the department's own (tour guide, educator,
    # facilitator), which is why it is a plain string rather than a
    # ShiftPosition — see ShiftAssignment.outreach_role.
    outreach_role: Optional[str] = Field(None, max_length=100)


# ============================================
# Position Eligibility
# ============================================


class EligiblePositionsResponse(BaseModel):
    """Positions the current user is eligible to sign up for."""

    positions: List[str]
    is_excluded: bool = False


class SchedulingEligibilitySettings(BaseModel):
    """Org-level scheduling eligibility configuration."""

    excluded_membership_types: Optional[List[str]] = None
    open_positions: Optional[List[str]] = None


class SchedulingEligibilitySettingsResponse(BaseModel):
    """Current scheduling eligibility settings for the org."""

    excluded_membership_types: List[str]
    open_positions: List[str]


class PositionEligibilitySource(BaseModel):
    """One reason a member holds a position.

    ``type`` is ``rank``, ``position``, ``training``, or ``open``; ``label``
    names the specific rank, held position, or completed program so an officer
    can see *why* without cross-referencing the settings screens. Every type
    here needs a matching entry in the roster page's ``SOURCE_STYLES`` — an
    unmapped one renders with the rank badge's icon and colour, which reads as
    a duplicate rank rather than as a distinct source.
    """

    type: str
    label: str


class RosterApparatusClearance(BaseModel):
    """An apparatus the member holds a current operator record on."""

    apparatus_id: str
    unit_number: str
    certification_expiration: Optional[date] = None


class PositionRosterMember(BaseModel):
    """A member eligible for a position, with the basis for that eligibility."""

    user_id: str
    user_name: str
    rank: Optional[str] = None
    rank_display_name: Optional[str] = None
    membership_type: str
    platoon: Optional[str] = None
    sources: List[PositionEligibilitySource]
    evoc_level_number: Optional[int] = None
    evoc_level_name: Optional[str] = None
    apparatus_cleared: List[RosterApparatusClearance] = []


class PositionRosterResponse(BaseModel):
    """Department-wide roster of everyone eligible for a shift position."""

    position: str
    members: List[PositionRosterMember]
    excluded_membership_types: List[str]
    is_open_position: bool


class CalendarFeedResponse(BaseModel):
    """The member's personal ICS calendar-feed token and relative path."""

    token: str
    feed_path: str


class SchedulingFeatureSettings(BaseModel):
    """Department-wide scheduling feature toggles (readable by any member)."""

    platoons_enabled: bool = False
    # Overtime advisory: when max_hours_per_window > 0, assigning a member is
    # flagged (soft, non-blocking) if their scheduled hours in the trailing
    # window exceed the cap. 0/None disables the check.
    max_hours_per_window: Optional[float] = Field(default=None, ge=0, le=336)
    hours_window_days: int = Field(default=7, ge=1, le=31)
    # Auto-generation: when enabled, a daily task keeps active patterns
    # generating shifts this many weeks ahead.
    auto_generate_enabled: bool = False
    auto_generate_weeks: int = Field(default=4, ge=1, le=52)
    # Lifecycle enforcement
    require_end_of_shift_checks: bool = False
    restrict_checkin_to_assigned: bool = False
    # Driver qualification. Defaults on: a member without the EVOC level an
    # apparatus requires cannot be seated as its driver. Inert until an admin
    # sets required_evoc_level_id on an apparatus, so switching it on for
    # existing orgs changes nothing until they opt into the requirement.
    enforce_evoc: bool = True
    # Call-volume tracking mode and the department's own call-type list.
    call_tracking: Optional[CallTrackingSettings] = None


# ============================================
# Basic Apparatus (Lightweight, for non-module departments)
# ============================================


class ApparatusOption(BaseModel):
    """A single vehicle option for shift template assignment"""

    id: Optional[str] = None
    name: str
    unit_number: Optional[str] = None
    apparatus_type: str
    source: str  # "apparatus", "basic", or "default"
    # Seat lists are stored as {"position", "required"} slots (see
    # app/utils/positions.py). Declared List[Any] like every other positions
    # field in this module: a List[str] here rejected the canonical shape and
    # 500'd the endpoint for any org whose apparatus had seats.
    positions: Optional[List[Any]] = None
    min_staffing: Optional[int] = None


class ApparatusOptionsResponse(BaseModel):
    """Response for apparatus options endpoint"""

    options: List[ApparatusOption]
    source: str  # primary source used: "apparatus", "basic", or "default"


class BasicApparatusCreate(BaseModel):
    """Schema for creating a basic apparatus entry"""

    unit_number: str = Field(..., min_length=1, max_length=20)
    name: str = Field(..., min_length=1, max_length=100)
    apparatus_type: str = Field(default="engine", max_length=50)
    min_staffing: Optional[int] = Field(default=1, ge=1, le=50)
    positions: Optional[List[Any]] = None


class BasicApparatusUpdate(BaseModel):
    """Schema for updating a basic apparatus entry"""

    unit_number: Optional[str] = Field(None, min_length=1, max_length=20)
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    apparatus_type: Optional[str] = Field(None, max_length=50)
    min_staffing: Optional[int] = Field(None, ge=1, le=50)
    positions: Optional[List[Any]] = None


class BasicApparatusResponse(UTCResponseBase):
    """Schema for basic apparatus response"""

    id: UUID
    organization_id: UUID
    unit_number: str
    name: str
    apparatus_type: str
    min_staffing: Optional[int] = None
    positions: Optional[List[Any]] = None
    is_active: bool = True
    created_at: datetime
    updated_at: datetime

    model_config = _response_config


# ============================================
# Shift Compliance Schemas
# ============================================


class MemberComplianceRecord(BaseModel):
    """Per-member compliance status for a single requirement"""

    user_id: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    full_name: Optional[str] = None
    rank: Optional[str] = None
    completed_value: float
    percentage: float
    compliant: bool
    shift_count: int
    total_hours: float


class RequirementComplianceSummary(BaseModel):
    """Compliance summary for a single shift/hours requirement"""

    requirement_id: str
    requirement_name: str
    requirement_type: str
    required_value: float
    frequency: str
    period_start: str
    period_end: str
    members: List[MemberComplianceRecord]
    total_members: int
    compliant_count: int
    non_compliant_count: int
    compliance_rate: float


class ShiftComplianceResponse(BaseModel):
    """Response for shift compliance endpoint"""

    requirements: List[RequirementComplianceSummary]
    reference_date: str
    total_requirements: int

"""
Scheduling API Endpoints

Endpoints for shift scheduling including shift management,
attendance tracking, and calendar views.
"""

import copy
from datetime import date, timedelta
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import (
    PaginationParams,
    get_current_user,
    require_permission,
    user_has_permission,
)
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.error_codes import CodedHTTPException, CodedValueError
from app.core.utils import ensure_found, safe_error_detail
from app.models.event_request import EventRequest
from app.models.training import (
    AssignmentStatus,
    BasicApparatus,
    Shift,
    ShiftAssignment,
    ShiftAttendance,
    ShiftCall,
    ShiftPosition,
    StandingShiftPattern,
    StandingShiftPeriod,
)
from app.models.user import Organization, User
from app.schemas.scheduling import (
    ApparatusOptionsResponse,
    BasicApparatusCreate,
    BasicApparatusResponse,
    BasicApparatusUpdate,
    CalendarFeedResponse,
    CallTrackingSettings,
    CloseoutAttendanceRequest,
    CloseoutCallsRequest,
    CloseoutStateResponse,
    EligiblePositionsResponse,
    GenerateShiftsRequest,
    LateSignupOpenRequest,
    MemberHoursHistoryResponse,
    PlatoonBulkAssign,
    PlatoonBulkAssignResult,
    PlatoonOverviewResponse,
    PositionRosterResponse,
    SchedulingEligibilitySettings,
    SchedulingEligibilitySettingsResponse,
    SchedulingFeatureSettings,
    SchedulingSummary,
    SchedulingWidgetPreferences,
    SchedulingWidgetSummary,
    ShiftAssignmentCreate,
    ShiftAssignmentResponse,
    ShiftAssignmentUpdate,
    ShiftAttendanceCreate,
    ShiftAttendanceResponse,
    ShiftAttendanceUpdate,
    ShiftCallCreate,
    ShiftCallResponse,
    ShiftCallUpdate,
    ShiftCancelRequest,
    ShiftComplianceResponse,
    ShiftCreate,
    ShiftDetailResponse,
    ShiftFinalizeRequest,
    ShiftPatternCreate,
    ShiftPatternResponse,
    ShiftPatternUpdate,
    ShiftReopenRequest,
    ShiftResponse,
    ShiftSignupRequest,
    ShiftsListResponse,
    ShiftSwapOfferResponseRequest,
    ShiftSwapRequestCreate,
    ShiftSwapRequestResponse,
    ShiftSwapRequestsPage,
    ShiftSwapReview,
    ShiftTemplateCreate,
    ShiftTemplateResponse,
    ShiftTemplateUpdate,
    ShiftTimeOffCreate,
    ShiftTimeOffRequestsPage,
    ShiftTimeOffResponse,
    ShiftTimeOffReview,
    ShiftUpdate,
    StandingShiftCreate,
    StandingShiftCreateResult,
)
from app.schemas.scheduling import StandingShiftPattern as SchemaStandingShiftPattern
from app.schemas.scheduling import StandingShiftPeriod as SchemaStandingShiftPeriod
from app.schemas.scheduling import (
    StandingShiftPreviewResponse,
    StandingShiftResponse,
    SwapRequestStatus,
    TimeOffStatus,
    TradeCandidateResponse,
)
from app.services.event_request_service import (
    OUTREACH_SEAT_POSITION,
    outreach_role_label,
    resolve_outreach_signup_role,
)
from app.services.integration_services.notification_dispatch import (
    notify_entity_created,
    notify_summary,
)
from app.services.scheduling_module_config_service import (
    apparatus_type_defaults_for_org,
)
from app.services.scheduling_service import SchedulingService, SignupActor
from app.services.scheduling_widget_service import (
    MAX_WIDGET_WINDOW_DAYS,
    SchedulingWidgetService,
)
from app.services.shift_eligibility_service import ShiftEligibilityService
from app.services.standing_shift_service import MAX_SERIES_DAYS, StandingShiftService
from app.utils.hours import hours_from_minutes
from app.utils.outreach_roles import normalize_staffing_roles
from app.utils.positions import normalize_stored_positions

router = APIRouter()

# Maximum span for the open-shifts lookup window (about a year), so a caller
# cannot request an arbitrarily wide date range.
MAX_OPEN_SHIFTS_DAYS = 366

# The day panel asks about one day's shifts; a very busy station might run a
# dozen. The cap is what stops a caller asking about a whole year in one go.
MAX_BULK_ELIGIBILITY_SHIFTS = 50

# Maximum span for a single pattern-generation request. Generation WRITES a
# shift (+ assignments) per day in one transaction, so an unbounded range is a
# DoS (memory/DB exhaustion). About a year, matching the read-window cap.
MAX_GENERATION_DAYS = 366


def _enum_value(value) -> str | None:
    """Unwrap a SQLAlchemy Enum column to its string value.

    Columns declared with ``values_callable`` hand back the Python enum member
    on a freshly-flushed row but the raw string on a row loaded from the
    database, so neither ``.value`` nor ``str()`` alone is safe here.
    """
    if value is None:
        return None
    return getattr(value, "value", value)


def _safe_detail(prefix: str, error: str | None) -> str:
    """Build a sanitized error detail from a service-layer error string."""
    if not error:
        return f"{prefix} An unexpected error occurred."
    return f"{prefix} {safe_error_detail(ValueError(error))}"


def _is_shift_officer(shift, user: User) -> bool:
    """True if ``user`` is the named on-duty officer of ``shift``."""
    return bool(shift.shift_officer_id and str(shift.shift_officer_id) == str(user.id))


def _can_view_platoon_roster(shift, user: User) -> bool:
    """True when ``user`` may see the shift's staffing availability details."""
    return (
        user_has_permission(user, "scheduling.assign")
        or user_has_permission(user, "scheduling.manage")
        or _is_shift_officer(shift, user)
    )


def _signup_actor(shift, user: User) -> SignupActor:
    """How the signup window sees this caller on this shift.

    ``scheduling.manage`` is never bounded — adding somebody to a shift that
    ran last month is records work, and it is the one way a department repairs
    a roster. A delegated assigner, or the shift's own officer (who carries the
    same per-shift authority everywhere else in this module), is bounded by the
    department's grace period. Everybody else is a member.

    Resolved here rather than in the service, which cannot see the request and
    deliberately knows nothing about permissions.
    """
    if user_has_permission(user, "scheduling.manage"):
        return SignupActor.MANAGER
    if user_has_permission(user, "scheduling.assign") or _is_shift_officer(shift, user):
        return SignupActor.ASSIGNER
    return SignupActor.MEMBER


async def _authorize_shift_management(
    service: SchedulingService,
    current_user: User,
    shift_id: UUID,
    permission: str,
):
    """Resolve a shift and authorize a roster/day-of-shift action on it.

    The action is allowed when the caller holds ``permission`` org-wide **or**
    is the shift's named on-duty officer (per-shift authority — the officer
    running a shift can manage its crew, attendance, calls, and closeout
    without a department-wide scheduling grant). Raises 404 if the shift is not
    in the caller's org, 403 if neither condition is met. Returns the shift.
    """
    shift = await service.get_shift_by_id(shift_id, current_user.organization_id)
    if shift is None:
        raise HTTPException(status_code=404, detail="Shift not found")
    if user_has_permission(current_user, permission) or _is_shift_officer(
        shift, current_user
    ):
        return shift
    raise HTTPException(status_code=403, detail="Insufficient permissions")


async def _authorize_handoff_access(
    service: SchedulingService,
    current_user: User,
    shift_id: UUID,
):
    """Allow handoff access only to the incoming crew or shift managers."""
    shift = await service.get_shift_by_id(shift_id, current_user.organization_id)
    if shift is None:
        raise HTTPException(status_code=404, detail="Shift not found")
    if user_has_permission(current_user, "scheduling.manage") or _is_shift_officer(
        shift, current_user
    ):
        return shift

    assignments = await service.get_shift_assignments(
        shift_id, current_user.organization_id
    )
    active_statuses = {
        AssignmentStatus.ASSIGNED.value,
        AssignmentStatus.CONFIRMED.value,
    }
    if any(
        str(assignment.user_id) == str(current_user.id)
        and assignment.assignment_status in active_statuses
        for assignment in assignments
    ):
        return shift
    raise HTTPException(status_code=403, detail="Insufficient permissions")


async def _attach_assignment_warnings(
    db: AsyncSession,
    service: SchedulingService,
    response: dict,
    shift_id: UUID,
    organization_id,
    user_id: str,
    position: str,
) -> dict:
    """Attach soft, non-blocking advisories to an assignment response — EVOC
    driver eligibility and overtime/hours. Shared by admin-assign and member
    self-signup so both surface the same warnings.
    """
    if position == "driver":
        from app.services.shift_eligibility_service import ShiftEligibilityService

        evoc_warnings = await ShiftEligibilityService(
            db
        ).get_driver_assignment_warnings(
            user_id=str(user_id),
            shift_id=str(shift_id),
            organization_id=str(organization_id),
        )
        if evoc_warnings:
            response["evoc_warnings"] = evoc_warnings

    shift = await service.get_shift_by_id(shift_id, organization_id)
    if shift is not None:
        overtime_warnings = await service.get_overtime_warnings(
            user_id=str(user_id),
            shift=shift,
            organization_id=organization_id,
        )
        if overtime_warnings:
            response["overtime_warnings"] = overtime_warnings
    return response


async def _authorize_assignment_management(
    service: SchedulingService,
    current_user: User,
    assignment_id: UUID,
):
    """Authorize editing/removing an existing assignment (keyed by its id).

    Allowed with ``scheduling.assign`` org-wide or when the caller is the
    officer of the assignment's shift. Returns the assignment.
    """
    assignment = await service.get_assignment_by_id(
        assignment_id, current_user.organization_id
    )
    if assignment is None:
        raise HTTPException(status_code=404, detail="Shift assignment not found")
    if not user_has_permission(current_user, "scheduling.assign"):
        shift = await service.get_shift_by_id(
            assignment.shift_id, current_user.organization_id
        )
        if not (shift and _is_shift_officer(shift, current_user)):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
    return assignment


# ============================================
# Apparatus enrichment helper
# ============================================


def _outreach_role_slots(org, needed: list[dict], roster: list[dict]) -> list[dict]:
    """How full each role on an outreach signup sheet is."""
    if not needed:
        return []
    filled: dict[str, int] = {}
    for seat in roster:
        role = seat.get("outreach_role")
        if role:
            filled[role] = filled.get(role, 0) + 1
    return [
        {
            "role": entry["role"],
            "label": outreach_role_label(org, entry["role"]),
            "total": entry["count"],
            "filled": min(filled.get(entry["role"], 0), entry["count"]),
            "remaining": max(entry["count"] - filled.get(entry["role"], 0), 0),
        }
        for entry in needed
    ]


async def _enrich_shifts(
    service: SchedulingService,
    organization_id,
    shifts: list,
) -> list[dict]:
    """Convert Shift ORM objects to dicts enriched with apparatus details,
    shift officer names, attendee counts, and the seated roster.

    The roster is carried on every shift in the list so a calendar can render
    "who is on this shift" from the one month fetch. Without it the detail
    panel needs a second round trip per day the member clicks, and the
    calendar cannot colour a cell by "you are on it" at all.
    """
    if not shifts:
        return []

    apparatus_ids = list({s.apparatus_id for s in shifts if s.apparatus_id})
    apparatus_map = await service._get_apparatus_map(organization_id, apparatus_ids)

    # Outreach signup sheets name their seats by role (tour guide, educator)
    # rather than by crew position, and the roles live on the event request the
    # sheet was opened from. Resolved in one pass here, and only when the batch
    # actually contains one, so an ordinary month of duty shifts costs nothing.
    outreach_ids = [str(s.id) for s in shifts if getattr(s, "is_outreach", False)]
    outreach_org = None
    outreach_needs: dict[str, list[dict]] = {}
    if outreach_ids:
        outreach_org = await service.db.scalar(
            select(Organization).where(Organization.id == str(organization_id))
        )
        need_rows = await service.db.execute(
            select(EventRequest).where(
                EventRequest.staffing_shift_id.in_(outreach_ids),
                EventRequest.organization_id == str(organization_id),
            )
        )
        for req in need_rows.scalars().all():
            outreach_needs[str(req.staffing_shift_id)] = normalize_staffing_roles(
                req.staffing_roles
            )

    # Resolve shift officer names
    officer_ids = list({s.shift_officer_id for s in shifts if s.shift_officer_id})
    user_name_map = await service._get_user_name_map(officer_ids)

    # Compute attendee_count and the seated roster per shift (only active
    # assignments). One pass over the assignment rows feeds both, so adding
    # the roster costs no extra query over the count it replaces.
    shift_ids = [s.id for s in shifts]
    attendee_counts: dict[str, int] = {}
    rosters: dict[str, list[dict]] = {}
    call_counts: dict[str, int] = {}
    hours_map: dict[str, float] = {}
    _active_statuses = [
        AssignmentStatus.ASSIGNED.value,
        AssignmentStatus.CONFIRMED.value,
    ]
    if shift_ids:
        seat_result = await service.db.execute(
            select(ShiftAssignment)
            .where(ShiftAssignment.shift_id.in_(shift_ids))
            .where(ShiftAssignment.organization_id == str(organization_id))
            .where(ShiftAssignment.assignment_status.in_(_active_statuses))
            .order_by(ShiftAssignment.created_at)
        )
        seats = list(seat_result.scalars().all())
        seat_name_map = await service._get_user_name_map(
            list({s.user_id for s in seats if s.user_id})
        )
        for seat in seats:
            key = str(seat.shift_id)
            attendee_counts[key] = attendee_counts.get(key, 0) + 1
            rosters.setdefault(key, []).append(
                {
                    "assignment_id": str(seat.id),
                    "user_id": str(seat.user_id),
                    "user_name": seat_name_map.get(str(seat.user_id)),
                    "position": _enum_value(seat.position),
                    "outreach_role": seat.outreach_role,
                    "outreach_role_label": outreach_role_label(
                        outreach_org, seat.outreach_role
                    ),
                    "status": _enum_value(seat.assignment_status),
                    "is_training": bool(seat.is_training),
                }
            )

        call_result = await service.db.execute(
            select(
                ShiftCall.shift_id,
                func.count(ShiftCall.id),
            )
            .where(ShiftCall.shift_id.in_(shift_ids))
            .group_by(ShiftCall.shift_id)
        )
        for row in call_result.all():
            call_counts[str(row[0])] = row[1]

        hours_result = await service.db.execute(
            select(
                ShiftAttendance.shift_id,
                func.coalesce(func.sum(ShiftAttendance.duration_minutes), 0),
            )
            .where(ShiftAttendance.shift_id.in_(shift_ids))
            .group_by(ShiftAttendance.shift_id)
        )
        for row in hours_result.all():
            total_min = float(row[1])
            hours_map[str(row[0])] = hours_from_minutes(total_min)

    enriched = []
    for s in shifts:
        d = {c.key: getattr(s, c.key) for c in s.__table__.columns}
        # Pass-downs are operationally sensitive and are served exclusively by
        # the roster-authorized handoff endpoint below.
        d.pop("pass_down_notes", None)
        service._enrich_shift_dict(d, apparatus_map, user_name_map)
        d["attendee_count"] = attendee_counts.get(str(s.id), 0)
        d["roster"] = rosters.get(str(s.id), [])
        d["outreach_roles"] = _outreach_role_slots(
            outreach_org,
            outreach_needs.get(str(s.id), []),
            rosters.get(str(s.id), []),
        )
        d["call_count"] = call_counts.get(str(s.id), 0)
        d["total_hours"] = hours_map.get(str(s.id))
        enriched.append(d)
    return enriched


async def _member_visible_shifts(
    service: SchedulingService, current_user: User, shifts: list
) -> list:
    """Apply signup eligibility to member-facing schedule results."""
    if user_has_permission(current_user, "scheduling.manage") or not shifts:
        return shifts
    eligible = await ShiftEligibilityService(service.db).get_eligible_positions_bulk(
        current_user,
        str(current_user.organization_id),
        [str(shift.id) for shift in shifts],
    )
    return [shift for shift in shifts if eligible.get(str(shift.id))]


async def _ensure_member_can_view_shift(
    service: SchedulingService, current_user: User, shift
) -> None:
    """Prevent direct detail URLs from bypassing member list visibility."""
    if user_has_permission(current_user, "scheduling.manage") or _is_shift_officer(
        shift, current_user
    ):
        return
    assignment = await service.db.execute(
        select(ShiftAssignment.id).where(
            ShiftAssignment.shift_id == str(shift.id),
            ShiftAssignment.organization_id == str(current_user.organization_id),
            ShiftAssignment.user_id == str(current_user.id),
            ShiftAssignment.assignment_status.in_(
                [
                    AssignmentStatus.ASSIGNED,
                    AssignmentStatus.CONFIRMED,
                    AssignmentStatus.PENDING,
                ]
            ),
        )
    )
    if assignment.scalar_one_or_none() is not None:
        return
    eligible = await ShiftEligibilityService(service.db).get_eligible_positions(
        current_user, str(current_user.organization_id), str(shift.id)
    )
    if not eligible:
        raise HTTPException(
            status_code=403, detail="You are not eligible to view this shift"
        )


# ============================================
# Shift Endpoints
# ============================================


@router.get("/shifts", response_model=ShiftsListResponse)
async def list_shifts(
    start_date: str | None = None,
    end_date: str | None = None,
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """List shifts with optional date filtering"""
    service = SchedulingService(db)

    try:
        start = date.fromisoformat(start_date) if start_date else None
        end = date.fromisoformat(end_date) if end_date else None
    except ValueError:
        raise HTTPException(
            status_code=400, detail="Invalid date format. Use YYYY-MM-DD."
        )

    if user_has_permission(current_user, "scheduling.manage"):
        shifts, total = await service.get_shifts(
            current_user.organization_id,
            start_date=start,
            end_date=end,
            skip=pagination.skip,
            limit=pagination.limit,
        )
    else:
        shifts, total = await service.get_member_visible_shifts(
            current_user,
            current_user.organization_id,
            start_date=start,
            end_date=end,
            skip=pagination.skip,
            limit=pagination.limit,
        )

    enriched = await _enrich_shifts(service, current_user.organization_id, shifts)
    return {
        "shifts": enriched,
        "total": total,
        "skip": pagination.skip,
        "limit": pagination.limit,
    }


@router.post(
    "/shifts", response_model=ShiftResponse, status_code=status.HTTP_201_CREATED
)
async def create_shift(
    shift: ShiftCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Create a new shift"""
    service = SchedulingService(db)
    shift_data = shift.model_dump(exclude_none=True)
    result, error = await service.create_shift(
        current_user.organization_id, shift_data, current_user.id
    )
    if error or result is None:
        raise HTTPException(
            status_code=400,
            detail=_safe_detail("Unable to create shift.", error),
        )
    # Notify the org's chat integrations about the new shift (background).
    platoon = getattr(result, "platoon", None)
    start_time = getattr(result, "start_time", None)
    end_time = getattr(result, "end_time", None)
    background_tasks.add_task(
        notify_entity_created,
        str(current_user.organization_id),
        "shift",
        {
            "type": f"Platoon {platoon}" if platoon else "Shift",
            "start_time": start_time.isoformat() if start_time else "",
            "end_time": end_time.isoformat() if end_time else "",
            "crew": [],
        },
    )
    enriched = await _enrich_shifts(service, current_user.organization_id, [result])
    return enriched[0]


@router.get("/shifts/open", response_model=list[ShiftResponse])
async def get_open_shifts(
    start_date: str | None = None,
    end_date: str | None = None,
    apparatus_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get upcoming shifts (optionally filtered by date range and apparatus).
    Returns shifts that still have open positions.
    Must be registered before /shifts/{shift_id} to avoid route shadowing.
    """
    service = SchedulingService(db)
    try:
        start = date.fromisoformat(start_date) if start_date else date.today()
        end = date.fromisoformat(end_date) if end_date else start + timedelta(days=30)
    except ValueError:
        raise HTTPException(
            status_code=400, detail="Invalid date format. Use YYYY-MM-DD."
        )

    # Bound the window so a caller cannot request an arbitrarily wide range
    # (and so a reversed range is rejected rather than silently scanning).
    if end < start:
        raise HTTPException(
            status_code=400, detail="end_date must not be before start_date."
        )
    if (end - start).days > MAX_OPEN_SHIFTS_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"Date range must not exceed {MAX_OPEN_SHIFTS_DAYS} days.",
        )

    # Date window, finalized status, and apparatus are filtered in SQL; the
    # result is every open shift in the window with shifts the current user is
    # already on removed (computed in a single assignment scan).
    shifts_list = await service.get_open_shifts(
        current_user.organization_id,
        start,
        end,
        apparatus_id=apparatus_id,
        exclude_user_id=str(current_user.id),
    )
    shifts_list = await _member_visible_shifts(service, current_user, shifts_list)

    return await _enrich_shifts(service, current_user.organization_id, shifts_list)


@router.get("/shifts/{shift_id}", response_model=ShiftDetailResponse)
async def get_shift(
    shift_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """Get a shift by ID with attendance"""
    service = SchedulingService(db)
    shift = ensure_found(
        await service.get_shift_by_id(shift_id, current_user.organization_id),
        "Shift",
    )
    await _ensure_member_can_view_shift(service, current_user, shift)

    attendance_records = await service.get_shift_attendance(
        shift_id, current_user.organization_id
    )
    apparatus_ids = [shift.apparatus_id] if shift.apparatus_id else []
    apparatus_map = await service._get_apparatus_map(
        current_user.organization_id, apparatus_ids
    )
    officer_ids = [shift.shift_officer_id] if shift.shift_officer_id else []
    user_name_map = await service._get_user_name_map(officer_ids)
    d = {c.key: getattr(shift, c.key) for c in shift.__table__.columns}
    d.pop("pass_down_notes", None)
    service._enrich_shift_dict(d, apparatus_map, user_name_map)

    member_call_counts = await service.compute_member_call_counts(shift_id)

    call_result = await service.db.execute(
        select(func.count(ShiftCall.id)).where(ShiftCall.shift_id == str(shift_id))
    )
    call_count = call_result.scalar() or 0

    total_min_result = await service.db.execute(
        select(func.coalesce(func.sum(ShiftAttendance.duration_minutes), 0)).where(
            ShiftAttendance.shift_id == str(shift_id)
        )
    )
    # MySQL's SUM() over an integer column comes back as DECIMAL, and Decimal
    # does not support division by a float — dividing straight through raises
    # TypeError and 500s the whole shift detail response. The list endpoint
    # above coerces for the same reason.
    total_min = float(total_min_result.scalar() or 0)
    total_hours = hours_from_minutes(total_min) if total_min > 0 else None

    attendees = await service.enrich_attendance_records(
        attendance_records, member_call_counts
    )

    # The roster reveals other members' availability and leave status. Keep
    # general shift details visible to members, but only fetch and expose these
    # staffing details to schedulers or the officer responsible for the shift.
    platoon_roster = (
        await service.get_platoon_roster_for_shift(shift)
        if _can_view_platoon_roster(shift, current_user)
        else []
    )

    # Whether check-in is open, decided by the same helper the check-in endpoint
    # enforces with. Published so the check-in screen can disable its own button
    # and say why, rather than offering an action the API will refuse — and so
    # the rule has one implementation rather than one per side.
    checkin_closed_reason = await service.checkin_closed_reason(
        shift, current_user.organization_id
    )

    # The same arrangement for signup: the panel disables its own button and
    # prints this rather than reimplementing the rule and drifting from what
    # the API enforces. Actor-relative — a manager always reads open — which is
    # why it belongs on the detail response, where the caller is known.
    signup_closed_reason = await service.signup_closed_reason(
        shift, current_user.organization_id, _signup_actor(shift, current_user)
    )

    return {
        **d,
        "attendees": attendees,
        "attendee_count": len(attendees),
        "call_count": call_count,
        "total_hours": total_hours,
        "platoon_roster": platoon_roster,
        "checkin_open": checkin_closed_reason is None,
        "checkin_closed_reason": checkin_closed_reason,
        "signup_open": signup_closed_reason is None,
        "signup_closed_reason": signup_closed_reason,
    }


@router.patch("/shifts/{shift_id}", response_model=ShiftResponse)
async def update_shift(
    shift_id: UUID,
    shift: ShiftUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Update a shift"""
    service = SchedulingService(db)
    update_data = shift.model_dump(exclude_unset=True)
    result, error = await service.update_shift(
        shift_id, current_user.organization_id, update_data
    )
    if error or result is None:
        raise HTTPException(
            status_code=400,
            detail=_safe_detail("Unable to update shift.", error),
        )
    enriched = await _enrich_shifts(service, current_user.organization_id, [result])
    return enriched[0]


@router.delete("/shifts/{shift_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_shift(
    shift_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Delete a shift"""
    service = SchedulingService(db)
    success, error = await service.delete_shift(shift_id, current_user.organization_id)
    if not success:
        raise HTTPException(
            status_code=400, detail=_safe_detail("Unable to delete shift.", error)
        )


@router.post("/shifts/{shift_id}/finalize", response_model=ShiftResponse)
async def finalize_shift(
    shift_id: UUID,
    body: ShiftFinalizeRequest = ShiftFinalizeRequest(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Finalize a shift after the officer has reviewed attendance and checklists.

    Optionally include ``manual_hours`` to credit members who did not
    check in/out with a specific number of hours.

    Departments on ``count_only`` call tracking report call volume here:
    ``reported_call_count`` (the number this apparatus ran), an optional
    ``reported_call_types`` tally, ``member_call_counts`` for members who were
    not on every call, and ``attach_call_ids`` for calls another unit already
    logged that this apparatus was also on — attaching is what keeps a single
    incident counted once for the department when two units roll.

    Once finalized the shift is considered closed and attendance is locked.

    **Permissions required:** scheduling.manage, or being the shift's officer.
    """
    service = SchedulingService(db)
    await _authorize_shift_management(
        service, current_user, shift_id, "scheduling.manage"
    )
    manual = None
    if body.manual_hours:
        manual = [
            {"user_id": str(entry.user_id), "hours": entry.hours}
            for entry in body.manual_hours
        ]
    member_credits = None
    if body.member_call_counts:
        member_credits = {
            str(entry.user_id): entry.call_count for entry in body.member_call_counts
        }
    shift, error = await service.finalize_shift(
        shift_id,
        current_user.organization_id,
        finalized_by_user_id=str(current_user.id),
        manual_hours=manual,
        override_incomplete_checks=body.override_incomplete_checks,
        pass_down_notes=body.pass_down_notes,
        reported_call_count=body.reported_call_count,
        reported_call_types=body.reported_call_types,
        member_call_counts_in=member_credits,
        attach_call_ids=(
            [str(c) for c in body.attach_call_ids] if body.attach_call_ids else None
        ),
    )
    if not shift:
        raise HTTPException(
            status_code=400,
            detail=_safe_detail("Unable to finalize shift.", error),
        )
    if body.override_incomplete_checks:
        await log_audit_event(
            db=db,
            event_type="shift_finalized_check_override",
            event_category="scheduling",
            severity="WARNING",
            event_data={
                "organization_id": str(current_user.organization_id),
                "shift_id": str(shift_id),
                "reason": (body.override_reason or "").strip() or None,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
    # SchedulingService.finalize_shift archives the related shift-validation
    # prompt itself, so every finalize path clears it — not just this endpoint.
    enriched = await _enrich_shifts(service, current_user.organization_id, [shift])
    return enriched[0]


@router.get("/shifts/{shift_id}/closeout", response_model=CloseoutStateResponse)
async def get_shift_closeout_state(
    shift_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Everything the close-out wizard needs, plus where to resume.

    ``closeout_step`` is 0 before the officer starts, 1 once attendance times
    are saved and 2 once calls are, so a phone that locked mid-flow reopens on
    the screen it left rather than at the beginning.

    **Permissions required:** scheduling.manage, or being the shift's officer.
    """
    service = SchedulingService(db)
    await _authorize_shift_management(
        service, current_user, shift_id, "scheduling.manage"
    )
    state, error = await service.get_closeout_state(
        shift_id, current_user.organization_id
    )
    if state is None:
        raise HTTPException(
            status_code=404, detail=_safe_detail("Shift not found.", error)
        )
    return state


@router.patch(
    "/shifts/{shift_id}/closeout/attendance", response_model=CloseoutStateResponse
)
async def save_shift_closeout_attendance(
    shift_id: UUID,
    body: CloseoutAttendanceRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Step 1 of close-out — record when each member was actually on.

    Saves immediately rather than holding the answer until the last screen, so
    an interrupted close-out keeps the hours already confirmed.

    **Permissions required:** scheduling.manage, or being the shift's officer.
    """
    service = SchedulingService(db)
    await _authorize_shift_management(
        service, current_user, shift_id, "scheduling.manage"
    )
    state, error = await service.save_closeout_attendance(
        shift_id,
        current_user.organization_id,
        [
            {
                "user_id": str(e.user_id),
                "checked_in_at": e.checked_in_at,
                "checked_out_at": e.checked_out_at,
            }
            for e in body.entries
        ],
    )
    if state is None:
        raise HTTPException(
            status_code=400,
            detail=_safe_detail("Unable to save attendance.", error),
        )
    return state


@router.patch("/shifts/{shift_id}/closeout/calls", response_model=CloseoutStateResponse)
async def save_shift_closeout_calls(
    shift_id: UUID,
    body: CloseoutCallsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Step 2 of close-out — record how many calls the apparatus ran.

    ``attach_call_ids`` claims calls another unit already logged, so a single
    incident two units rolled on counts once for the department and as a run
    for each of them.

    **Permissions required:** scheduling.manage, or being the shift's officer.
    """
    service = SchedulingService(db)
    await _authorize_shift_management(
        service, current_user, shift_id, "scheduling.manage"
    )
    state, error = await service.save_closeout_calls(
        shift_id,
        current_user.organization_id,
        reported_call_count=body.reported_call_count,
        reported_call_types=body.reported_call_types,
        attach_call_ids=(
            [str(c) for c in body.attach_call_ids] if body.attach_call_ids else None
        ),
        recorded_by=str(current_user.id),
        # Distinguishes "not sent" from an explicit null, so a client that
        # only attaches calls does not wipe a count it never mentioned.
        count_provided="reported_call_count" in body.model_fields_set,
    )
    if state is None:
        raise HTTPException(
            status_code=400,
            detail=_safe_detail("Unable to save call count.", error),
        )
    return state


@router.post("/shifts/{shift_id}/reopen", response_model=ShiftResponse)
async def reopen_shift(
    shift_id: UUID,
    body: ShiftReopenRequest = ShiftReopenRequest(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Reopen a finalized shift for corrections, then it can be re-finalized.

    **Permissions required:** scheduling.manage, or being the shift's officer.
    """
    service = SchedulingService(db)
    await _authorize_shift_management(
        service, current_user, shift_id, "scheduling.manage"
    )
    shift, error = await service.reopen_shift(shift_id, current_user.organization_id)
    if not shift:
        raise HTTPException(
            status_code=400,
            detail=_safe_detail("Unable to reopen shift.", error),
        )
    await log_audit_event(
        db=db,
        event_type="shift_reopened",
        event_category="scheduling",
        severity="WARNING",
        event_data={
            "organization_id": str(current_user.organization_id),
            "shift_id": str(shift_id),
            "reason": (body.reason or "").strip() or None,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    enriched = await _enrich_shifts(service, current_user.organization_id, [shift])
    return enriched[0]


@router.get("/shifts/{shift_id}/handoff")
async def get_shift_handoff(
    shift_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the previous crew's pass-down for this shift (same apparatus),
    or null when there is none. Access is limited to the incoming roster, its
    officer, and organization-wide scheduling managers."""
    service = SchedulingService(db)
    await _authorize_handoff_access(service, current_user, shift_id)
    return await service.get_previous_pass_down(shift_id, current_user.organization_id)


@router.post("/shifts/{shift_id}/cancel", response_model=ShiftResponse)
async def cancel_shift(
    shift_id: UUID,
    body: ShiftCancelRequest = ShiftCancelRequest(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Cancel a shift without deleting it.

    Preserves the shift record and its history, marks all active assignments
    cancelled, and notifies the assigned crew. A finalized shift cannot be
    cancelled.

    **Permissions required:** scheduling.manage, or being the shift's officer.
    """
    service = SchedulingService(db)
    await _authorize_shift_management(
        service, current_user, shift_id, "scheduling.manage"
    )
    shift, error = await service.cancel_shift(
        shift_id,
        current_user.organization_id,
        cancelled_by_user_id=str(current_user.id),
        reason=(body.reason or None) if body else None,
    )
    if not shift:
        raise HTTPException(
            status_code=400,
            detail=_safe_detail("Unable to cancel shift.", error),
        )
    enriched = await _enrich_shifts(service, current_user.organization_id, [shift])
    return enriched[0]


@router.post("/shifts/{shift_id}/late-signup", response_model=ShiftResponse)
async def open_late_signup(
    shift_id: UUID,
    body: LateSignupOpenRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Reopen signup on this shift for a bounded number of minutes from now.

    Signup normally closes when the shift starts. This is the escape hatch for
    the crew that turns up one short: it reopens the shift for members *and*
    officers alike, because "allow last-minute additions" means letting people
    put themselves on, not only letting the officer type their names in.

    A duration rather than an instant on purpose — the server resolves it
    against the same clock the enforcement reads, so a device running a few
    minutes fast cannot open a window shorter than the officer intended.

    Not offered to ``scheduling.manage``, who are never bound by the window and
    so have nothing to reopen.

    **Permissions required:** scheduling.assign, or being the shift's officer.
    """
    service = SchedulingService(db)
    await _authorize_shift_management(
        service, current_user, shift_id, "scheduling.assign"
    )
    shift, error = await service.open_late_signup(
        shift_id, current_user.organization_id, minutes=body.minutes
    )
    if not shift:
        raise HTTPException(
            status_code=400,
            detail=_safe_detail("Unable to reopen signup.", error),
        )
    await log_audit_event(
        db=db,
        event_type="shift_late_signup_opened",
        event_category="scheduling",
        severity="INFO",
        event_data={
            "organization_id": str(current_user.organization_id),
            "shift_id": str(shift_id),
            "minutes": body.minutes,
            "late_signup_until": (
                shift.late_signup_until.isoformat() if shift.late_signup_until else None
            ),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    enriched = await _enrich_shifts(service, current_user.organization_id, [shift])
    return enriched[0]


@router.delete("/shifts/{shift_id}/late-signup", response_model=ShiftResponse)
async def close_late_signup(
    shift_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Withdraw this shift's late-signup window, returning it to the org rule.

    **Permissions required:** scheduling.assign, or being the shift's officer.
    """
    service = SchedulingService(db)
    await _authorize_shift_management(
        service, current_user, shift_id, "scheduling.assign"
    )
    shift, error = await service.close_late_signup(
        shift_id, current_user.organization_id
    )
    if not shift:
        raise HTTPException(
            status_code=400,
            detail=_safe_detail("Unable to close late signup.", error),
        )
    await log_audit_event(
        db=db,
        event_type="shift_late_signup_closed",
        event_category="scheduling",
        severity="INFO",
        event_data={
            "organization_id": str(current_user.organization_id),
            "shift_id": str(shift_id),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    enriched = await _enrich_shifts(service, current_user.organization_id, [shift])
    return enriched[0]


# ============================================
# Attendance Endpoints
# ============================================


@router.post(
    "/shifts/{shift_id}/attendance",
    response_model=ShiftAttendanceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_attendance(
    shift_id: UUID,
    attendance: ShiftAttendanceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Add an attendance record to a shift.

    **Permissions required:** scheduling.manage, or being the shift's officer.
    """
    service = SchedulingService(db)
    await _authorize_shift_management(
        service, current_user, shift_id, "scheduling.manage"
    )
    result, error = await service.add_attendance(
        shift_id, current_user.organization_id, attendance.model_dump(exclude_none=True)
    )
    if error:
        raise HTTPException(
            status_code=400, detail=_safe_detail("Unable to add attendance.", error)
        )
    enriched = await service.enrich_attendance_records([result])
    return enriched[0]


@router.get(
    "/shifts/{shift_id}/attendance", response_model=list[ShiftAttendanceResponse]
)
async def get_attendance(
    shift_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """Get all attendance records for a shift"""
    service = SchedulingService(db)
    attendance = await service.get_shift_attendance(
        shift_id, current_user.organization_id
    )
    return await service.enrich_attendance_records(attendance)


@router.patch("/attendance/{attendance_id}", response_model=ShiftAttendanceResponse)
async def update_attendance(
    attendance_id: UUID,
    attendance: ShiftAttendanceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Update an attendance record"""
    service = SchedulingService(db)
    result, error = await service.update_attendance(
        attendance_id,
        current_user.organization_id,
        attendance.model_dump(exclude_unset=True),
    )
    if error:
        raise HTTPException(
            status_code=400, detail=_safe_detail("Unable to update attendance.", error)
        )
    enriched = await service.enrich_attendance_records([result])
    return enriched[0]


@router.delete("/attendance/{attendance_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_attendance(
    attendance_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Remove an attendance record"""
    service = SchedulingService(db)
    success, error = await service.remove_attendance(
        attendance_id, current_user.organization_id
    )
    if not success:
        raise HTTPException(
            status_code=400, detail=_safe_detail("Unable to remove attendance.", error)
        )


# ============================================
# Member Self-Service Check-In / Check-Out
# ============================================


@router.post(
    "/shifts/{shift_id}/check-in",
    response_model=ShiftAttendanceResponse,
)
async def member_check_in(
    shift_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Member self-service check-in for a shift."""
    service = SchedulingService(db)
    result, error = await service.member_check_in(
        shift_id=str(shift_id),
        user_id=str(current_user.id),
        organization_id=current_user.organization_id,
    )
    if not result:
        raise HTTPException(
            status_code=400,
            detail=error or "Unable to check in",
        )
    enriched = await service.enrich_attendance_records([result])
    return enriched[0]


@router.post(
    "/shifts/{shift_id}/check-out",
    response_model=ShiftAttendanceResponse,
)
async def member_check_out(
    shift_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Member self-service check-out for a shift."""
    service = SchedulingService(db)
    result, error = await service.member_check_out(
        shift_id=str(shift_id),
        user_id=str(current_user.id),
        organization_id=current_user.organization_id,
    )
    if not result:
        raise HTTPException(
            status_code=400,
            detail=error or "Unable to check out",
        )
    enriched = await service.enrich_attendance_records([result])
    return enriched[0]


@router.get("/apparatus/{apparatus_id}/active-shift")
async def get_active_shift_for_apparatus(
    apparatus_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Find the active or next upcoming shift for an apparatus."""
    service = SchedulingService(db)
    shift = await service.get_active_shift_for_apparatus(
        apparatus_id=apparatus_id,
        organization_id=current_user.organization_id,
    )
    if not shift:
        raise HTTPException(
            status_code=404,
            detail="No active shift found for this apparatus",
        )
    shift_dict = {c.name: getattr(shift, c.name) for c in shift.__table__.columns}
    apparatus_ids = [shift.apparatus_id] if shift.apparatus_id else []
    apparatus_map = await service._get_apparatus_map(
        current_user.organization_id, apparatus_ids
    )
    service._enrich_shift_dict(shift_dict, apparatus_map)
    return shift_dict


@router.get("/my-attendance-history")
async def get_my_attendance_history(
    limit: int = Query(50, ge=1, le=200),
    start_date: str | None = None,
    end_date: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the current member's attendance history.

    Optional ``start_date`` / ``end_date`` (YYYY-MM-DD) bound the lookup by
    shift date so callers can paginate further back than ``limit`` records.
    """
    from app.models.training import Shift, ShiftAttendance

    try:
        start = date.fromisoformat(start_date) if start_date else None
        end = date.fromisoformat(end_date) if end_date else None
    except ValueError:
        raise HTTPException(
            status_code=400, detail="Invalid date format. Use YYYY-MM-DD."
        )

    query = (
        select(ShiftAttendance, Shift)
        .join(Shift, ShiftAttendance.shift_id == Shift.id)
        .where(
            ShiftAttendance.user_id == str(current_user.id),
            Shift.organization_id == str(current_user.organization_id),
        )
    )
    if start:
        query = query.where(Shift.shift_date >= start)
    if end:
        query = query.where(Shift.shift_date <= end)
    query = query.order_by(Shift.shift_date.desc()).limit(limit)

    result = await db.execute(query)
    rows = result.all()
    records = [r[0] for r in rows]
    shift_by_attendance = {r[0].id: r[1] for r in rows}
    service = SchedulingService(db)
    enriched = await service.enrich_attendance_records(records)
    for entry in enriched:
        shift = shift_by_attendance.get(entry["id"])
        if shift is not None:
            entry["shift_date"] = str(shift.shift_date) if shift.shift_date else None
            entry["shift_start_time"] = (
                shift.start_time.isoformat() if shift.start_time else None
            )
            entry["shift_end_time"] = (
                shift.end_time.isoformat() if shift.end_time else None
            )
    return enriched


@router.get(
    "/shifts/{shift_id}/my-attendance",
    response_model=ShiftAttendanceResponse,
)
async def get_my_attendance(
    shift_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the current member's attendance for a shift."""
    service = SchedulingService(db)
    result = await service.get_my_attendance(
        shift_id=str(shift_id),
        user_id=str(current_user.id),
        organization_id=current_user.organization_id,
    )
    if not result:
        raise HTTPException(
            status_code=404,
            detail="No attendance record found",
        )
    enriched = await service.enrich_attendance_records([result])
    return enriched[0]


# ============================================
# Calendar View Endpoints
# ============================================


@router.get("/calendar/week", response_model=list[ShiftResponse])
async def get_week_calendar(
    week_start: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """Get shifts for a specific week"""
    service = SchedulingService(db)
    try:
        start = (
            date.fromisoformat(week_start)
            if week_start
            else (date.today() - timedelta(days=date.today().weekday()))
        )
    except ValueError:
        raise HTTPException(
            status_code=400, detail="Invalid date format. Use YYYY-MM-DD."
        )
    shifts = await service.get_week_shifts(current_user.organization_id, start)
    shifts = await _member_visible_shifts(service, current_user, shifts)
    return await _enrich_shifts(service, current_user.organization_id, shifts)


@router.get("/calendar/month", response_model=list[ShiftResponse])
async def get_month_calendar(
    year: int | None = None,
    month: int | None = Query(None, ge=1, le=12),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """Get shifts for a specific month"""
    service = SchedulingService(db)
    today = date.today()
    y = year or today.year
    m = month or today.month
    shifts = await service.get_month_shifts(current_user.organization_id, y, m)
    shifts = await _member_visible_shifts(service, current_user, shifts)
    return await _enrich_shifts(service, current_user.organization_id, shifts)


# ============================================
# Summary Endpoint
# ============================================


@router.get("/summary", response_model=SchedulingSummary)
async def get_scheduling_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """Get scheduling module summary statistics"""
    service = SchedulingService(db)
    return await service.get_summary(current_user.organization_id)


WIDGET_KEYS = {
    "today_staffing",
    "future_coverage_gaps",
    "open_slots",
    "pending_staffing_changes",
    "incomplete_closeouts",
    "workload_balance",
    "special_operations",
}


async def _available_widget_filters(db: AsyncSession, organization_id):
    stations = set(
        (
            await db.execute(
                select(Shift.station_id)
                .where(
                    Shift.organization_id == organization_id,
                    Shift.station_id.is_not(None),
                )
                .distinct()
            )
        )
        .scalars()
        .all()
    )
    platoons = set(
        (
            await db.execute(
                select(Shift.platoon)
                .where(
                    Shift.organization_id == organization_id,
                    Shift.platoon.is_not(None),
                )
                .distinct()
            )
        )
        .scalars()
        .all()
    )
    return stations, platoons


# Department-wide staffing reporting: coverage gaps, incomplete closeouts and
# workload balance across every member, plus per-user filter defaults for them.
# `scheduling.view` is a baseline member grant (it is what lets a firefighter
# read their own schedule), so these three endpoints require scheduling.manage
# instead — the dashboard block they feed is leadership reporting, not a
# member's own shifts.
@router.get("/dashboard/widgets", response_model=SchedulingWidgetSummary)
async def get_scheduling_widget_summary(
    start_date: date,
    end_date: date,
    station_id: str | None = Query(None, max_length=100),
    platoon: str | None = Query(None, max_length=20),
    shift_type: str | None = Query(None, max_length=50),
    position: str | None = Query(None, max_length=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Return purpose-built staffing totals for one bounded, scoped window."""
    if end_date < start_date or (end_date - start_date).days >= MAX_WIDGET_WINDOW_DAYS:
        raise HTTPException(status_code=422, detail="Date window must be 1 to 93 days")
    stations, platoons = await _available_widget_filters(
        db, current_user.organization_id
    )
    if station_id and station_id not in stations:
        raise HTTPException(status_code=422, detail="Station is not available")
    if platoon and platoon not in platoons:
        raise HTTPException(status_code=422, detail="Platoon is not available")
    return await SchedulingWidgetService(db).summarize(
        str(current_user.organization_id),
        start_date,
        end_date,
        station_id,
        platoon,
        shift_type,
        position,
    )


@router.get("/dashboard/widget-preferences", response_model=SchedulingWidgetPreferences)
async def get_scheduling_widget_preferences(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Return saved defaults, dropping resources that are no longer accessible."""
    stations, platoons = await _available_widget_filters(
        db, current_user.organization_id
    )
    raw = (current_user.notification_preferences or {}).get(
        "scheduling_dashboard_widgets", {}
    )
    clean = {}
    for key, value in raw.items():
        if key not in WIDGET_KEYS or not isinstance(value, dict):
            continue
        item = dict(value)
        if item.get("station_id") not in stations:
            item.pop("station_id", None)
        if item.get("platoon") not in platoons:
            item.pop("platoon", None)
        clean[key] = item
    return {"widgets": clean}


@router.put("/dashboard/widget-preferences", response_model=SchedulingWidgetPreferences)
async def save_scheduling_widget_preferences(
    payload: SchedulingWidgetPreferences,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Save only filters that still resolve inside the caller's organization."""
    unknown = set(payload.widgets) - WIDGET_KEYS
    if unknown:
        raise HTTPException(status_code=422, detail="Unknown scheduling widget")
    stations, platoons = await _available_widget_filters(
        db, current_user.organization_id
    )
    for value in payload.widgets.values():
        if value.station_id and value.station_id not in stations:
            raise HTTPException(status_code=422, detail="Station is not available")
        if value.platoon and value.platoon not in platoons:
            raise HTTPException(status_code=422, detail="Platoon is not available")
    preferences = copy.deepcopy(current_user.notification_preferences or {})
    preferences["scheduling_dashboard_widgets"] = {
        key: value.model_dump(exclude_none=True)
        for key, value in payload.widgets.items()
    }
    current_user.notification_preferences = preferences
    await db.commit()
    return payload


# ============================================
# Shift Call Endpoints
# ============================================


@router.post(
    "/shifts/{shift_id}/calls",
    response_model=ShiftCallResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_call(
    shift_id: UUID,
    call: ShiftCallCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a call record for a shift.

    **Permissions required:** scheduling.manage, or being the shift's officer.
    """
    service = SchedulingService(db)
    await _authorize_shift_management(
        service, current_user, shift_id, "scheduling.manage"
    )
    call_data = call.model_dump(exclude_none=True)
    call_data.pop("shift_id", None)
    result, error = await service.create_shift_call(
        current_user.organization_id, shift_id, call_data
    )
    if error:
        raise HTTPException(
            status_code=400, detail=_safe_detail("Unable to create call.", error)
        )
    return result


@router.get("/shifts/{shift_id}/calls", response_model=list[ShiftCallResponse])
async def list_shift_calls(
    shift_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """List all calls for a shift"""
    service = SchedulingService(db)
    calls = await service.get_shift_calls(shift_id, current_user.organization_id)
    return calls


@router.get("/calls/{call_id}", response_model=ShiftCallResponse)
async def get_call(
    call_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """Get a specific call by ID"""
    service = SchedulingService(db)
    call = ensure_found(
        await service.get_shift_call_by_id(call_id, current_user.organization_id),
        "Call",
    )
    return call


@router.patch("/calls/{call_id}", response_model=ShiftCallResponse)
async def update_call(
    call_id: UUID,
    call: ShiftCallUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Update a call record"""
    service = SchedulingService(db)
    update_data = call.model_dump(exclude_unset=True)
    result, error = await service.update_shift_call(
        call_id, current_user.organization_id, update_data
    )
    if error:
        raise HTTPException(
            status_code=400, detail=_safe_detail("Unable to update call.", error)
        )
    return result


@router.delete("/calls/{call_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_call(
    call_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Delete a call record"""
    service = SchedulingService(db)
    success, error = await service.delete_shift_call(
        call_id, current_user.organization_id
    )
    if not success:
        raise HTTPException(
            status_code=400, detail=_safe_detail("Unable to delete call.", error)
        )


# ============================================
# Shift Template Endpoints
# ============================================


@router.get("/templates", response_model=list[ShiftTemplateResponse])
async def list_templates(
    active_only: bool = Query(True),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """List shift templates"""
    service = SchedulingService(db)
    templates = await service.get_templates(
        current_user.organization_id, active_only=active_only
    )
    return templates


@router.post(
    "/templates",
    response_model=ShiftTemplateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_template(
    template: ShiftTemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Create a shift template"""
    service = SchedulingService(db)
    template_data = template.model_dump(exclude_none=True)
    result, error = await service.create_template(
        current_user.organization_id, template_data, current_user.id
    )
    if error:
        raise HTTPException(
            status_code=400, detail=_safe_detail("Unable to create template.", error)
        )
    return result


@router.get("/templates/{template_id}", response_model=ShiftTemplateResponse)
async def get_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """Get a shift template by ID"""
    service = SchedulingService(db)
    template = ensure_found(
        await service.get_template_by_id(template_id, current_user.organization_id),
        "Template",
    )
    return template


@router.patch("/templates/{template_id}", response_model=ShiftTemplateResponse)
async def update_template(
    template_id: UUID,
    template: ShiftTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Update a shift template"""
    service = SchedulingService(db)
    update_data = template.model_dump(exclude_unset=True)
    result, error = await service.update_template(
        template_id, current_user.organization_id, update_data
    )
    if error:
        raise HTTPException(
            status_code=400, detail=_safe_detail("Unable to update template.", error)
        )
    return result


@router.delete("/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Delete a shift template"""
    service = SchedulingService(db)
    success, error = await service.delete_template(
        template_id, current_user.organization_id
    )
    if not success:
        raise HTTPException(
            status_code=400, detail=_safe_detail("Unable to delete template.", error)
        )


# ============================================
# Shift Pattern Endpoints
# ============================================


@router.get("/patterns", response_model=list[ShiftPatternResponse])
async def list_patterns(
    active_only: bool = Query(True),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """List shift patterns"""
    service = SchedulingService(db)
    patterns = await service.get_patterns(
        current_user.organization_id, active_only=active_only
    )
    return patterns


@router.post(
    "/patterns",
    response_model=ShiftPatternResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_pattern(
    pattern: ShiftPatternCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Create a shift pattern"""
    service = SchedulingService(db)
    pattern_data = pattern.model_dump(exclude_none=True)
    result, error = await service.create_pattern(
        current_user.organization_id, pattern_data, current_user.id
    )
    if error:
        raise HTTPException(
            status_code=400, detail=_safe_detail("Unable to create pattern.", error)
        )
    return result


@router.get("/patterns/{pattern_id}", response_model=ShiftPatternResponse)
async def get_pattern(
    pattern_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """Get a shift pattern by ID"""
    service = SchedulingService(db)
    pattern = ensure_found(
        await service.get_pattern_by_id(pattern_id, current_user.organization_id),
        "Pattern",
    )
    return pattern


@router.patch("/patterns/{pattern_id}", response_model=ShiftPatternResponse)
async def update_pattern(
    pattern_id: UUID,
    pattern: ShiftPatternUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Update a shift pattern"""
    service = SchedulingService(db)
    update_data = pattern.model_dump(exclude_unset=True)
    result, error = await service.update_pattern(
        pattern_id, current_user.organization_id, update_data
    )
    if error:
        raise HTTPException(
            status_code=400, detail=_safe_detail("Unable to update pattern.", error)
        )
    return result


@router.delete("/patterns/{pattern_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pattern(
    pattern_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Delete a shift pattern"""
    service = SchedulingService(db)
    success, error = await service.delete_pattern(
        pattern_id, current_user.organization_id
    )
    if not success:
        raise HTTPException(
            status_code=400, detail=_safe_detail("Unable to delete pattern.", error)
        )


@router.post("/patterns/{pattern_id}/generate")
async def generate_shifts_from_pattern(
    pattern_id: UUID,
    request: GenerateShiftsRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Generate shifts from a pattern for a date range"""
    if request.end_date < request.start_date:
        raise HTTPException(
            status_code=400, detail="End date must be on or after start date."
        )
    if (request.end_date - request.start_date).days > MAX_GENERATION_DAYS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Date range too large — generate at most "
                f"{MAX_GENERATION_DAYS} days at a time."
            ),
        )
    service = SchedulingService(db)
    result, error = await service.generate_shifts_from_pattern(
        pattern_id,
        current_user.organization_id,
        request.start_date,
        request.end_date,
        current_user.id,
    )
    if error:
        raise HTTPException(
            status_code=400, detail=_safe_detail("Unable to generate shifts.", error)
        )
    # Bulk create → one summary notification, not one per generated shift.
    if result:
        background_tasks.add_task(
            notify_summary,
            str(current_user.organization_id),
            "🚒 Shifts published",
            f"{len(result)} shift(s) were published to the schedule.",
        )
    enriched = await _enrich_shifts(service, current_user.organization_id, result)
    response: dict = {"shifts_created": len(result), "shifts": enriched}

    # Driver seats the pattern could not fill because the member lacks the
    # apparatus's EVOC level. Reported rather than silently dropped — an
    # unfilled driver seat the officer does not know about is worse than the
    # unqualified assignment enforcement just prevented.
    if service.last_generation_warnings:
        response["driver_warnings"] = service.last_generation_warnings
    return response


# ============================================
# Shift Assignment Endpoints
# ============================================


@router.get(
    "/shifts/{shift_id}/assignments", response_model=list[ShiftAssignmentResponse]
)
async def list_shift_assignments(
    shift_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """List all assignments for a shift"""
    service = SchedulingService(db)
    assignments = await service.get_shift_assignments(
        shift_id, current_user.organization_id
    )
    return await service.enrich_assignments(assignments)


@router.get(
    "/shifts/{shift_id}/trade-candidates",
    response_model=list[TradeCandidateResponse],
)
async def list_trade_candidates(
    shift_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Members the caller could offer their seat on this shift to.

    Member self-service, like signup: you can only offer a seat you hold, so
    the caller's own assignment is what scopes the query. Holding no seat is a
    409 rather than an empty list — an empty list would read as "nobody can
    cover this", which is a different and much more alarming answer.
    """
    service = SchedulingService(db)
    shift = await service.get_shift_by_id(shift_id, current_user.organization_id)
    ensure_found(shift, "Shift")

    assignments = await service.get_shift_assignments(
        shift_id, current_user.organization_id
    )
    mine = next(
        (
            a
            for a in assignments
            if str(a.user_id) == str(current_user.id)
            and _enum_value(a.assignment_status)
            in (AssignmentStatus.ASSIGNED.value, AssignmentStatus.CONFIRMED.value)
        ),
        None,
    )
    if not mine:
        raise HTTPException(
            status_code=409,
            detail="You are not on this shift, so there is no seat to offer.",
        )

    return await service.get_trade_candidates(
        current_user.organization_id,
        shift_id,
        current_user.id,
        _enum_value(mine.position) or ShiftPosition.FIREFIGHTER.value,
    )


@router.get("/shifts/{shift_id}/unavailable-members")
async def get_unavailable_members(
    shift_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.assign")),
):
    """Return user IDs that cannot be assigned to a shift (on leave, time-off, or already assigned)."""
    service = SchedulingService(db)
    user_ids = await service.get_unavailable_user_ids(
        current_user.organization_id, shift_id
    )
    return {"unavailable_user_ids": user_ids}


def _driver_block(exc: CodedValueError) -> CodedHTTPException:
    """Turn the driver qualification refusal into a 400 that keeps its code.

    The message names what is missing and how to resolve it; the code
    (``LB-SCHED-001``) is what the UI keys its "request an exception" offer
    off, so it must survive the trip rather than being flattened into an
    anonymous 400.
    """
    return CodedHTTPException(
        status_code=400,
        detail=str(exc),
        error_code=exc.error_code,
    )


@router.post(
    "/shifts/{shift_id}/assignments",
    response_model=ShiftAssignmentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_assignment(
    shift_id: UUID,
    assignment: ShiftAssignmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a shift assignment.

    When assigning a driver position, EVOC eligibility is checked and
    any warnings are returned in the ``evoc_warnings`` field. These are
    soft warnings — they do not block the assignment.

    **Permissions required:** scheduling.assign, or being the shift's officer.
    """
    service = SchedulingService(db)
    shift = await _authorize_shift_management(
        service, current_user, shift_id, "scheduling.assign"
    )
    assignment_data = assignment.model_dump(exclude_none=True)

    # An officer seating somebody on an outreach sheet chooses the same roles
    # the member would have. Validated the same way, so a hand-made assignment
    # cannot overfill a role that self-signup would have refused.
    if shift is not None and shift.is_outreach:
        try:
            role = await resolve_outreach_signup_role(
                db,
                shift,
                assignment_data.get("outreach_role"),
                current_user.organization_id,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=safe_error_detail(e))
        if role:
            assignment_data["outreach_role"] = role
            assignment_data["position"] = OUTREACH_SEAT_POSITION
    else:
        assignment_data.pop("outreach_role", None)

    try:
        result, error = await service.create_assignment(
            current_user.organization_id,
            shift_id,
            assignment_data,
            current_user.id,
            actor=_signup_actor(shift, current_user),
        )
    except CodedValueError as e:
        raise _driver_block(e)
    if error:
        raise HTTPException(
            status_code=400, detail=_safe_detail("Unable to create assignment.", error)
        )
    enriched = await service.enrich_assignments([result])
    response = enriched[0]

    # Soft, non-blocking advisories (EVOC driver eligibility, overtime).
    response = await _attach_assignment_warnings(
        db,
        service,
        response,
        shift_id,
        current_user.organization_id,
        str(assignment_data.get("user_id", "")),
        assignment_data.get("position", ""),
    )

    return response


@router.patch("/assignments/{assignment_id}", response_model=ShiftAssignmentResponse)
async def update_assignment(
    assignment_id: UUID,
    assignment: ShiftAssignmentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a shift assignment.

    **Permissions required:** scheduling.assign, or being the shift's officer.
    """
    service = SchedulingService(db)
    await _authorize_assignment_management(service, current_user, assignment_id)
    update_data = assignment.model_dump(exclude_unset=True)
    try:
        result, error = await service.update_assignment(
            assignment_id, current_user.organization_id, update_data
        )
    except CodedValueError as e:
        raise _driver_block(e)
    if error:
        raise HTTPException(
            status_code=400, detail=_safe_detail("Unable to update assignment.", error)
        )
    enriched = await service.enrich_assignments([result])
    response = enriched[0]

    # An edit that moves someone into the driver seat under an approved
    # exception carries that exception's operating restrictions. The crew-board
    # position editor uses this endpoint, and an officer who never sees them is
    # relying on a control that did not reach them.
    if service.last_assignment_warnings:
        response["evoc_warnings"] = service.last_assignment_warnings
    return response


@router.delete("/assignments/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_assignment(
    assignment_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a shift assignment.

    **Permissions required:** scheduling.assign, or being the shift's officer.
    """
    service = SchedulingService(db)
    await _authorize_assignment_management(service, current_user, assignment_id)
    success, error = await service.delete_assignment(
        assignment_id, current_user.organization_id
    )
    if not success:
        raise HTTPException(
            status_code=400, detail=_safe_detail("Unable to delete assignment.", error)
        )


@router.post(
    "/assignments/{assignment_id}/confirm", response_model=ShiftAssignmentResponse
)
async def confirm_assignment(
    assignment_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Confirm own shift assignment"""
    service = SchedulingService(db)
    result, error = await service.confirm_assignment(
        assignment_id, current_user.id, current_user.organization_id
    )
    if error:
        raise HTTPException(
            status_code=400, detail=_safe_detail("Unable to confirm assignment.", error)
        )
    enriched = await service.enrich_assignments([result])
    return enriched[0]


# ============================================
# Shift Swap Request Endpoints
# ============================================


@router.get("/swap-requests", response_model=ShiftSwapRequestsPage)
async def list_swap_requests(
    status_filter: str | None = Query(None, alias="status"),
    mine: bool = False,
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.swap")),
):
    """List shift swap requests.

    ``mine`` narrows to swaps the caller is a participant in. A member already
    only sees their own; the flag matters for an officer, whose org-wide page
    can push their own pending offer past the page limit — the board asks the
    question "what is waiting on me", not "what is outstanding anywhere".
    """
    service = SchedulingService(db)
    swap_status = None
    if status_filter:
        try:
            swap_status = SwapRequestStatus(status_filter)
        except ValueError:
            raise HTTPException(
                status_code=400, detail=f"Invalid status: {status_filter}"
            )
    if user_has_permission(current_user, "scheduling.manage") and not mine:
        requests, total = await service.get_swap_requests(
            current_user.organization_id,
            status=swap_status,
            skip=pagination.skip,
            limit=pagination.limit,
        )
    else:
        requests, total = await service.get_swap_requests_for_user(
            current_user.organization_id,
            current_user.id,
            status=swap_status,
            skip=pagination.skip,
            limit=pagination.limit,
        )
    return {
        "items": await service.enrich_swap_requests(requests),
        "total": total,
        "skip": pagination.skip,
        "limit": pagination.limit,
    }


@router.post(
    "/swap-requests",
    response_model=ShiftSwapRequestResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_swap_request(
    swap_request: ShiftSwapRequestCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.swap")),
):
    """Create a shift swap request"""
    service = SchedulingService(db)
    request_data = swap_request.model_dump(exclude_none=True)
    result, error = await service.create_swap_request(
        current_user.organization_id, current_user.id, request_data
    )
    if error:
        raise HTTPException(
            status_code=400,
            detail=_safe_detail("Unable to create swap request.", error),
        )
    enriched = await service.enrich_swap_requests([result])
    return enriched[0]


@router.get("/swap-requests/{request_id}", response_model=ShiftSwapRequestResponse)
async def get_swap_request(
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.swap")),
):
    """Get a specific swap request"""
    service = SchedulingService(db)
    if user_has_permission(current_user, "scheduling.manage"):
        result = await service.get_swap_request_by_id(
            request_id, current_user.organization_id
        )
    else:
        result = await service.get_swap_request_for_user_by_id(
            request_id, current_user.organization_id, current_user.id
        )
    swap_request = ensure_found(result, "Swap request")
    enriched = await service.enrich_swap_requests([swap_request])
    return enriched[0]


@router.post(
    "/swap-requests/{request_id}/review", response_model=ShiftSwapRequestResponse
)
async def review_swap_request(
    request_id: UUID,
    review: ShiftSwapReview,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Review (approve/deny) a shift swap request"""
    service = SchedulingService(db)
    try:
        result, error = await service.review_swap_request(
            request_id,
            current_user.organization_id,
            current_user.id,
            review.status,
            review.reviewer_notes,
        )
    except CodedValueError as exc:
        raise _driver_block(exc)
    if error:
        raise HTTPException(
            status_code=400,
            detail=_safe_detail("Unable to review swap request.", error),
        )
    enriched = await service.enrich_swap_requests([result])
    return enriched[0]


@router.post(
    "/swap-requests/{request_id}/respond", response_model=ShiftSwapRequestResponse
)
async def respond_to_swap_offer(
    request_id: UUID,
    answer: ShiftSwapOfferResponseRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Accept or decline a seat a colleague offered you.

    Member self-service, and deliberately not the manager review above: that
    one refuses participants by design. Accepting a one-way offer grants no
    authority anybody lacked — it is the offerer withdrawing and the accepter
    signing up, in one step, both already unprivileged. Without it a targeted
    offer cannot complete at all: manager review reads a set target as "there
    must be a shift coming back" and rejects an offer that has none.
    """
    service = SchedulingService(db)
    result, error = await service.respond_to_swap_offer(
        request_id,
        current_user.organization_id,
        current_user.id,
        accept=answer.accept,
        note=answer.note,
    )
    if error or result is None:
        raise HTTPException(
            status_code=400,
            detail=_safe_detail("Unable to answer this offer.", error),
        )
    enriched = await service.enrich_swap_requests([result])
    return enriched[0]


@router.post(
    "/swap-requests/{request_id}/cancel", response_model=ShiftSwapRequestResponse
)
async def cancel_swap_request(
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.swap")),
):
    """Cancel own shift swap request"""
    service = SchedulingService(db)
    result, error = await service.cancel_swap_request(
        request_id, current_user.organization_id, current_user.id
    )
    if error:
        raise HTTPException(
            status_code=400,
            detail=_safe_detail("Unable to cancel swap request.", error),
        )
    enriched = await service.enrich_swap_requests([result])
    return enriched[0]


# ============================================
# Time-Off Endpoints
# ============================================


@router.get("/time-off", response_model=ShiftTimeOffRequestsPage)
async def list_time_off_requests(
    status_filter: str | None = Query(None, alias="status"),
    user_id: UUID | None = None,
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """List time-off requests"""
    service = SchedulingService(db)
    time_off_status = None
    if status_filter:
        try:
            time_off_status = TimeOffStatus(status_filter)
        except ValueError:
            raise HTTPException(
                status_code=400, detail=f"Invalid status: {status_filter}"
            )
    if user_has_permission(current_user, "scheduling.manage"):
        requests, total = await service.get_time_off_requests(
            current_user.organization_id,
            status=time_off_status,
            user_id=user_id,
            skip=pagination.skip,
            limit=pagination.limit,
        )
    else:
        # The authenticated identity, never a client-provided user_id, defines
        # the member scope.
        requests, total = await service.get_time_off_requests_for_user(
            current_user.organization_id,
            current_user.id,
            status=time_off_status,
            skip=pagination.skip,
            limit=pagination.limit,
        )
    return {
        "items": await service.enrich_time_off_requests(requests),
        "total": total,
        "skip": pagination.skip,
        "limit": pagination.limit,
    }


@router.post(
    "/time-off",
    response_model=ShiftTimeOffResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_time_off_request(
    time_off: ShiftTimeOffCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.swap")),
):
    """Create a time-off request"""
    service = SchedulingService(db)
    time_off_data = time_off.model_dump(exclude_none=True)
    result, error = await service.create_time_off(
        current_user.organization_id, current_user.id, time_off_data
    )
    if error:
        raise HTTPException(
            status_code=400,
            detail=_safe_detail("Unable to create time-off request.", error),
        )
    enriched = await service.enrich_time_off_requests([result])
    return enriched[0]


@router.get("/time-off/{time_off_id}", response_model=ShiftTimeOffResponse)
async def get_time_off_request(
    time_off_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.view")),
):
    """Get a specific time-off request"""
    service = SchedulingService(db)
    if user_has_permission(current_user, "scheduling.manage"):
        result = await service.get_time_off_by_id(
            time_off_id, current_user.organization_id
        )
    else:
        result = await service.get_time_off_for_user_by_id(
            time_off_id, current_user.organization_id, current_user.id
        )
    time_off = ensure_found(result, "Time-off request")
    enriched = await service.enrich_time_off_requests([time_off])
    return enriched[0]


@router.post("/time-off/{time_off_id}/review", response_model=ShiftTimeOffResponse)
async def review_time_off_request(
    time_off_id: UUID,
    review: ShiftTimeOffReview,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Review (approve/deny) a time-off request"""
    service = SchedulingService(db)
    result, error = await service.review_time_off(
        time_off_id,
        current_user.organization_id,
        current_user.id,
        review.status,
        review.reviewer_notes,
    )
    if error:
        raise HTTPException(
            status_code=400,
            detail=_safe_detail("Unable to review time-off request.", error),
        )
    enriched = await service.enrich_time_off_requests([result])
    return enriched[0]


@router.post("/time-off/{time_off_id}/cancel", response_model=ShiftTimeOffResponse)
async def cancel_time_off_request(
    time_off_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.swap")),
):
    """Cancel own time-off request"""
    service = SchedulingService(db)
    result, error = await service.cancel_time_off(
        time_off_id, current_user.organization_id, current_user.id
    )
    if error:
        raise HTTPException(
            status_code=400,
            detail=_safe_detail("Unable to cancel time-off request.", error),
        )
    enriched = await service.enrich_time_off_requests([result])
    return enriched[0]


@router.get("/availability")
async def get_member_availability(
    start_date: str = Query(...),
    end_date: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.assign")),
):
    """Get per-member availability summary for a date range"""
    service = SchedulingService(db)
    try:
        start = date.fromisoformat(start_date)
        end = date.fromisoformat(end_date)
    except ValueError:
        raise HTTPException(
            status_code=400, detail="Invalid date format. Use YYYY-MM-DD."
        )
    return await service.get_availability_summary(
        current_user.organization_id, start, end
    )


# ============================================
# Personal Shift Endpoints
# ============================================


@router.get("/my-shifts")
async def get_my_shifts(
    start_date: str | None = None,
    end_date: str | None = None,
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get current user's shifts"""
    service = SchedulingService(db)
    try:
        start = date.fromisoformat(start_date) if start_date else None
        end = date.fromisoformat(end_date) if end_date else None
    except ValueError:
        raise HTTPException(
            status_code=400, detail="Invalid date format. Use YYYY-MM-DD."
        )
    shift_dicts, total = await service.get_my_shifts(
        current_user.id,
        current_user.organization_id,
        start_date=start,
        end_date=end,
        skip=pagination.skip,
        limit=pagination.limit,
    )
    # get_my_shifts returns plain dicts (not ORM objects), so skip _enrich_shifts
    return {
        "shifts": shift_dicts,
        "total": total,
        "skip": pagination.skip,
        "limit": pagination.limit,
    }


@router.get("/my-assignments", response_model=list[ShiftAssignmentResponse])
async def get_my_assignments(
    start_date: str | None = None,
    end_date: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get current user's shift assignments with shift details"""
    service = SchedulingService(db)
    try:
        start = date.fromisoformat(start_date) if start_date else None
        end = date.fromisoformat(end_date) if end_date else None
    except ValueError:
        raise HTTPException(
            status_code=400, detail="Invalid date format. Use YYYY-MM-DD."
        )
    assignments = await service.get_user_assignments(
        current_user.id,
        current_user.organization_id,
        start_date=start,
        end_date=end,
    )
    return await service.enrich_assignments_with_shifts(
        assignments, current_user.organization_id
    )


@router.get("/my-hours-history", response_model=MemberHoursHistoryResponse)
async def get_my_hours_history(
    year: int | None = Query(None, ge=2000, le=2100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The caller's own shift hours and call credit, month by month.

    No permission dependency beyond authentication: this reports the
    caller's own attendance and nothing else, the same basis on which
    ``/my-attendance-history`` is exposed. ``scheduling.report`` gates the
    department-wide member-hours report, which names every member.

    Defaults to the current year in the department's timezone. The previous
    month is always reported, whichever year is being viewed.
    """
    service = SchedulingService(db)
    return await service.get_my_hours_history(
        current_user.id, current_user.organization_id, year
    )


# ============================================
# Report Endpoints
# ============================================

MAX_REPORT_DAYS = 366  # Maximum date range for report endpoints (1 year)


def _parse_and_validate_report_dates(start_date: str, end_date: str):
    """Parse and validate report date range. Raises HTTPException on failure."""
    try:
        start = date.fromisoformat(start_date)
        end = date.fromisoformat(end_date)
    except ValueError:
        raise HTTPException(
            status_code=400, detail="Invalid date format. Use YYYY-MM-DD."
        )
    if end < start:
        raise HTTPException(
            status_code=400, detail="end_date must not be before start_date."
        )
    if (end - start).days > MAX_REPORT_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"Date range must not exceed {MAX_REPORT_DAYS} days.",
        )
    return start, end


@router.get("/reports/member-hours")
async def get_member_hours_report(
    start_date: str = Query(...),
    end_date: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.report")),
):
    """Get member hours report for a date range"""
    start, end = _parse_and_validate_report_dates(start_date, end_date)
    service = SchedulingService(db)
    members = await service.get_member_hours_report(
        current_user.organization_id, start, end
    )
    return {
        "members": members,
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "total_members": len(members),
    }


@router.get("/reports/coverage")
async def get_coverage_report(
    start_date: str = Query(...),
    end_date: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.report")),
):
    """Get shift coverage report for a date range"""
    start, end = _parse_and_validate_report_dates(start_date, end_date)
    service = SchedulingService(db)
    report = await service.get_shift_coverage_report(
        current_user.organization_id, start, end
    )
    return report


@router.get("/reports/call-volume")
async def get_call_volume_report(
    start_date: str = Query(...),
    end_date: str = Query(...),
    group_by: str = Query("day", pattern="^(day|week|month)$"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.report")),
):
    """Get call volume report for a date range"""
    start, end = _parse_and_validate_report_dates(start_date, end_date)
    service = SchedulingService(db)
    report = await service.get_call_volume_report(
        current_user.organization_id, start, end, group_by=group_by
    )
    return report


@router.get("/reports/compliance", response_model=ShiftComplianceResponse)
async def get_shift_compliance_report(
    reference_date: str | None = Query(
        None,
        description="Reference date for compliance calculation (YYYY-MM-DD). Defaults to today.",
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.report")),
):
    """
    Get shift/hours compliance report.

    Checks all active training requirements of type SHIFTS or HOURS
    against actual shift attendance records. Returns per-member
    compliance status for each requirement, respecting role/position
    applicability filters.
    """
    service = SchedulingService(db)
    ref_date = None
    if reference_date:
        try:
            ref_date = date.fromisoformat(reference_date)
        except ValueError:
            raise HTTPException(
                status_code=400, detail="Invalid date format. Use YYYY-MM-DD."
            )

    compliance = await service.get_shift_compliance(
        current_user.organization_id, reference_date=ref_date
    )
    actual_ref = ref_date or date.today()
    return {
        "requirements": compliance,
        "reference_date": actual_ref.isoformat(),
        "total_requirements": len(compliance),
    }


# ============================================
# Shift Signup (Member Self-Service)
# ============================================


@router.post(
    "/shifts/{shift_id}/signup",
    response_model=ShiftAssignmentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def signup_for_shift(
    shift_id: UUID,
    signup: ShiftSignupRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Member signs up for an open position on a shift.
    Does not require scheduling.assign permission — any member can sign up.
    Enforces position eligibility based on rank, training, and membership type.

    On a community-outreach signup sheet the member picks an outreach *role*
    (tour guide, educator, facilitator) instead: nobody is riding a seat on an
    engine at a school visit, so the crew positions say nothing useful. The
    underlying seat stays a plain ``volunteer`` so capacity, coverage and the
    calendar read the sheet as the ordinary open shift it is.
    """
    service = SchedulingService(db)
    shift = await service.get_shift_by_id(shift_id, current_user.organization_id)
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")

    position_value = signup.position.value
    outreach_role = None
    if shift.is_outreach:
        try:
            outreach_role = await resolve_outreach_signup_role(
                db, shift, signup.outreach_role, current_user.organization_id
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=safe_error_detail(e))
        # The sheet's seats are all `volunteer`; whatever position the client
        # sent is not what the member is being asked to choose here.
        position_value = OUTREACH_SEAT_POSITION

    # Eligibility check (self-service only — admin assignments bypass this)
    eligibility = ShiftEligibilityService(db)
    eligible = await eligibility.get_eligible_positions(
        user=current_user,
        organization_id=current_user.organization_id,
        shift_id=str(shift_id),
    )
    if not eligible:
        # Name the two things an admin can actually change. The bare
        # "not eligible" this used to return sent members to a scheduling
        # admin who had no more information than they did.
        raise HTTPException(
            status_code=403,
            detail=(
                "You are not eligible to sign up for this shift. None of its "
                "positions are covered by your rank, qualifications, or your "
                "completed training. Ask a scheduling admin to review your "
                "qualifications and rank, or the positions on this shift."
            ),
        )
    if position_value not in eligible:
        raise HTTPException(
            status_code=403,
            detail=(
                f"You are not eligible for the '{position_value}' "
                f"position. Eligible positions: {', '.join(eligible)}."
            ),
        )

    assignment_data = {
        "user_id": str(current_user.id),
        "position": position_value,
    }
    if outreach_role:
        assignment_data["outreach_role"] = outreach_role
    try:
        result, error = await service.create_assignment(
            current_user.organization_id,
            shift_id,
            assignment_data,
            current_user.id,
            self_signup=True,
        )
    except CodedValueError as e:
        raise _driver_block(e)
    if error:
        raise HTTPException(
            status_code=400, detail=_safe_detail("Unable to sign up for shift.", error)
        )
    enriched = await service.enrich_assignments([result])
    response = enriched[0]
    # Same soft advisories a member would get if an officer assigned them.
    response = await _attach_assignment_warnings(
        db,
        service,
        response,
        shift_id,
        current_user.organization_id,
        str(current_user.id),
        signup.position.value,
    )
    return response


@router.delete("/shifts/{shift_id}/signup", status_code=status.HTTP_204_NO_CONTENT)
async def withdraw_from_shift(
    shift_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Member withdraws their signup from a shift.
    Finds and deletes the current user's assignment for the specified shift.
    """
    service = SchedulingService(db)
    assignments = await service.get_shift_assignments(
        shift_id, current_user.organization_id
    )
    user_assignment = next(
        (a for a in assignments if str(a.user_id) == str(current_user.id)), None
    )
    if not user_assignment:
        raise HTTPException(
            status_code=404, detail="You are not assigned to this shift."
        )
    success, error = await service.delete_assignment(
        UUID(user_assignment.id), current_user.organization_id
    )
    if not success:
        raise HTTPException(
            status_code=400, detail=_safe_detail("Unable to withdraw.", error)
        )


# ============================================
# Standing Shifts (recurring member self-signup)
# ============================================


async def _withdraw_member(
    db: AsyncSession,
    organization_id: UUID,
    shift_id: UUID,
    user_id: UUID,
) -> tuple[bool, str | None]:
    """Drop one member's seat on one shift, by ids.

    ``StandingShiftService.end_claim`` needs a way to release the dates a
    member has not worked yet, and the assignment id it would otherwise have
    to look up is exactly what this endpoint module already resolves.
    """
    service = SchedulingService(db)
    assignments = await service.get_shift_assignments(shift_id, organization_id)
    mine = next((a for a in assignments if str(a.user_id) == str(user_id)), None)
    if not mine:
        return False, "Not assigned"
    return await service.delete_assignment(UUID(mine.id), organization_id)


@router.get("/standing-shifts/preview", response_model=StandingShiftPreviewResponse)
async def preview_standing_shift(
    weekday: int = Query(..., ge=0, le=6),
    start_date: str = Query(...),
    end_date: str = Query(...),
    pattern: SchemaStandingShiftPattern = SchemaStandingShiftPattern.WEEKLY,
    period: SchemaStandingShiftPeriod = SchemaStandingShiftPeriod.DAY,
    apparatus_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The dates a standing claim would cover, with conflicts flagged.

    Read-only: the member sees the exact commitment, and the count on the
    save button, before anything is written.
    """
    try:
        start = date.fromisoformat(start_date)
        end = date.fromisoformat(end_date)
    except ValueError:
        raise HTTPException(
            status_code=400, detail="Invalid date format. Use YYYY-MM-DD."
        )
    if end < start:
        raise HTTPException(
            status_code=400, detail="The end date must be on or after the start date."
        )
    if (end - start).days > MAX_SERIES_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"A standing shift can run at most {MAX_SERIES_DAYS} days.",
        )

    return await StandingShiftService(db).preview(
        current_user.organization_id,
        current_user.id,
        StandingShiftPattern(pattern.value),
        weekday,
        StandingShiftPeriod(period.value),
        start,
        end,
        apparatus_id,
    )


@router.get(
    "/shifts/{shift_id}/standing-claim",
    response_model=StandingShiftResponse | None,
)
async def get_standing_claim_for_shift(
    shift_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The caller's standing series this shift belongs to, or null.

    The give-up flow asks before offering "also remove me from the rest of
    this standing series" — an always-present checkbox invites a member to end
    a series they never set up.
    """
    service = SchedulingService(db)
    shift = await service.get_shift_by_id(shift_id, current_user.organization_id)
    ensure_found(shift, "Shift")
    return await StandingShiftService(db).claim_covering_shift(
        current_user.organization_id, current_user.id, shift
    )


@router.get("/standing-shifts", response_model=list[StandingShiftResponse])
async def list_standing_shifts(
    active_only: bool = True,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The caller's own standing shift claims."""
    return await StandingShiftService(db).list_for_user(
        current_user.organization_id, current_user.id, active_only=active_only
    )


@router.post(
    "/standing-shifts",
    response_model=StandingShiftCreateResult,
    status_code=status.HTTP_201_CREATED,
)
async def create_standing_shift(
    payload: StandingShiftCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Claim a recurring shift, and take the matching dates already on record.

    Seating goes through the ordinary signup path, so eligibility, capacity
    and driver qualification apply to every date exactly as they would to a
    single tap on the calendar. Dates it refuses are reported as skipped
    rather than failing the series.
    """
    service = SchedulingService(db)
    claim, summary, error = await StandingShiftService(db).create(
        current_user.organization_id,
        current_user.id,
        pattern=StandingShiftPattern(payload.pattern.value),
        weekday=payload.weekday,
        period=StandingShiftPeriod(payload.period.value),
        position=payload.position.value,
        start_date=payload.start_date,
        end_date=payload.end_date,
        apparatus_id=payload.apparatus_id,
        assign=service.seat_member_self_service,
    )
    if error or claim is None:
        raise HTTPException(
            status_code=400,
            detail=_safe_detail("Unable to create the standing shift.", error),
        )
    await log_audit_event(
        db,
        user_id=str(current_user.id),
        organization_id=str(current_user.organization_id),
        action="standing_shift.create",
        resource_type="standing_shift_claim",
        resource_id=str(claim.id),
        details={"claimed": summary.get("claimed", 0)},
    )
    return {"claim": claim, **summary}


@router.delete("/standing-shifts/{claim_id}", response_model=dict)
async def end_standing_shift(
    claim_id: UUID,
    release_future: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """End a standing series, optionally giving up its future dates.

    Ending the series and giving up the dates already on the roster are
    separate decisions, so ``release_future`` defaults to off — quietly
    emptying seats a duty officer has already counted on is how a shift goes
    short with nobody notified.
    """
    standing = StandingShiftService(db)
    claim = await standing.get_claim(claim_id, current_user.organization_id)
    ensure_found(claim, "Standing shift")
    # A claim is the member's own commitment; an officer changing someone
    # else's belongs on the roster, not here.
    if str(claim.user_id) != str(current_user.id):
        raise HTTPException(
            status_code=403, detail="You can only end your own standing shifts."
        )

    async def _withdraw(org_id: UUID, shift_id: UUID, user_id: UUID):
        return await _withdraw_member(db, org_id, shift_id, user_id)

    result = await standing.end_claim(
        claim, release_future=release_future, withdraw=_withdraw
    )
    await log_audit_event(
        db,
        user_id=str(current_user.id),
        organization_id=str(current_user.organization_id),
        action="standing_shift.end",
        resource_type="standing_shift_claim",
        resource_id=str(claim.id),
        details=result,
    )
    return result


# ============================================
# Apparatus Options (Unified vehicle picker)
# ============================================


# DEFAULT_APPARATUS_TYPES was removed on 2026-08-26. It was a second copy of
# the eleven strings in DEFAULT_APPARATUS_TYPE_DEFAULTS, and the vehicle
# picker's fallback below is its only consumer — so making one agency-aware and
# not the other would have left a new EMS department offered Engine and Ladder
# as its entire picker. The fallback now reads the staffing templates directly.


@router.get("/apparatus-options", response_model=ApparatusOptionsResponse)
async def list_apparatus_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return available vehicles for shift template assignment.

    Priority: full Apparatus module records > BasicApparatus records > hardcoded defaults.
    """
    from app.schemas.scheduling import ApparatusOption

    org_id = str(current_user.organization_id)
    options: list[ApparatusOption] = []
    source = "default"

    # 1. Try the full Apparatus module
    try:
        from app.models.apparatus import Apparatus as FullApparatus
        from app.models.apparatus import ApparatusType

        result = await db.execute(
            select(FullApparatus, ApparatusType.name.label("type_name"))
            .join(
                ApparatusType,
                FullApparatus.apparatus_type_id == ApparatusType.id,
                isouter=True,
            )
            .where(FullApparatus.organization_id == org_id)
            .where(FullApparatus.is_archived.is_(False))
            .order_by(FullApparatus.unit_number)
        )
        rows = result.all()
        if rows:
            for row in rows:
                apparatus = row[0]
                type_name = row[1] or "other"
                options.append(
                    ApparatusOption(
                        id=apparatus.id,
                        name=apparatus.name or apparatus.unit_number,
                        unit_number=apparatus.unit_number,
                        apparatus_type=type_name.lower(),
                        source="apparatus",
                        positions=normalize_stored_positions(apparatus.crew_positions),
                        min_staffing=apparatus.min_staffing,
                    )
                )
            source = "apparatus"
    except Exception as exc:
        # The full Apparatus module may not be installed for this org; fall
        # through to BasicApparatus. Log so a genuine query failure (vs. the
        # module simply being absent) is still diagnosable.
        logger.debug(f"Apparatus module lookup failed, using fallback: {exc}")

    # 2. Fall back to BasicApparatus if no full module records
    if not options:
        result = await db.execute(
            select(BasicApparatus)
            .where(BasicApparatus.organization_id == org_id)
            .where(BasicApparatus.is_active.is_(True))
            .order_by(BasicApparatus.unit_number)
        )
        basic_rows = result.scalars().all()
        if basic_rows:
            for ba in basic_rows:
                options.append(
                    ApparatusOption(
                        id=ba.id,
                        name=ba.name,
                        unit_number=ba.unit_number,
                        apparatus_type=ba.apparatus_type or "other",
                        source="basic",
                        positions=normalize_stored_positions(ba.positions),
                        min_staffing=ba.min_staffing,
                    )
                )
            source = "basic"

    # 3. Fall back to hardcoded defaults, narrowed to what this kind of agency
    #    runs. An EMS-only service that has not entered its vehicles was
    #    otherwise offered Engine, Ladder, Tanker, Brush, Tower and Hazmat as
    #    its entire picker.
    if not options:
        agency_defaults = await apparatus_type_defaults_for_org(
            db, str(current_user.organization_id)
        )
        for t in agency_defaults:
            options.append(
                ApparatusOption(
                    name=t.capitalize(),
                    apparatus_type=t,
                    source="default",
                )
            )
        source = "default"

    return ApparatusOptionsResponse(options=options, source=source)


# ============================================
# Basic Apparatus (Lightweight)
# ============================================


@router.get("/apparatus", response_model=list[BasicApparatusResponse])
async def list_basic_apparatus(
    is_active: bool | None = True,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all basic apparatus for the organization"""
    query = select(BasicApparatus).where(
        BasicApparatus.organization_id == str(current_user.organization_id)
    )
    if is_active is not None:
        query = query.where(BasicApparatus.is_active == is_active)
    query = query.order_by(BasicApparatus.unit_number)
    result = await db.execute(query)
    return result.scalars().all()


@router.post(
    "/apparatus",
    response_model=BasicApparatusResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_basic_apparatus(
    apparatus: BasicApparatusCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Create a new basic apparatus entry"""
    new_apparatus = BasicApparatus(
        organization_id=str(current_user.organization_id),
        unit_number=apparatus.unit_number,
        name=apparatus.name,
        apparatus_type=apparatus.apparatus_type,
        min_staffing=apparatus.min_staffing,
        positions=normalize_stored_positions(apparatus.positions),
    )
    db.add(new_apparatus)
    await db.commit()
    await db.refresh(new_apparatus)
    return new_apparatus


@router.patch("/apparatus/{apparatus_id}", response_model=BasicApparatusResponse)
async def update_basic_apparatus(
    apparatus_id: UUID,
    apparatus: BasicApparatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Update a basic apparatus entry"""
    result = await db.execute(
        select(BasicApparatus).where(
            BasicApparatus.id == str(apparatus_id),
            BasicApparatus.organization_id == str(current_user.organization_id),
        )
    )
    existing = ensure_found(result.scalar_one_or_none(), "Apparatus")
    update_data = apparatus.model_dump(exclude_unset=True)
    if "positions" in update_data:
        update_data["positions"] = normalize_stored_positions(update_data["positions"])
    for key, value in update_data.items():
        setattr(existing, key, value)
    await db.commit()
    await db.refresh(existing)
    return existing


@router.delete("/apparatus/{apparatus_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_basic_apparatus(
    apparatus_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Delete a basic apparatus entry"""
    result = await db.execute(
        select(BasicApparatus).where(
            BasicApparatus.id == str(apparatus_id),
            BasicApparatus.organization_id == str(current_user.organization_id),
        )
    )
    existing = ensure_found(result.scalar_one_or_none(), "Apparatus")
    await db.delete(existing)
    await db.commit()


# ============================================
# Position Eligibility
# ============================================


@router.get(
    "/eligibility/positions",
    response_model=EligiblePositionsResponse,
)
async def get_eligible_positions(
    shift_id: str | None = Query(
        None, description="Optional shift ID to check against"
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Return the shift positions the current user is eligible to sign up for.

    When ``shift_id`` is provided, the result is intersected with the
    shift's defined positions and accounts for the shift's
    ``open_to_all_members`` flag.

    **Authentication required**
    """
    service = ShiftEligibilityService(db)
    positions = await service.get_eligible_positions(
        user=current_user,
        organization_id=current_user.organization_id,
        shift_id=shift_id,
    )
    is_excluded = len(positions) == 0 and not shift_id
    return EligiblePositionsResponse(positions=positions, is_excluded=is_excluded)


@router.get(
    "/eligibility/positions/bulk",
    response_model=dict[str, list[str]],
)
async def get_eligible_positions_bulk(
    shift_ids: str = Query(
        ...,
        description="Comma-separated shift IDs to check against",
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Eligible positions for several shifts at once, keyed by shift ID.

    The day panel renders a claim button per shift, and each button needs the
    answer for its own shift. Asking one shift at a time re-ran the whole
    member-side computation — membership type, rank, completed training, the
    org's open positions — once per shift; a station running six apparatus
    paid six times for one answer.

    A shift ID the caller cannot see (another org's, or one since deleted)
    comes back with an empty list rather than being absent: the caller asked
    about it, and a missing key reads as "not answered yet".

    **Authentication required**
    """
    requested = [value.strip() for value in shift_ids.split(",") if value.strip()]
    if not requested:
        return {}
    if len(requested) > MAX_BULK_ELIGIBILITY_SHIFTS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"At most {MAX_BULK_ELIGIBILITY_SHIFTS} shifts can be checked at once."
            ),
        )

    service = ShiftEligibilityService(db)
    return await service.get_eligible_positions_bulk(
        user=current_user,
        organization_id=current_user.organization_id,
        shift_ids=requested,
    )


@router.get(
    "/eligibility/roster",
    response_model=PositionRosterResponse,
)
async def get_position_roster(
    position: str = Query(
        "driver",
        description="Shift position to build the roster for",
        max_length=50,
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("scheduling.manage", "training.view_all", "training.manage")
    ),
):
    """
    List every active member eligible for a shift position, and why.

    Answers "who is cleared to drive?" without opening each apparatus in
    turn. Each entry reports the sources of the member's eligibility (rank,
    completed training, or the org's open-position list), their current EVOC
    level, and the apparatus they hold an operator record on.

    **Permissions required:** scheduling.manage, training.view_all, or training.manage
    """
    service = ShiftEligibilityService(db)
    roster = await service.get_position_roster(
        organization_id=current_user.organization_id,
        position=position.strip().lower(),
    )
    return PositionRosterResponse(**roster)


@router.get(
    "/eligibility/settings",
    response_model=SchedulingEligibilitySettingsResponse,
)
async def get_eligibility_settings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """
    Get the org's scheduling eligibility configuration.

    **Permissions required:** scheduling.manage
    """
    service = ShiftEligibilityService(db)
    org = await service._get_org(current_user.organization_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    excluded = service.get_excluded_membership_types(org)
    open_pos = service.get_open_positions(org)
    return SchedulingEligibilitySettingsResponse(
        excluded_membership_types=excluded,
        open_positions=open_pos,
    )


@router.put(
    "/eligibility/settings",
    response_model=SchedulingEligibilitySettingsResponse,
)
async def update_eligibility_settings(
    data: SchedulingEligibilitySettings,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """
    Update the org's scheduling eligibility configuration.

    **Permissions required:** scheduling.manage
    """
    service = ShiftEligibilityService(db)
    try:
        result = await service.update_scheduling_settings(
            organization_id=current_user.organization_id,
            excluded_membership_types=data.excluded_membership_types,
            open_positions=data.open_positions,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))

    return SchedulingEligibilitySettingsResponse(
        excluded_membership_types=result.get(
            "excluded_membership_types",
            [],
        ),
        open_positions=result.get("open_positions", []),
    )


@router.get("/settings", response_model=SchedulingFeatureSettings)
async def get_scheduling_feature_settings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Department-wide scheduling feature toggles. Readable by any member so
    the UI can gate platoon features."""
    service = ShiftEligibilityService(db)
    org = await service._get_org(current_user.organization_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    overtime = service.get_overtime_settings(org)
    autogen = service.get_auto_generate_settings(org)
    lifecycle = service.get_lifecycle_settings(org)
    window = service.get_signup_window_settings(org)
    return SchedulingFeatureSettings(
        platoons_enabled=service.get_platoons_enabled(org),
        max_hours_per_window=overtime.get("max_hours_per_window"),
        hours_window_days=int(overtime.get("hours_window_days", 7) or 7),
        auto_generate_enabled=bool(autogen.get("auto_generate_enabled", False)),
        auto_generate_weeks=int(autogen.get("auto_generate_weeks", 4) or 4),
        require_end_of_shift_checks=bool(
            lifecycle.get("require_end_of_shift_checks", False)
        ),
        restrict_checkin_to_assigned=bool(
            lifecycle.get("restrict_checkin_to_assigned", False)
        ),
        signup_closes_minutes_before=window["signup_closes_minutes_before"],
        late_signup_grace_minutes=window["late_signup_grace_minutes"],
        enforce_evoc=service.get_evoc_enforcement(org),
        call_tracking=CallTrackingSettings(**service.get_call_tracking_settings(org)),
    )


@router.put("/settings", response_model=SchedulingFeatureSettings)
async def update_scheduling_feature_settings(
    data: SchedulingFeatureSettings,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Update department-wide scheduling feature toggles."""
    service = ShiftEligibilityService(db)
    try:
        # Only touch the overtime fields when the caller actually sent them,
        # so a partial save (e.g. the platoon toggle) can't wipe the cap.
        fields_set = data.model_fields_set
        result = await service.update_scheduling_settings(
            organization_id=current_user.organization_id,
            # Guarded like every sibling field. Passed unconditionally, a
            # partial save from any single toggle (which sends only its own
            # key) carried the schema default False and switched platoon
            # scheduling off behind the user's back.
            platoons_enabled=(
                data.platoons_enabled if "platoons_enabled" in fields_set else None
            ),
            max_hours_per_window=(
                (data.max_hours_per_window or 0.0)
                if "max_hours_per_window" in fields_set
                else None
            ),
            hours_window_days=(
                data.hours_window_days if "hours_window_days" in fields_set else None
            ),
            auto_generate_enabled=(
                data.auto_generate_enabled
                if "auto_generate_enabled" in fields_set
                else None
            ),
            auto_generate_weeks=(
                data.auto_generate_weeks
                if "auto_generate_weeks" in fields_set
                else None
            ),
            require_end_of_shift_checks=(
                data.require_end_of_shift_checks
                if "require_end_of_shift_checks" in fields_set
                else None
            ),
            restrict_checkin_to_assigned=(
                data.restrict_checkin_to_assigned
                if "restrict_checkin_to_assigned" in fields_set
                else None
            ),
            # Guarded like every sibling field: each settings control sends
            # only its own key, and passing the schema default unconditionally
            # would reset the department's signup window from a save of an
            # unrelated toggle.
            signup_closes_minutes_before=(
                data.signup_closes_minutes_before
                if "signup_closes_minutes_before" in fields_set
                else None
            ),
            late_signup_grace_minutes=(
                data.late_signup_grace_minutes
                if "late_signup_grace_minutes" in fields_set
                else None
            ),
            enforce_evoc=(data.enforce_evoc if "enforce_evoc" in fields_set else None),
            # Guarded like every sibling field: a partial save from another
            # toggle sends only its own key, and passing the schema default
            # unconditionally would reset the department's call-type list.
            call_tracking=(
                data.call_tracking.model_dump()
                if "call_tracking" in fields_set and data.call_tracking is not None
                else None
            ),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    # Read the window back through the same degrading reader the GET path
    # uses. A bare `int()` here raises *outside* the try above, so one
    # hand-edited value like "tomorrow" turned an unrelated toggle's save into
    # a 500 — reported to the admin as a failure, with the write already
    # committed. It also mishandled a stored null, which `or 0` silently
    # turned into "closes at the start" rather than the built-in default.
    saved_org = await service._get_org(current_user.organization_id)
    window = service.get_signup_window_settings(saved_org)
    return SchedulingFeatureSettings(
        platoons_enabled=bool(result.get("platoons_enabled", False)),
        max_hours_per_window=result.get("max_hours_per_window"),
        hours_window_days=int(result.get("hours_window_days", 7) or 7),
        auto_generate_enabled=bool(result.get("auto_generate_enabled", False)),
        auto_generate_weeks=int(result.get("auto_generate_weeks", 4) or 4),
        require_end_of_shift_checks=bool(
            result.get("require_end_of_shift_checks", False)
        ),
        restrict_checkin_to_assigned=bool(
            result.get("restrict_checkin_to_assigned", False)
        ),
        signup_closes_minutes_before=window["signup_closes_minutes_before"],
        late_signup_grace_minutes=window["late_signup_grace_minutes"],
        enforce_evoc=bool(result.get("enforce_evoc", True)),
        call_tracking=CallTrackingSettings(
            **service.get_call_tracking_settings(saved_org)
        ),
    )


@router.get("/calendar-feed", response_model=CalendarFeedResponse)
async def get_calendar_feed(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the member's personal ICS calendar-feed token/path, creating the
    token on first use. Subscribe by prepending the site origin to feed_path."""
    service = SchedulingService(db)
    token = await service.ensure_calendar_token(
        current_user.id, current_user.organization_id
    )
    if not token:
        raise HTTPException(status_code=404, detail="User not found")
    return CalendarFeedResponse(
        token=token, feed_path=f"/api/public/v1/calendar/{token}.ics"
    )


@router.post("/calendar-feed/rotate", response_model=CalendarFeedResponse)
async def rotate_calendar_feed(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Issue a new calendar-feed token, invalidating the previous feed URL."""
    service = SchedulingService(db)
    token = await service.rotate_calendar_token(
        current_user.id, current_user.organization_id
    )
    if not token:
        raise HTTPException(status_code=404, detail="User not found")
    return CalendarFeedResponse(
        token=token, feed_path=f"/api/public/v1/calendar/{token}.ics"
    )


@router.get("/platoons/overview", response_model=PlatoonOverviewResponse)
async def get_platoon_overview(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Department-wide platoon roster: every named platoon plus the unassigned
    bucket, with each platoon's active members."""
    service = ShiftEligibilityService(db)
    org = await service._get_org(current_user.organization_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    groups = await service.get_platoon_overview(current_user.organization_id)
    return PlatoonOverviewResponse(
        platoons_enabled=service.get_platoons_enabled(org),
        groups=groups,
    )


@router.post("/platoons/bulk-assign", response_model=PlatoonBulkAssignResult)
async def bulk_assign_platoon(
    data: PlatoonBulkAssign,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Assign a platoon to (or clear it from) many members at once.

    Only members in the caller's organization are updated.
    """
    service = ShiftEligibilityService(db)
    updated = await service.bulk_assign_platoon(
        organization_id=current_user.organization_id,
        user_ids=[str(uid) for uid in data.user_ids],
        platoon=data.platoon,
    )
    await log_audit_event(
        db=db,
        event_type="platoon_bulk_assigned",
        event_category="scheduling",
        severity="INFO",
        event_data={
            "organization_id": str(current_user.organization_id),
            "platoon": (data.platoon or "").strip() or None,
            "member_count": updated,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return PlatoonBulkAssignResult(
        updated=updated,
        platoon=(data.platoon or "").strip() or None,
    )

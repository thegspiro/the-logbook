"""
Apparatus Events API

Outreach that rolls an apparatus with a named crew but is not a shift:
templates, scheduling nights from them, and each night's crew board. A night
is an ordinary event; its check-in, finalization and Admin Hours credit are
the events endpoints'.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission, user_has_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.apparatus_event import ApparatusEventTemplate
from app.models.user import User
from app.schemas.apparatus_event import (
    ApparatusEventTemplateCreate,
    ApparatusEventTemplateResponse,
    ApparatusEventTemplateUpdate,
    CalendarOutreachItem,
    ConflictCheckRequest,
    ConflictCheckResponse,
    CrewBoardResponse,
    CrewSeatResponse,
    CrewUnitResponse,
    DriverCandidatesResponse,
    EditorOptionsResponse,
    NightPlanUpdate,
    NightSummary,
    ScheduleNightsRequest,
    ScheduleNightsResponse,
    SeatAssignmentRequest,
    SeriesNight,
    TemplateSeatResponse,
    TemplateUnitResponse,
)
from app.services.apparatus_event_service import (
    ApparatusEventService,
    ConflictsNotAcknowledged,
    SeatOutcome,
)
from app.services.event_service import attendance_is_finalized

router = APIRouter()

MANAGE = "apparatus_events.manage"
SIGNUP = "apparatus_events.signup"


@dataclass(frozen=True)
class _Viewer:
    """Who is asking, read once before any service call.

    Permissions are taken from ``current_user.positions`` up front because a
    service write can re-populate that same identity-map object (a member
    reading a night they crew is a seat's occupant), and a relationship read
    after that would lazy-load outside the event loop.
    """

    user: User
    id: str
    organization_id: str
    username: str
    can_manage: bool
    can_sign_up: bool


def _viewer(current_user: User) -> _Viewer:
    return _Viewer(
        user=current_user,
        id=str(current_user.id),
        organization_id=str(current_user.organization_id),
        username=current_user.username,
        can_manage=user_has_permission(current_user, MANAGE),
        can_sign_up=user_has_permission(current_user, SIGNUP),
    )


def _bad_request(exc: Exception) -> HTTPException:
    return HTTPException(status_code=400, detail=safe_error_detail(exc))


async def _template_responses(
    service: ApparatusEventService,
    templates: List[ApparatusEventTemplate],
    organization_id: str,
) -> List[ApparatusEventTemplateResponse]:
    ids = [str(t.id) for t in templates]
    usage = await service.template_usage(organization_id, ids)
    categories = await service.category_names(
        organization_id, [t.admin_hours_category_id for t in templates]
    )
    sources = await service.template_names(
        organization_id, [t.duplicated_from_id for t in templates]
    )
    responses = []
    for template in templates:
        nights, latest = usage.get(str(template.id), (0, None))
        units = [
            TemplateUnitResponse(
                id=str(unit.id),
                apparatus_id=str(unit.apparatus_id),
                unit_number=unit.apparatus.unit_number,
                apparatus_name=unit.apparatus.name,
                required_evoc_level_name=(
                    unit.apparatus.required_evoc_level.name
                    if unit.apparatus.required_evoc_level
                    else None
                ),
                seats=[TemplateSeatResponse.model_validate(s) for s in unit.seats],
            )
            for unit in template.units
        ]
        responses.append(
            ApparatusEventTemplateResponse(
                id=str(template.id),
                name=template.name,
                description=template.description,
                event_type=template.event_type,
                default_start_time=template.default_start_time,
                duration_minutes=template.duration_minutes,
                location=template.location,
                admin_hours_category_id=template.admin_hours_category_id,
                admin_hours_category_name=categories.get(
                    str(template.admin_hours_category_id)
                ),
                evoc_mode=template.evoc_mode,
                allow_self_signup=template.allow_self_signup,
                show_on_schedule=template.show_on_schedule,
                duplicated_from_id=template.duplicated_from_id,
                duplicated_from_name=sources.get(str(template.duplicated_from_id)),
                total_seats=sum(s.count for u in template.units for s in u.seats),
                nights_scheduled=nights,
                last_scheduled_at=latest,
                units=units,
                created_at=template.created_at,
                updated_at=template.updated_at,
            )
        )
    return responses


async def _board(
    service: ApparatusEventService,
    event_id: str,
    viewer: _Viewer,
    warnings: List[Dict[str, Any]] | None = None,
) -> CrewBoardResponse:
    organization_id = viewer.organization_id
    can_manage = viewer.can_manage
    night = await service.get_night(event_id, organization_id)
    if night is None:
        raise HTTPException(status_code=404, detail="Apparatus event not found")
    event, plan = night
    # An unpublished night is the coordinator's working copy.
    if event.is_draft and not can_manage:
        raise HTTPException(status_code=404, detail="Apparatus event not found")

    checked_in = await service.checked_in_users(event_id, organization_id)
    series = await service.series_nights(organization_id, plan.series_id)
    template_names = await service.template_names(organization_id, [plan.template_id])
    categories = await service.category_names(
        organization_id, [plan.admin_hours_category_id]
    )
    member_names = await service.member_names(
        organization_id, [s.user_id for u in plan.units for s in u.seats]
    )
    me = viewer.id
    my_seat_id = None
    units = []
    for unit in plan.units:
        seats = []
        for seat in unit.seats:
            if seat.user_id and str(seat.user_id) == me:
                my_seat_id = str(seat.id)
            seats.append(
                CrewSeatResponse(
                    id=str(seat.id),
                    name=seat.name,
                    seat_type=seat.seat_type,
                    note=seat.note,
                    user_id=str(seat.user_id) if seat.user_id else None,
                    user_name=(
                        member_names.get(str(seat.user_id)) if seat.user_id else None
                    ),
                    assignment_method=seat.assignment_method,
                    is_me=bool(seat.user_id) and str(seat.user_id) == me,
                    checked_in=bool(seat.user_id) and str(seat.user_id) in checked_in,
                )
            )
        units.append(
            CrewUnitResponse(
                id=str(unit.id),
                apparatus_id=str(unit.apparatus_id),
                unit_number=unit.apparatus.unit_number,
                apparatus_name=unit.apparatus.name,
                required_evoc_level_name=(
                    unit.apparatus.required_evoc_level.name
                    if unit.apparatus.required_evoc_level
                    else None
                ),
                seats=seats,
            )
        )
    night_number = next(
        (i + 1 for i, row in enumerate(series) if row[0] == str(event.id)), 1
    )
    return CrewBoardResponse(
        event_id=str(event.id),
        title=event.title,
        event_type=event.event_type,
        start_datetime=event.start_datetime,
        end_datetime=event.end_datetime,
        location=event.location,
        is_cancelled=bool(event.is_cancelled),
        attendance_finalized=attendance_is_finalized(event),
        template_id=plan.template_id,
        template_name=template_names.get(str(plan.template_id)),
        evoc_mode=plan.evoc_mode,
        allow_self_signup=plan.allow_self_signup,
        show_on_schedule=plan.show_on_schedule,
        admin_hours_category_id=plan.admin_hours_category_id,
        admin_hours_category_name=categories.get(str(plan.admin_hours_category_id)),
        night_number=night_number,
        night_count=max(len(series), 1),
        series=[
            SeriesNight(event_id=i, start_datetime=start, filled=f, total=t)
            for i, start, f, t in series
        ],
        units=units,
        my_seat_id=my_seat_id,
        can_manage=can_manage,
        can_sign_up=viewer.can_sign_up,
        warnings=warnings or [],
    )


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------


@router.get("/templates", response_model=List[ApparatusEventTemplateResponse])
async def list_templates(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus_events.manage")),
):
    """
    List the department's apparatus event templates.

    **Requires permission: apparatus_events.manage**
    """
    service = ApparatusEventService(db)
    templates = await service.list_templates(str(current_user.organization_id))
    return await _template_responses(
        service, templates, str(current_user.organization_id)
    )


@router.post(
    "/templates",
    response_model=ApparatusEventTemplateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_template(
    data: ApparatusEventTemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus_events.manage")),
):
    """
    Create an apparatus event template, or a copy of one (``duplicated_from_id``).

    **Requires permission: apparatus_events.manage**
    """
    service = ApparatusEventService(db)
    organization_id = str(current_user.organization_id)
    try:
        template = await service.create_template(
            data, organization_id, str(current_user.id)
        )
    except ValueError as exc:
        raise _bad_request(exc)
    await log_audit_event(
        db=db,
        event_type="apparatus_event_template_created",
        event_category="events",
        severity="info",
        event_data={
            "template_id": str(template.id),
            "duplicated_from_id": data.duplicated_from_id,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return (await _template_responses(service, [template], organization_id))[0]


@router.get("/options", response_model=EditorOptionsResponse)
async def editor_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus_events.manage")),
):
    """
    The apparatus and Admin Hours categories the template editor offers.

    **Requires permission: apparatus_events.manage**
    """
    return await ApparatusEventService(db).editor_options(
        str(current_user.organization_id)
    )


@router.get("/templates/{template_id}", response_model=ApparatusEventTemplateResponse)
async def get_template(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus_events.manage")),
):
    """
    Get one apparatus event template.

    **Requires permission: apparatus_events.manage**
    """
    service = ApparatusEventService(db)
    organization_id = str(current_user.organization_id)
    template = await service.get_template(template_id, organization_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return (await _template_responses(service, [template], organization_id))[0]


@router.put("/templates/{template_id}", response_model=ApparatusEventTemplateResponse)
async def update_template(
    template_id: str,
    data: ApparatusEventTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus_events.manage")),
):
    """
    Replace an apparatus event template. Nights already scheduled keep their
    own copy of the plan.

    **Requires permission: apparatus_events.manage**
    """
    service = ApparatusEventService(db)
    organization_id = str(current_user.organization_id)
    try:
        template = await service.update_template(template_id, data, organization_id)
    except ValueError as exc:
        raise _bad_request(exc)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    await log_audit_event(
        db=db,
        event_type="apparatus_event_template_updated",
        event_category="events",
        severity="info",
        event_data={"template_id": str(template.id)},
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return (await _template_responses(service, [template], organization_id))[0]


@router.delete("/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_template(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus_events.manage")),
):
    """
    Archive an apparatus event template. Nights scheduled from it are kept.

    **Requires permission: apparatus_events.manage**
    """
    service = ApparatusEventService(db)
    if not await service.archive_template(
        template_id, str(current_user.organization_id)
    ):
        raise HTTPException(status_code=404, detail="Template not found")
    await log_audit_event(
        db=db,
        event_type="apparatus_event_template_archived",
        event_category="events",
        severity="info",
        event_data={"template_id": template_id},
        user_id=str(current_user.id),
        username=current_user.username,
    )


# ---------------------------------------------------------------------------
# Scheduling nights
# ---------------------------------------------------------------------------


@router.post("/templates/{template_id}/conflicts", response_model=ConflictCheckResponse)
async def check_conflicts(
    template_id: str,
    data: ConflictCheckRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus_events.manage")),
):
    """
    Preview what stands in the way of the template's apparatus on these nights.

    **Requires permission: apparatus_events.manage**
    """
    service = ApparatusEventService(db)
    try:
        conflicts = await service.check_template_conflicts(
            template_id, data.nights, str(current_user.organization_id)
        )
    except ValueError as exc:
        raise _bad_request(exc)
    if conflicts is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return ConflictCheckResponse(conflicts=conflicts)


@router.post(
    "/templates/{template_id}/schedule",
    response_model=ScheduleNightsResponse,
    status_code=status.HTTP_201_CREATED,
)
async def schedule_nights(
    template_id: str,
    data: ScheduleNightsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus_events.manage")),
):
    """
    Schedule one or more nights from a template. Each night is its own event
    with its own crew. Unacknowledged apparatus conflicts answer 409 with the
    conflicts listed.

    **Requires permission: apparatus_events.manage**
    """
    service = ApparatusEventService(db)
    try:
        result = await service.schedule_nights(
            template_id, data, str(current_user.organization_id), str(current_user.id)
        )
    except ConflictsNotAcknowledged as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "message": str(exc),
                "conflicts": [c.model_dump() for c in exc.conflicts],
            },
        )
    except ValueError as exc:
        raise _bad_request(exc)
    if result is None:
        raise HTTPException(status_code=404, detail="Template not found")
    series_id, event_ids = result
    await log_audit_event(
        db=db,
        event_type="apparatus_event_nights_scheduled",
        event_category="events",
        severity="info",
        event_data={
            "template_id": template_id,
            "series_id": series_id,
            "nights": len(event_ids),
            "conflicts_acknowledged": data.acknowledge_conflicts,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return ScheduleNightsResponse(series_id=series_id, event_ids=event_ids)


@router.get("/nights", response_model=List[NightSummary])
async def list_nights(
    scope: Literal["upcoming", "needs_confirmation", "past"] = Query("upcoming"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus_events.manage")),
):
    """
    The coordinator's nights: upcoming, over but not yet finalized, or past.

    **Requires permission: apparatus_events.manage**
    """
    rows = await ApparatusEventService(db).list_nights(
        str(current_user.organization_id), scope
    )
    return [NightSummary(**row) for row in rows]


@router.get("/calendar", response_model=List[CalendarOutreachItem])
async def calendar(
    start: datetime = Query(...),
    end: datetime = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.view")),
):
    """
    Apparatus nights in a date range, for the scheduling calendar's read-only
    "outreach · not a shift" overlay.

    **Requires permission: events.view**
    """
    try:
        rows = await ApparatusEventService(db).calendar(
            str(current_user.organization_id), start, end, str(current_user.id)
        )
    except ValueError as exc:
        raise _bad_request(exc)
    return [CalendarOutreachItem(**row) for row in rows]


@router.get("/members")
async def assignable_members(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus_events.manage")),
) -> List[Dict[str, str]]:
    """
    Current members a coordinator can put in a seat.

    **Requires permission: apparatus_events.manage**
    """
    members = await ApparatusEventService(db).assignable_members(
        str(current_user.organization_id)
    )
    return [{"user_id": user_id, "name": name} for user_id, name in members]


# ---------------------------------------------------------------------------
# A night's crew
# ---------------------------------------------------------------------------


@router.get("/events/{event_id}", response_model=CrewBoardResponse)
async def get_crew_board(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("apparatus_events.signup", "apparatus_events.manage")
    ),
):
    """
    A night's apparatus, seats and crew.

    **Requires permission: apparatus_events.signup OR apparatus_events.manage**
    """
    viewer = _viewer(current_user)
    return await _board(ApparatusEventService(db), event_id, viewer)


def _outcome_or_404(outcome: SeatOutcome | None) -> SeatOutcome:
    if outcome is None:
        raise HTTPException(status_code=404, detail="Seat not found")
    return outcome


@router.post(
    "/events/{event_id}/seats/{seat_id}/claim", response_model=CrewBoardResponse
)
async def claim_seat(
    event_id: str,
    seat_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("apparatus_events.signup", "apparatus_events.manage")
    ),
):
    """
    Take an open seat for yourself. A Driver seat follows the night's EVOC rule.

    **Requires permission: apparatus_events.signup OR apparatus_events.manage**
    """
    viewer = _viewer(current_user)
    service = ApparatusEventService(db)
    try:
        outcome = _outcome_or_404(
            await service.claim_seat(
                event_id, seat_id, viewer.organization_id, current_user
            )
        )
    except ValueError as exc:
        raise _bad_request(exc)
    return await _board(service, event_id, viewer, outcome.warnings)


@router.post(
    "/events/{event_id}/seats/{seat_id}/release", response_model=CrewBoardResponse
)
async def release_seat(
    event_id: str,
    seat_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("apparatus_events.signup", "apparatus_events.manage")
    ),
):
    """
    Leave your seat. Clearing someone else's seat also needs
    apparatus_events.manage.

    **Requires permission: apparatus_events.signup OR apparatus_events.manage**
    """
    viewer = _viewer(current_user)
    service = ApparatusEventService(db)
    try:
        _outcome_or_404(
            await service.release_seat(
                event_id,
                seat_id,
                viewer.organization_id,
                current_user,
                as_manager=viewer.can_manage,
            )
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=safe_error_detail(exc))
    except ValueError as exc:
        raise _bad_request(exc)
    return await _board(service, event_id, viewer)


@router.put(
    "/events/{event_id}/seats/{seat_id}/assignment", response_model=CrewBoardResponse
)
async def assign_seat(
    event_id: str,
    seat_id: str,
    data: SeatAssignmentRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus_events.manage")),
):
    """
    Put a member in a seat, move them from another seat on the night, or
    clear the seat (``user_id`` null).

    **Requires permission: apparatus_events.manage**
    """
    viewer = _viewer(current_user)
    service = ApparatusEventService(db)
    try:
        outcome = _outcome_or_404(
            await service.assign_seat(
                event_id,
                seat_id,
                data.user_id,
                viewer.organization_id,
                current_user,
            )
        )
    except ValueError as exc:
        raise _bad_request(exc)
    await log_audit_event(
        db=db,
        event_type="apparatus_event_seat_assigned",
        event_category="events",
        severity="info",
        event_data={
            "event_id": event_id,
            "seat_id": seat_id,
            "assigned_user_id": data.user_id,
        },
        user_id=viewer.id,
        username=viewer.username,
    )
    return await _board(service, event_id, viewer, outcome.warnings)


@router.get(
    "/events/{event_id}/units/{unit_id}/driver-candidates",
    response_model=DriverCandidatesResponse,
)
async def driver_candidates(
    event_id: str,
    unit_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus_events.manage")),
):
    """
    Members who could drive this night's apparatus, each judged by the same
    rule a Driver seat write uses.

    **Requires permission: apparatus_events.manage**
    """
    result = await ApparatusEventService(db).driver_candidates(
        event_id, unit_id, str(current_user.organization_id)
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Apparatus not found")
    plan, unit, candidates = result
    return DriverCandidatesResponse(
        unit_id=str(unit.id),
        required_evoc_level_name=(
            unit.apparatus.required_evoc_level.name
            if unit.apparatus.required_evoc_level
            else None
        ),
        evoc_mode=plan.evoc_mode,
        candidates=candidates,
    )


@router.put("/events/{event_id}/plan", response_model=CrewBoardResponse)
async def update_night_plan(
    event_id: str,
    data: NightPlanUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus_events.manage")),
):
    """
    Change one night's apparatus and seats without touching its template or the
    other nights. Apparatus conflicts are returned as warnings.

    **Requires permission: apparatus_events.manage**
    """
    viewer = _viewer(current_user)
    service = ApparatusEventService(db)
    try:
        conflicts = await service.update_night_plan(
            event_id, data, viewer.organization_id
        )
    except ValueError as exc:
        raise _bad_request(exc)
    if conflicts is None:
        raise HTTPException(status_code=404, detail="Apparatus event not found")
    await log_audit_event(
        db=db,
        event_type="apparatus_event_night_updated",
        event_category="events",
        severity="info",
        event_data={"event_id": event_id},
        user_id=viewer.id,
        username=viewer.username,
    )
    warnings = [
        {"type": "apparatus_conflict", "message": c.reason, "severity": "warning"}
        for c in conflicts
    ]
    return await _board(service, event_id, viewer, warnings)

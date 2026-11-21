"""Volunteer signup sheets on outreach events (owner decision, 2026-11-20).

A public request has always been able to open a role-based signup sheet. An
outreach event an officer creates directly, with no request behind it, now can
too, with the same kind of shift, the same roles and the same signup rules.

Who owns a sheet is decided once, here: an event a request was scheduled onto
is staffed from its request (the sheet, its roles and its volunteer call live
there, and the request's own date and cancellation syncs already move it), so
only an event with no request opens a sheet of its own. Both read the same
state through ``get_staffing_state``.
"""

from datetime import timezone
from typing import Any, Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event
from app.models.event_request import EventRequest
from app.models.user import Organization
from app.services.dashboard_widget_service import is_outreach_event
from app.services.event_request_service import (
    create_outreach_shift,
    describe_roles,
    get_live_staffing_shift,
    get_staffing_state,
    outreach_timezone,
    validate_staffing_roles,
)


async def linked_request(db: AsyncSession, event: Event) -> Optional[EventRequest]:
    """The request this event was scheduled from, if any (org-scoped)."""
    return await db.scalar(
        select(EventRequest).where(
            EventRequest.event_id == str(event.id),
            EventRequest.organization_id == str(event.organization_id),
        )
    )


async def get_event_staffing(
    db: AsyncSession, event: Event, org: Optional[Organization]
) -> dict[str, Any]:
    """The signup sheet that staffs this event, whichever owns it.

    ``request_id`` names the request when the sheet is the request's, so the
    event page can send the organizer there to change it.
    """
    request = await linked_request(db, event)
    if request is not None:
        state = await get_staffing_state(db, request, org)
        return {**state, "request_id": str(request.id)}
    state = await get_staffing_state(db, event, org)
    return {**state, "request_id": None}


async def open_event_staffing(
    db: AsyncSession,
    event: Event,
    org: Optional[Organization],
    staffing_roles: Any,
    actor_id: str,
    notes: Optional[str] = None,
) -> Optional[str]:
    """Open a signup sheet on an outreach event with no request behind it.

    Returns an error message, or ``None`` once the sheet is created and linked
    (the caller commits). The event row is locked first: opening is
    read-then-write on ``staffing_shift_id``, and two organizers pressing at
    once would otherwise each create a sheet.
    """
    locked = await db.scalar(
        select(Event)
        .where(
            Event.id == str(event.id),
            Event.organization_id == str(event.organization_id),
        )
        .with_for_update()
    )
    if locked is None:
        return "Event not found"
    event = locked

    if event.is_cancelled:
        return "This event was cancelled."
    if not await is_outreach_event(db, str(event.organization_id), str(event.id)):
        return (
            "Only an outreach event can open volunteer signups: a public "
            "education, fundraiser, ceremony or social event."
        )
    if await linked_request(db, event) is not None:
        return (
            "This event came from a public request. Open signups from the "
            "request, where its staffing is kept."
        )
    if await get_live_staffing_shift(db, event) is not None:
        return "Volunteer signups are already open for this event."

    try:
        roles = validate_staffing_roles(org, staffing_roles)
    except ValueError as e:
        return str(e)

    note_lines = [f"Community outreach: {event.title}."]
    note_lines.append("Roles needed: " + describe_roles(org, roles))
    if notes:
        note_lines.append(notes)
    where = event.location or event.location_details
    if where:
        note_lines.append(f"Location: {where}")

    shift, error = await create_outreach_shift(
        db,
        str(event.organization_id),
        org,
        event.start_datetime,
        event.end_datetime,
        roles,
        note_lines,
        actor_id,
    )
    if error or shift is None:
        return error or "Unable to create the volunteer signup shift."
    event.staffing_shift_id = str(shift.id)
    event.staffing_roles = roles
    return None


async def move_event_staffing(
    db: AsyncSession, event: Event, org: Optional[Organization]
) -> None:
    """Keep an event's own sheet on the event's time, inside its transaction.

    Members keep their seats — the event moved, not the roster. A sheet that
    was stood down or finalized is left alone. Never raises into the caller:
    the event edit itself must not fail over its sheet.
    """
    if not event.staffing_shift_id:
        return
    try:
        shift = await get_live_staffing_shift(db, event)
        if shift is None or shift.is_finalized:
            return
        start = event.start_datetime
        end = event.end_datetime
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        if end is not None and end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)
        if shift.start_time == start and shift.end_time == end:
            return
        shift.shift_date = start.astimezone(outreach_timezone(org)).date()
        shift.start_time = start
        shift.end_time = end
    except Exception as e:
        logger.warning(
            "Could not move staffing shift {} for event {}: {}",
            event.staffing_shift_id,
            event.id,
            e,
        )


async def stand_down_event_staffing(
    db: AsyncSession,
    shift_id: Optional[str],
    organization_id: str,
    actor_id: Optional[str],
    reason: str,
) -> None:
    """Cancel a sheet whose event was cancelled or deleted, and tell its crew.

    Takes the shift id rather than the event, because a deleted event is gone
    by the time this runs: ``cancel_shift`` commits, so it is called after the
    event's own commit. Never raises into the caller.
    """
    if not shift_id:
        return
    from app.services.scheduling_service import SchedulingService

    try:
        _shift, error = await SchedulingService(db).cancel_shift(
            shift_id,
            organization_id,
            cancelled_by_user_id=actor_id,
            reason=reason,
        )
        if error and error != "Shift is already cancelled.":
            logger.warning("Could not cancel staffing shift {}: {}", shift_id, error)
    except Exception as e:
        logger.warning("Could not cancel staffing shift {}: {}", shift_id, e)

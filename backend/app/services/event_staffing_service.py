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

from datetime import datetime, timezone
from typing import Any, Iterable, Optional

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
    email_volunteer_call,
    get_live_staffing_shift,
    get_staffing_state,
    outreach_timezone,
    roles_still_needed,
    validate_staffing_roles,
    volunteer_call_recipients,
)
from app.services.member_audience import AudienceFilter


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


async def member_signup_sheet(
    db: AsyncSession, event: Event, org: Optional[Organization], user_id: str
) -> Optional[dict[str, Any]]:
    """The event's live signup sheet for a member to sign up from, or None.

    Reads the same state the organizer's card does (``get_event_staffing``),
    so the two cannot disagree about what is still needed, but returns only the
    roles and the caller's own seat. Signing up itself goes through the
    scheduling signup endpoint, which enforces eligibility and the window.
    """
    if event.is_cancelled:
        return None
    state = await get_event_staffing(db, event, org)
    if not state["shift_id"]:
        return None
    mine = next(
        (v for v in state["volunteers"] if str(v["user_id"]) == str(user_id)), None
    )
    return {
        "shift_id": str(state["shift_id"]),
        "roles": state["roles"],
        "signed_up": mine is not None,
        "my_role_label": mine["outreach_role_label"] if mine else None,
    }


def seat_board(state: dict[str, Any], user_id: str) -> dict[str, Any]:
    """One row per seat on a signup sheet, as the shift crew board lays seats out.

    Built from ``get_staffing_state``: each role's holders in signup order, then
    its open seats, essential roles first and otherwise in the order the sheet
    asks for them. A role somebody
    holds that the sheet no longer asks for is listed after them (its total is
    zero), so the person is still shown as coming.
    """
    holders: dict[str, list[dict[str, Any]]] = {}
    for volunteer in state["volunteers"]:
        holders.setdefault(volunteer["outreach_role"] or "", []).append(volunteer)

    seats: list[dict[str, Any]] = []
    # Essential roles first (owner decision, 2026-11-23), so the seats the day
    # cannot run without are read before the optional ones; sheet order
    # otherwise, as sorted() is stable.
    for role in sorted(state["roles"], key=lambda r: not r["essential"]):
        taken = holders.get(role["role"], [])
        for volunteer in taken:
            seats.append(
                {
                    "role": role["role"],
                    "label": role["label"],
                    "member_name": volunteer["member_name"],
                    "is_me": str(volunteer["user_id"]) == str(user_id),
                    "essential": role["essential"],
                }
            )
        for _ in range(max(role["total"] - len(taken), 0)):
            seats.append(
                {
                    "role": role["role"],
                    "label": role["label"],
                    "member_name": None,
                    "is_me": False,
                    "essential": role["essential"],
                }
            )
    mine = next(
        (v for v in state["volunteers"] if str(v["user_id"]) == str(user_id)), None
    )
    return {
        "shift_id": str(state["shift_id"]),
        "seats": seats,
        "signed_up": mine is not None,
        "my_role_label": mine["outreach_role_label"] if mine else None,
    }


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


async def send_event_volunteer_call(
    db: AsyncSession,
    event: Event,
    org: Optional[Organization],
    message: Optional[str] = None,
    audience: Optional[AudienceFilter] = None,
) -> dict[str, Any]:
    """Email the membership asking who can help with this event's own sheet.

    The same call a request's sheet sends (``send_volunteer_call``), worded
    from the event: its title, its time, its location and the roles still
    open. Only an event that staffs itself sends one — an event scheduled from
    a request is called for from the request, which keeps that call's record.
    Raises ``ValueError`` with the reason it cannot be sent; the caller
    commits and audits.
    """
    if event.is_cancelled:
        raise ValueError("This event was cancelled.")
    if await linked_request(db, event) is not None:
        raise ValueError(
            "This event came from a public request. Email the membership from "
            "the request, where its staffing is kept."
        )
    if not event.staffing_shift_id:
        raise ValueError("Open volunteer signups before asking the membership.")
    end = event.end_datetime or event.start_datetime
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    if end <= datetime.now(timezone.utc):
        raise ValueError("This event has already happened.")

    audience = audience or AudienceFilter()
    recipients, skipped = await volunteer_call_recipients(
        db, org, str(event.organization_id), audience
    )

    detail_rows: list[tuple[str, str]] = []
    still_needed = await roles_still_needed(db, event, org)
    if still_needed:
        detail_rows.append(("Roles needed", still_needed))
    where = event.location or event.location_details
    if where:
        detail_rows.append(("Where", where))

    await email_volunteer_call(
        org,
        recipients,
        label=event.title,
        requester=None,
        start=event.start_datetime,
        detail_rows=detail_rows,
        sheet_open=True,
        message=message,
        db=db,
    )

    sent_at = datetime.now(timezone.utc)
    event.volunteer_call_sent_at = sent_at
    sent = len(recipients)
    return {
        "message": f"Volunteer call emailed to {sent} members.",
        "recipients": sent,
        "skipped_opted_out": skipped,
        "volunteer_call_sent_at": sent_at,
    }


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


async def sheet_event(
    db: AsyncSession, shift_id: str, organization_id: str
) -> Optional[Event]:
    """The event a signup sheet staffs: its request's event, or its own."""
    event_id = await db.scalar(
        select(EventRequest.event_id).where(
            EventRequest.staffing_shift_id == str(shift_id),
            EventRequest.organization_id == str(organization_id),
        )
    )
    query = select(Event).where(Event.organization_id == str(organization_id))
    if event_id:
        query = query.where(Event.id == str(event_id))
    else:
        query = query.where(Event.staffing_shift_id == str(shift_id))
    return await db.scalar(query)


async def sync_volunteer_rsvps(
    db: AsyncSession,
    shift_id: str,
    organization_id: str,
    removed_user_ids: Iterable[str] = (),
) -> Optional[str]:
    """Make the event's RSVPs agree with who holds a seat on its signup sheet.

    Owner decision, 2026-11-20: a member who claims a role at an outreach event
    is going to it, so they appear in its Attendance and at the head of its
    check-in list rather than only on the schedule. Idempotent — it compares
    and corrects, so running it twice, or after any seat change, settles the
    same RSVPs (pitfall #36):

    * a member holding a seat has a ``going`` RSVP marked ``is_volunteer``,
      created if missing — crew, so it takes no attendee seat (owner
      decision, 2026-11-21);
    * a member whose seat was cancelled, declined or removed, and who holds no
      other seat, goes from ``going`` to ``not_going`` and is no longer marked.

    A checked-in RSVP is never touched (the member was there), and nothing
    changes on a cancelled event or one whose attendance is finalized.
    ``removed_user_ids`` names members whose assignment row was deleted, which
    leaves no row to read. The caller commits.

    Returns the event's id when the sync freed attendee seats on a capped
    event — an audience RSVP that became crew, or a volunteer's guests let go
    with them — so the caller can promote from the waitlist once it has
    committed (``promote_after_sync``). ``None`` otherwise.
    """
    from app.models.event import EventRSVP, RSVPStatus
    from app.models.training import ShiftAssignment
    from app.services.event_request_service import released_seat_statuses
    from app.services.event_service import attendance_is_finalized, rsvp_seats

    event = await sheet_event(db, shift_id, organization_id)
    if event is None or event.is_cancelled or attendance_is_finalized(event):
        return None

    rows = await db.execute(
        select(ShiftAssignment.user_id, ShiftAssignment.assignment_status).where(
            ShiftAssignment.shift_id == str(shift_id),
            ShiftAssignment.organization_id == str(organization_id),
        )
    )
    released = set(released_seat_statuses())
    seated: set[str] = set()
    let_go: set[str] = {str(user_id) for user_id in removed_user_ids}
    for user_id, assignment_status in rows.all():
        if assignment_status in released:
            let_go.add(str(user_id))
        else:
            seated.add(str(user_id))
    let_go -= seated
    if not seated and not let_go:
        return None

    existing = {
        str(rsvp.user_id): rsvp
        for rsvp in (
            await db.execute(
                select(EventRSVP).where(
                    EventRSVP.event_id == str(event.id),
                    EventRSVP.organization_id == str(organization_id),
                    EventRSVP.user_id.in_(seated | let_go),
                )
            )
        ).scalars()
    }
    now = datetime.now(timezone.utc)
    freed = 0
    for user_id in seated:
        rsvp = existing.get(user_id)
        if rsvp is None:
            db.add(
                EventRSVP(
                    organization_id=str(organization_id),
                    event_id=str(event.id),
                    user_id=user_id,
                    status=RSVPStatus.GOING,
                    is_volunteer=True,
                    responded_at=now,
                )
            )
        elif not rsvp.checked_in:
            before = rsvp_seats(rsvp) if rsvp.status == RSVPStatus.GOING else 0
            if rsvp.status != RSVPStatus.GOING:
                rsvp.status = RSVPStatus.GOING
                rsvp.responded_at = now
            rsvp.is_volunteer = True
            freed += before - rsvp_seats(rsvp)
    for user_id in let_go:
        rsvp = existing.get(user_id)
        if rsvp is None or rsvp.checked_in:
            continue
        if rsvp.status == RSVPStatus.GOING:
            freed += rsvp_seats(rsvp)
            rsvp.status = RSVPStatus.NOT_GOING
            rsvp.responded_at = now
        rsvp.is_volunteer = False
    return str(event.id) if freed > 0 and event.max_attendees else None


async def promote_after_sync(
    db: AsyncSession, event_id: Optional[str], organization_id: str
) -> None:
    """Fill seats a committed ``sync_volunteer_rsvps`` freed from the waitlist.

    Looped as ``create_or_update_rsvp`` loops: one release can admit several
    parties, and ``promote_from_waitlist`` stops as soon as the head of the
    queue no longer fits. Never raises into the caller — the seat change it
    follows has already committed.
    """
    if not event_id:
        return
    from app.services.event_service import (
        MAX_WAITLIST_PROMOTIONS_PER_RELEASE,
        EventService,
    )

    service = EventService(db)
    try:
        for _ in range(MAX_WAITLIST_PROMOTIONS_PER_RELEASE):
            if not await service.promote_from_waitlist(event_id, organization_id):
                break
    except Exception as e:
        await db.rollback()
        logger.warning(
            "Could not promote from the waitlist of event {}: {}", event_id, e
        )

"""Credit time worked on a community outreach signup sheet through its event.

Owner decisions, 2026-11-24. A station tour or a school visit is staffed from
the schedule, but the time is community outreach and not shift staffing
(``app/utils/duty_shifts.py`` keeps it out of every shift-hours total). The
hours are credited the way any other attendee's are, through the event the
sheet staffs:

* a volunteer's check-in and check-out on the sheet are mirrored onto their
  RSVP for the event, so the event's own finalize credits them to whatever
  admin hours category the event's type maps to, once;
* a sheet whose request has no event yet waits, and is credited when the
  event exists;
* sheet time that arrives after the event's attendance is finalized is
  credited anyway. That is a deliberate exception to the attendance lock,
  limited to members who have attendance on that event's own sheet: the
  alternative left their hours waiting on a reopen nobody knew to do.

The mirror compares and corrects, so running it twice, or after any change
to the sheet's attendance, settles the same RSVPs and the same ledger entries
(pitfall #36). The entry is keyed on the RSVP, which is what stops a member
who is checked in on both the sheet and the event being counted twice.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event, EventRSVP, RSVPStatus
from app.models.training import Shift, ShiftAttendance


@dataclass
class SheetCreditOutcome:
    """What one run of the mirror did."""

    # The event the sheet staffs, or None while there is none to credit.
    event_id: Optional[str] = None
    # Members with attendance on the sheet.
    volunteers: int = 0
    # RSVPs whose attendance this run changed.
    mirrored: int = 0
    # Admin hours entries created or corrected. Only on an event whose
    # attendance is already finalized; an open event credits at its finalize.
    credited_entries: int = 0
    # Minutes of sheet time now carried on the event's RSVPs.
    minutes: int = 0
    # Whether the event's attendance was already finalized. When it was not,
    # the hours reach the ledger at the event's own finalize.
    finalized: bool = False


@dataclass
class _SheetTime:
    checked_in_at: datetime
    # None while any of the member's sheet records is still open.
    checked_out_at: Optional[datetime]


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


async def _sheet_times(db: AsyncSession, shift_id: str) -> Dict[str, _SheetTime]:
    """Each member's time on the sheet: first check-in to last check-out."""
    rows = await db.execute(
        select(
            ShiftAttendance.user_id,
            ShiftAttendance.checked_in_at,
            ShiftAttendance.checked_out_at,
        ).where(
            ShiftAttendance.shift_id == str(shift_id),
            ShiftAttendance.checked_in_at.is_not(None),
        )
    )
    times: Dict[str, _SheetTime] = {}
    still_open: set[str] = set()
    for user_id, checked_in_at, checked_out_at in rows.all():
        key = str(user_id)
        start = _as_utc(checked_in_at)
        end = _as_utc(checked_out_at)
        if start is None:
            continue
        if end is None:
            still_open.add(key)
        current = times.get(key)
        if current is None:
            times[key] = _SheetTime(start, end)
            continue
        current.checked_in_at = min(current.checked_in_at, start)
        if end is not None and (
            current.checked_out_at is None or end > current.checked_out_at
        ):
            current.checked_out_at = end
    for key in still_open:
        times[key].checked_out_at = None
    return times


def _has_manager_override(rsvp: EventRSVP) -> bool:
    return (
        rsvp.override_check_in_at is not None
        or rsvp.override_check_out_at is not None
        or rsvp.override_duration_minutes is not None
    )


def _mirror(rsvp: EventRSVP, event: Event, sheet: _SheetTime) -> bool:
    """Carry one member's sheet time onto their RSVP. True when it changed."""
    # A manager's correction is a deliberate act by somebody accountable for
    # it, and outranks a tap on either screen.
    if _has_manager_override(rsvp):
        return False

    changed = False
    if rsvp.status != RSVPStatus.GOING:
        rsvp.status = RSVPStatus.GOING
        changed = True
    if not rsvp.is_volunteer:
        rsvp.is_volunteer = True
        changed = True

    if sheet.checked_out_at is None:
        # Still on the clock. Mark them present, and leave an event check-in
        # they already have alone until the sheet has a complete record.
        if not rsvp.checked_in:
            rsvp.checked_in = True
            rsvp.checked_in_at = sheet.checked_in_at
            changed = True
        return changed

    # Credit runs from the scheduled start, as it does for any check-in
    # (EventService._credited_check_in_time): the stored duration has to match
    # the window the ledger entry records.
    scheduled_start = _as_utc(event.start_datetime)
    counted_from = (
        max(sheet.checked_in_at, scheduled_start)
        if scheduled_start is not None
        else sheet.checked_in_at
    )
    minutes = max(0, int((sheet.checked_out_at - counted_from).total_seconds() / 60))
    wanted = {
        "checked_in": True,
        "checked_in_at": sheet.checked_in_at,
        "checked_out_at": sheet.checked_out_at,
        "attendance_duration_minutes": minutes,
    }
    for field, value in wanted.items():
        current = getattr(rsvp, field)
        if isinstance(current, datetime):
            current = _as_utc(current)
        if current != value:
            setattr(rsvp, field, value)
            changed = True
    return changed


async def event_sheet_id(db: AsyncSession, event: Event) -> Optional[str]:
    """The signup sheet that staffs this event: its request's, or its own."""
    from app.services.event_staffing_service import linked_request

    request = await linked_request(db, event)
    if request is not None:
        return str(request.staffing_shift_id) if request.staffing_shift_id else None
    return str(event.staffing_shift_id) if event.staffing_shift_id else None


async def sync_sheet_attendance(
    db: AsyncSession, shift_id: str, organization_id: str
) -> SheetCreditOutcome:
    """Make the event's attendance agree with who worked its signup sheet.

    Does nothing for a duty shift, for a sheet with no event yet, or for a
    cancelled event. The caller commits.
    """
    from app.services.event_service import EventService, attendance_is_finalized
    from app.services.event_staffing_service import sheet_event

    outcome = SheetCreditOutcome()
    is_outreach = await db.scalar(
        select(Shift.is_outreach).where(
            Shift.id == str(shift_id),
            Shift.organization_id == str(organization_id),
        )
    )
    if not is_outreach:
        return outcome

    found = await sheet_event(db, str(shift_id), str(organization_id))
    if found is None:
        return outcome
    # The event's row lock is what every attendance writer takes, finalize
    # included, so the mirror cannot interleave with one.
    event = (
        await db.execute(
            select(Event)
            .where(
                Event.id == str(found.id),
                Event.organization_id == str(organization_id),
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if event is None or event.is_cancelled:
        return outcome
    outcome.event_id = str(event.id)

    events = EventService(db)
    finalized = attendance_is_finalized(event)
    outcome.finalized = finalized
    # A finalized Training event has already written training records from its
    # RSVPs; changing them now would leave the two disagreeing.
    if finalized and events.event_credits_training(event):
        return outcome

    times = await _sheet_times(db, str(shift_id))
    outcome.volunteers = len(times)
    if not times:
        return outcome

    # A locking read: the event lock serializes the writers, but a plain
    # SELECT would answer from the snapshot taken before this waited for it
    # (pitfall #27).
    rsvps = {
        str(rsvp.user_id): rsvp
        for rsvp in (
            await db.execute(
                select(EventRSVP)
                .where(
                    EventRSVP.event_id == str(event.id),
                    EventRSVP.organization_id == str(organization_id),
                    EventRSVP.user_id.in_(list(times)),
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalars()
    }

    now = datetime.now(timezone.utc)
    present: List[EventRSVP] = []
    for user_id, sheet in times.items():
        rsvp = rsvps.get(user_id)
        if rsvp is None:
            # Checked in on the sheet without holding a seat on it, so the
            # seat sync never made them an RSVP.
            rsvp = EventRSVP(
                organization_id=str(organization_id),
                event_id=str(event.id),
                user_id=user_id,
                status=RSVPStatus.GOING,
                is_volunteer=True,
                responded_at=now,
            )
            db.add(rsvp)
        if _mirror(rsvp, event, sheet):
            outcome.mirrored += 1
        if rsvp.checked_in:
            present.append(rsvp)
            outcome.minutes += int(rsvp.attendance_duration_minutes or 0)

    if finalized:
        effective_end = events.effective_end(event)
        if effective_end is not None:
            # New RSVPs need their ids before the ledger can key on them.
            await db.flush()
            for rsvp in present:
                outcome.credited_entries += await events.credit_admin_hours_for_rsvp(
                    event, rsvp, effective_end
                )
    return outcome


@dataclass
class CatchUpSummary:
    """What crediting every outreach sheet's recorded time does, or would do."""

    # Sheets with recorded time.
    sheets: int = 0
    # Of those, sheets whose request has no event yet. Nothing to credit until
    # it does.
    sheets_waiting_for_event: int = 0
    # Sheets whose event is still open; their hours are credited when an
    # officer ends the event.
    sheets_awaiting_finalize: int = 0
    volunteers: int = 0
    # RSVPs changed, and ledger entries created or corrected.
    attendance_updated: int = 0
    entries_credited: int = 0
    minutes: int = 0


async def catch_up_outreach_sheets(
    db: AsyncSession, organization_id: str, *, dry_run: bool
) -> CatchUpSummary:
    """Run the mirror over every outreach sheet that has recorded time.

    The officer-run catch-up for sheets worked before sheet time was credited
    through the event (owner decision, 2026-11-24). It is the same
    compare-and-correct the attendance writers run, so pressing it twice
    credits nothing twice (pitfall #36).

    ``dry_run`` reports what a run would do without keeping any of it: each
    sheet is settled inside a savepoint that is then rolled back, so the
    preview is produced by the code that would do the work and cannot drift
    from it. A real run commits sheet by sheet, so one sheet's failure does
    not discard the others.
    """
    has_time = (
        select(ShiftAttendance.id)
        .where(
            ShiftAttendance.shift_id == Shift.id,
            ShiftAttendance.checked_in_at.is_not(None),
        )
        .exists()
    )
    sheet_ids = [
        str(sheet_id)
        for sheet_id in (
            await db.execute(
                select(Shift.id)
                .where(
                    Shift.organization_id == str(organization_id),
                    Shift.is_outreach.is_(True),
                    has_time,
                )
                .order_by(Shift.shift_date)
            )
        ).scalars()
    ]

    summary = CatchUpSummary(sheets=len(sheet_ids))
    for sheet_id in sheet_ids:
        savepoint = await db.begin_nested() if dry_run else None
        try:
            outcome = await sync_sheet_attendance(db, sheet_id, str(organization_id))
            if savepoint is None:
                await db.commit()
        finally:
            if savepoint is not None:
                await savepoint.rollback()
        if outcome.event_id is None:
            summary.sheets_waiting_for_event += 1
            continue
        if not outcome.finalized:
            summary.sheets_awaiting_finalize += 1
        summary.volunteers += outcome.volunteers
        summary.attendance_updated += outcome.mirrored
        summary.entries_credited += outcome.credited_entries
        summary.minutes += outcome.minutes
    return summary

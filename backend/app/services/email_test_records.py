"""
The department's own records, for a test email that should look real.

``live_sample_context`` makes a test email's links, department details,
recipient and dates real. What it cannot make real is the thing the notice is
*about* — the event, the shift — so a test reminder named "Monthly Business
Meeting" and linked to an event that does not exist. Here, when the
department has a suitable record, the test uses it: its next upcoming event
for an event reminder, its next scheduled shift for a shift notice. With
none, the sample stays, so a new department still gets a complete test.

Each builder mirrors the sender that sends that notice for real, field for
field and format for format, and names it; when a sender changes how it
formats a value, change the builder beside it, or the test email stops
telling the truth about the real one. Only notices with a template-based
sender are covered: ``event_cancellation``, ``post_event_validation`` and
``post_shift_validation`` have no sender that renders their template.

The values here override the samples but not what an admin typed into the
preview's own fields, and nothing here is ever sent anywhere but to the
admin who asked for the test.
"""

import html as _html
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, Optional

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.event import Event
from app.models.training import BasicApparatus, Shift, ShiftStatus
from app.utils.org_timezone import format_in_org_timezone, scheduling_timezone


def _base_url() -> str:
    return (settings.FRONTEND_URL or "").rstrip("/")


def _label(value: Any, fallback: str) -> str:
    raw = getattr(value, "value", value)
    return str(raw).replace("_", " ").title() if raw else fallback


async def _next_event(
    db: AsyncSession, organization_id: str, now: datetime
) -> Optional[Event]:
    # The events run_event_reminders reminds about: upcoming, not cancelled,
    # not a draft.
    result = await db.execute(
        select(Event)
        .where(
            Event.organization_id == str(organization_id),
            Event.is_cancelled.is_(False),
            or_(Event.is_draft.is_(None), Event.is_draft.is_(False)),
            Event.start_datetime > now,
        )
        .options(selectinload(Event.location_obj))
        .order_by(Event.start_datetime.asc())
        .limit(1)
    )
    event: Optional[Event] = result.scalar_one_or_none()
    return event


async def _event_reminder(
    db: AsyncSession, organization: Any, now: datetime
) -> Dict[str, str]:
    """As ``run_event_reminders`` and ``EmailService.send_event_reminder``."""
    event = await _next_event(db, organization.id, now)
    if event is None:
        return {}
    start, end = event.start_datetime, event.end_datetime
    location = event.location_obj.name if event.location_obj else (event.location or "")
    return {
        "event_title": event.title,
        "event_type": _label(event.event_type, "Event"),
        "event_start": format_in_org_timezone(start, organization),
        "event_end": format_in_org_timezone(end, organization, "%I:%M %p"),
        "event_month": format_in_org_timezone(start, organization, "%b"),
        "event_day": format_in_org_timezone(start, organization, "%d").lstrip("0"),
        "location_name": location or "",
        "location_details": event.location_details or "",
        "event_url": f"{settings.FRONTEND_URL}/events/{event.id}",
    }


async def _series_end_reminder(
    db: AsyncSession, organization: Any, now: datetime
) -> Dict[str, str]:
    """As ``run_series_end_reminders``: the next recurring series to end."""
    result = await db.execute(
        select(Event)
        .where(
            Event.organization_id == str(organization.id),
            Event.is_recurring.is_(True),
            Event.is_cancelled.is_(False),
            Event.recurrence_parent_id.is_(None),
            Event.recurrence_end_date > now,
        )
        .order_by(Event.recurrence_end_date.asc())
        .limit(1)
    )
    series = result.scalar_one_or_none()
    if series is None:
        return {}
    upcoming_children = await db.execute(
        select(func.count(Event.id)).where(
            Event.organization_id == str(organization.id),
            Event.recurrence_parent_id == series.id,
            Event.is_cancelled.is_(False),
            Event.start_datetime > now,
        )
    )
    remaining = int(upcoming_children.scalar_one() or 0)
    parent_start = series.start_datetime
    if parent_start is not None and parent_start.tzinfo is None:
        parent_start = parent_start.replace(tzinfo=timezone.utc)
    if parent_start is not None and parent_start > now:
        remaining += 1
    return {
        "event_title": series.title,
        "recurrence_pattern": _label(series.recurrence_pattern, "Unknown"),
        "series_end_date": format_in_org_timezone(
            series.recurrence_end_date, organization, "%B %d, %Y"
        ),
        "remaining_occurrences": str(remaining),
        "event_url": f"{settings.FRONTEND_URL}/events/{series.id}",
    }


async def _next_shift(
    db: AsyncSession, organization_id: str, now: datetime
) -> Optional[Shift]:
    result = await db.execute(
        select(Shift)
        .where(
            Shift.organization_id == str(organization_id),
            Shift.status != ShiftStatus.CANCELLED,
            Shift.start_time > now,
        )
        .order_by(Shift.start_time.asc())
        .limit(1)
    )
    shift: Optional[Shift] = result.scalar_one_or_none()
    return shift


def _shift_clock(value: Optional[datetime], organization: Any) -> str:
    if value is None:
        return ""
    aware = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return aware.astimezone(scheduling_timezone(organization)).strftime("%H:%M")


async def _apparatus_name(
    db: AsyncSession, organization_id: str, apparatus_id: Optional[str]
) -> str:
    if not apparatus_id:
        return ""
    result = await db.execute(
        select(BasicApparatus.unit_number, BasicApparatus.name).where(
            BasicApparatus.id == str(apparatus_id),
            BasicApparatus.organization_id == str(organization_id),
        )
    )
    row = result.first()
    if row is None:
        return ""
    unit_number, name = row
    return f"{unit_number} — {name}" if unit_number else name


async def _shift_reminder(
    db: AsyncSession, organization: Any, now: datetime
) -> Dict[str, str]:
    """As ``run_shift_reminders``. The crew and checklists stay sample."""
    shift = await _next_shift(db, organization.id, now)
    if shift is None:
        return {}
    start = _shift_clock(shift.start_time, organization)
    end = _shift_clock(shift.end_time, organization)
    apparatus = await _apparatus_name(db, organization.id, shift.apparatus_id)
    return {
        "shift_date": (
            shift.shift_date.strftime("%b %d, %Y") if shift.shift_date else "Unknown"
        ),
        "shift_start": start,
        "time_range": f"{start} – {end}" if end else start,
        "apparatus_name": apparatus,
        "apparatus_html": (
            f"<p><strong>Apparatus:</strong> {_html.escape(apparatus)}</p>"
            if apparatus
            else ""
        ),
        "apparatus_text": f"Apparatus: {apparatus}" if apparatus else "",
        "arrival_url": (f"{settings.FRONTEND_URL}/scheduling/checkin?shift={shift.id}"),
    }


async def _shift_assignment(
    db: AsyncSession, organization: Any, now: datetime
) -> Dict[str, str]:
    """As ``SchedulingService._notify_shift_assignment``."""
    shift = await _next_shift(db, organization.id, now)
    if shift is None:
        return {}
    return {
        # The real notice prints the ISO date; the test shows what it shows.
        "shift_date": (
            shift.shift_date.isoformat() if shift.shift_date else "unknown date"
        ),
        "shift_start": _shift_clock(shift.start_time, organization)
        or "See the schedule",
        "shift_url": f"{_base_url()}/scheduling?shift={shift.id}",
    }


async def _shift_decline(
    db: AsyncSession, organization: Any, now: datetime
) -> Dict[str, str]:
    """As ``SchedulingService._notify_shift_decline``."""
    shift = await _next_shift(db, organization.id, now)
    if shift is None:
        return {}
    return {
        "shift_date": (
            shift.shift_date.isoformat() if shift.shift_date else "unknown date"
        ),
        "shift_url": f"{_base_url()}/scheduling?shift={shift.id}",
    }


_BUILDERS: Dict[
    str, Callable[[AsyncSession, Any, datetime], Awaitable[Dict[str, str]]]
] = {
    "event_reminder": _event_reminder,
    "series_end_reminder": _series_end_reminder,
    "shift_reminder": _shift_reminder,
    "shift_assignment": _shift_assignment,
    "shift_decline": _shift_decline,
}

# The template types a test can fill from a real record.
REAL_RECORD_TEMPLATE_TYPES = frozenset(_BUILDERS)


async def real_record_context(
    db: AsyncSession,
    template_type: str,
    organization: Optional[Any],
    now: Optional[datetime] = None,
) -> Dict[str, str]:
    """Values from the department's own next record for *template_type*.

    Empty when the type has no builder, there is no organization, or the
    department has no suitable record — the caller keeps its samples.
    """
    builder = _BUILDERS.get(template_type)
    if builder is None or organization is None:
        return {}
    return await builder(db, organization, now or datetime.now(timezone.utc))

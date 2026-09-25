"""
One answer to "what timezone is this department in".

Scheduling reads the organization's timezone in several places — generating
shifts from a pattern's local start times, and deciding whether a stored UTC
start is a day or a night shift. Those have to agree: a service that falls
back to UTC while its neighbour falls back to a US Eastern default will call
the same 23:00Z row a day shift in one code path and a night shift in the
other, for exactly the organizations that never set a timezone.

The fallback is ``America/New_York`` because that is what shift generation has
always used, and generation writes real timestamps — changing it would move
existing departments' shift times.
"""

from datetime import date, datetime, time, timezone
from typing import Optional
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Organization

DEFAULT_SCHEDULING_TIMEZONE = "America/New_York"


def scheduling_timezone(organization: Optional[Organization]) -> ZoneInfo:
    """The organization's timezone, or the scheduling default."""
    name = getattr(organization, "timezone", None) if organization else None
    try:
        return ZoneInfo(name or DEFAULT_SCHEDULING_TIMEZONE)
    except Exception:
        # A timezone typed into org settings by hand can be nonsense. Falling
        # back beats raising out of a scheduled task that would otherwise take
        # out the whole organization's shift generation.
        return ZoneInfo(DEFAULT_SCHEDULING_TIMEZONE)


def format_in_org_timezone(
    value: datetime,
    organization: Optional[Organization],
    fmt: str = "%B %d, %Y at %I:%M %p",
) -> str:
    """Render a stored timestamp as wall-clock time in the department's zone.

    Timestamps are stored as UTC, and MySQL hands some of them back naive, so
    a naive value is read as UTC rather than as local time. Emails have no
    browser to localize for the reader, so this is the only conversion an
    emailed time ever gets.
    """
    aware = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return aware.astimezone(scheduling_timezone(organization)).strftime(fmt)


async def resolve_scheduling_timezone(
    db: AsyncSession, organization_id: UUID | str
) -> ZoneInfo:
    """Load the organization and resolve its scheduling timezone."""
    result = await db.execute(
        select(Organization).where(Organization.id == str(organization_id))
    )
    return scheduling_timezone(result.scalar_one_or_none())


def org_today(organization: Optional[Organization]) -> date:
    """Today's date on the department's calendar.

    ``date.today()`` is the server's date, and a container runs in UTC, which
    is already tomorrow for a US department every evening. Anything that
    counts days, picks "last month", or decides expired-versus-not has to ask
    the department's calendar instead.
    """
    return today_in(scheduling_timezone(organization))


def today_in(tz: ZoneInfo) -> date:
    """Today's date in ``tz``, for a caller that has already resolved it."""
    return datetime.now(tz).date()


async def resolve_org_today(db: AsyncSession, organization_id: UUID | str) -> date:
    """Load the organization and return today's date in its timezone."""
    return today_in(await resolve_scheduling_timezone(db, organization_id))


def local_day_start_utc(day: date, tz: ZoneInfo) -> datetime:
    """The UTC instant at which ``day`` begins on the department's calendar.

    A date filter against a UTC timestamp column has to be bounded by the
    department's midnight, not UTC's, or an evening row is filed under the
    next day.
    """
    return datetime.combine(day, time.min, tz).astimezone(timezone.utc)

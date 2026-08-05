"""
Relative-schedule date math for multi-class courses.

A course syllabus describes *when* each class happens relative to the course
start ("class B is the day after class A; class C two days later"). Turning that
into real calendar datetimes needs three things this module provides:

1. offset -> date resolution, honouring weekend / blackout skipping,
2. meeting-pattern autofill ("Tuesdays and Thursdays") -> per-class offsets,
3. a US federal holiday set to pre-fill the blackout picker.

Everything here is pure: no DB, no I/O. That keeps the tricky parts (DST,
weekend rolls, holiday collisions) unit-testable without fixtures.

Times are handled as **local wall clock** and converted to UTC at the end. That
ordering matters: a recruit school that meets at 19:00 and spans the November
DST change must stay at 19:00 local on both sides, which it only does if the
clock time is applied in the organization's timezone before conversion.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Iterable, Optional, Sequence
from zoneinfo import ZoneInfo

DEFAULT_TIMEZONE = "America/New_York"
DEFAULT_START_TIME = "09:00"
DEFAULT_DURATION_MINUTES = 60

# Guards against a pathological syllabus (or a blackout list that swallows every
# candidate day) spinning the roll loop forever.
MAX_ROLL_DAYS = 366
MAX_PATTERN_SEARCH_DAYS = 3650

SATURDAY = 5
SUNDAY = 6


def parse_hhmm(value: Optional[str], fallback: str = DEFAULT_START_TIME) -> time:
    """Parse a ``"HH:MM"`` wall-clock string, falling back on bad input.

    Stored times come from a quarter-hour picker, but legacy or imported rows
    may hold anything; a malformed value must not break schedule generation.
    """
    candidate = (value or "").strip() or fallback
    try:
        hour_str, _, minute_str = candidate.partition(":")
        hour = int(hour_str)
        minute = int(minute_str)
        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            raise ValueError(candidate)
        return time(hour=hour, minute=minute)
    except (TypeError, ValueError):
        hour_str, _, minute_str = fallback.partition(":")
        return time(hour=int(hour_str), minute=int(minute_str))


def parse_blackout_dates(values: Optional[Iterable[str]]) -> set[date]:
    """Convert a JSON list of ISO date strings into a set of dates.

    Unparseable entries are dropped rather than raising: a stray value in a
    stored JSON column should not make an entire cohort ungeneratable.
    """
    result: set[date] = set()
    for raw in values or []:
        if isinstance(raw, date) and not isinstance(raw, datetime):
            result.add(raw)
            continue
        try:
            result.add(date.fromisoformat(str(raw)[:10]))
        except (TypeError, ValueError):
            continue
    return result


def normalize_meeting_days(values: Optional[Sequence[int]]) -> list[int]:
    """Return a sorted, de-duplicated list of weekday numbers (0=Monday)."""
    if not values:
        return []
    days = {int(v) for v in values if isinstance(v, (int, float)) and 0 <= int(v) <= 6}
    return sorted(days)


def is_blocked(
    candidate: date,
    roll_policy: str,
    meeting_days: Sequence[int],
    blackout_dates: set[date],
) -> bool:
    """Whether ``candidate`` must be rolled forward under the given policy."""
    if candidate in blackout_dates:
        return True
    if roll_policy == "next_business_day":
        return candidate.weekday() in (SATURDAY, SUNDAY)
    if roll_policy == "next_meeting_day":
        # With no pattern configured there is nothing to align to, so only the
        # blackout check above applies.
        return bool(meeting_days) and candidate.weekday() not in meeting_days
    return False


def roll_date(
    candidate: date,
    roll_policy: str,
    meeting_days: Sequence[int],
    blackout_dates: set[date],
) -> date:
    """Advance ``candidate`` to the first day the policy permits."""
    if roll_policy == "none" and candidate not in blackout_dates:
        return candidate

    rolled = candidate
    for _ in range(MAX_ROLL_DAYS):
        if not is_blocked(rolled, roll_policy, meeting_days, blackout_dates):
            return rolled
        rolled += timedelta(days=1)
    # Every day in a year was blocked — the configuration is unusable, but
    # returning the original date beats hanging or raising deep in generation.
    return candidate


def offsets_from_meeting_pattern(
    class_count: int,
    meeting_days: Sequence[int],
    blackout_dates: Optional[Iterable[str]] = None,
    start_weekday: int = 0,
) -> list[int]:
    """Derive per-class day offsets from a weekly meeting pattern.

    "Fifteen classes, Tuesdays and Thursdays" becomes ``[0, 2, 7, 9, 14, ...]``
    counted from a course start on ``start_weekday``. Blackout dates cannot be
    honoured here (offsets are start-date agnostic), so callers that need
    holiday-aware dates should rely on the roll policy at resolution time; the
    parameter is accepted so the signature stays stable if that changes.
    """
    normalized = normalize_meeting_days(meeting_days)
    if class_count <= 0:
        return []
    if not normalized:
        return list(range(class_count))

    offsets: list[int] = []
    offset = 0
    weekday = start_weekday % 7
    searched = 0
    while len(offsets) < class_count and searched < MAX_PATTERN_SEARCH_DAYS:
        if weekday in normalized:
            offsets.append(offset)
        offset += 1
        weekday = (weekday + 1) % 7
        searched += 1
    return offsets


def resolve_class_datetimes(
    start_date: date,
    day_offset: int,
    start_time: Optional[str],
    duration_minutes: Optional[int],
    tz_name: Optional[str] = None,
    roll_policy: str = "none",
    meeting_days: Optional[Sequence[int]] = None,
    blackout_dates: Optional[Iterable[str]] = None,
    default_start_time: Optional[str] = None,
    default_duration_minutes: Optional[int] = None,
) -> tuple[datetime, datetime, Optional[str]]:
    """Resolve one syllabus row into concrete UTC start/end datetimes.

    Returns ``(start_utc, end_utc, warning)`` where ``warning`` describes a date
    that had to be moved, so the preview can show the officer what happened
    before anything is created.
    """
    try:
        tz = ZoneInfo(tz_name or DEFAULT_TIMEZONE)
    except Exception:
        tz = ZoneInfo(DEFAULT_TIMEZONE)

    normalized_days = normalize_meeting_days(meeting_days)
    blackouts = parse_blackout_dates(blackout_dates)

    target = start_date + timedelta(days=max(0, int(day_offset or 0)))
    rolled = roll_date(target, roll_policy or "none", normalized_days, blackouts)

    warning: Optional[str] = None
    if rolled != target:
        if target in blackouts:
            reason = "a blackout date"
        elif roll_policy == "next_business_day":
            reason = "a weekend"
        else:
            reason = "not a meeting day"
        warning = (
            f"Moved from {target.isoformat()} to {rolled.isoformat()} — "
            f"{target.isoformat()} is {reason}."
        )

    clock = parse_hhmm(start_time, default_start_time or DEFAULT_START_TIME)
    minutes = (
        int(duration_minutes)
        if duration_minutes
        else int(default_duration_minutes or DEFAULT_DURATION_MINUTES)
    )
    minutes = max(1, minutes)

    local_start = datetime.combine(rolled, clock, tzinfo=tz)
    local_end = local_start + timedelta(minutes=minutes)
    return (
        local_start.astimezone(timezone.utc),
        local_end.astimezone(timezone.utc),
        warning,
    )


def _nth_weekday(year: int, month: int, weekday: int, ordinal: int) -> date:
    """Date of the ``ordinal``-th ``weekday`` of a month (``-1`` = last)."""
    if ordinal > 0:
        first = date(year, month, 1)
        delta = (weekday - first.weekday()) % 7
        return first + timedelta(days=delta + 7 * (ordinal - 1))

    if month == 12:
        last = date(year, 12, 31)
    else:
        last = date(year, month + 1, 1) - timedelta(days=1)
    delta = (last.weekday() - weekday) % 7
    return last - timedelta(days=delta)


def _observed(day: date) -> date:
    """Federal observance rule: Saturday -> Friday, Sunday -> Monday."""
    if day.weekday() == SATURDAY:
        return day - timedelta(days=1)
    if day.weekday() == SUNDAY:
        return day + timedelta(days=1)
    return day


def us_federal_holidays(year: int) -> set[date]:
    """US federal holidays for ``year``, with weekend observance applied.

    Used only to pre-fill the cohort blackout-date picker — departments edit the
    list freely, so this is a convenience, not a policy. Kept as a small local
    helper rather than a new dependency.
    """
    fixed = [
        date(year, 1, 1),  # New Year's Day
        date(year, 6, 19),  # Juneteenth
        date(year, 7, 4),  # Independence Day
        date(year, 11, 11),  # Veterans Day
        date(year, 12, 25),  # Christmas Day
    ]
    floating = [
        _nth_weekday(year, 1, 0, 3),  # MLK Day — 3rd Monday of January
        _nth_weekday(year, 2, 0, 3),  # Presidents' Day — 3rd Monday of February
        _nth_weekday(year, 5, 0, -1),  # Memorial Day — last Monday of May
        _nth_weekday(year, 9, 0, 1),  # Labor Day — 1st Monday of September
        _nth_weekday(year, 10, 0, 2),  # Columbus Day — 2nd Monday of October
        _nth_weekday(year, 11, 3, 4),  # Thanksgiving — 4th Thursday of November
    ]
    return {_observed(d) for d in fixed} | set(floating)


def us_federal_holidays_between(start: date, end: date) -> list[date]:
    """Sorted federal holidays falling within ``[start, end]`` inclusive."""
    if end < start:
        return []
    days: set[date] = set()
    for year in range(start.year, end.year + 1):
        days |= us_federal_holidays(year)
    return sorted(d for d in days if start <= d <= end)

#!/usr/bin/env python3
"""
List recurring event series that the pre-W18 defects may have left wrong (W18-3).

Report only — this script writes nothing. The owner chose to have officers fix
affected series by hand rather than regenerate them, because a regeneration
moves events members have already RSVP'd to.

What it looks for
-----------------
Two defects fixed in workflow review W18 wrote wrong occurrence times, and the
fix corrects new series and later edits only:

1. **Stepped in UTC** (W18-1). ``_generate_recurrence_dates`` stepped the
   stored UTC instant, so a series spanning a daylight-saving change sits an
   hour off after it, and an evening series with custom weekdays, an
   Nth-weekday pattern or skip dates could land a day late. Reported as an
   occurrence **1 hour off** or **1 day off** the date the series' own pattern
   gives today.
2. **Collapsed** (W18-2). "This and all future events" copied the anchor's
   start onto every later occurrence. Reported as **several occurrences at one
   start time**, with the dates the pattern expects that no occurrence holds —
   the dates the collapsed ones belonged on. Those dates are not recoverable
   from the occurrence rows, only from the parent's stored pattern, which is
   what the expected dates are generated from.

Every occurrence is compared with the dates the series' parent and its stored
pattern produce under the fixed generator, in the department's timezone.
Occurrences moved by some other amount are not listed unless
``--all-differences`` is given: an officer moving one session by 30 minutes is
an edit, not a defect. A deliberate move of exactly an hour or a day will
still be listed; the report says "may", and the officer decides.

By default only occurrences that have not started are considered — past ones
are history. ``--include-past`` lists those too. Each listed occurrence shows
how many members have RSVP'd, since those are the members a fix will move.

Usage:

    docker exec -it intranet-backend python scripts/report_recurring_series_drift.py
    docker exec -it intranet-backend python scripts/report_recurring_series_drift.py \\
        --org "Falls Church" --include-past

Exit codes:
    0 — report printed (whether or not anything was found)
    2 — database connection error or unhandled exception
"""

import argparse
import asyncio
import os
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Sequence

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import func, or_, select  # noqa: E402

from app.core.database import (  # noqa: E402
    async_session_factory,
    database_manager,
)
from app.models.event import Event, EventRSVP  # noqa: E402
from app.models.user import Organization  # noqa: E402
from app.services.event_service import EventService  # noqa: E402
from app.utils.org_timezone import scheduling_timezone  # noqa: E402

HOUR = timedelta(hours=1)
DAY = timedelta(days=1)


def _utc(value: datetime) -> datetime:
    """MySQL hands back naive datetimes that are already UTC."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


@dataclass
class Occurrence:
    event_id: str
    start: datetime
    is_cancelled: bool = False
    rsvp_count: int = 0


@dataclass
class Finding:
    kind: str  # "hour", "day", "other"
    occurrence: Occurrence
    expected: datetime
    offset: timedelta


@dataclass
class SeriesReport:
    parent_id: str
    title: str
    organization: str
    pattern: str
    findings: List[Finding] = field(default_factory=list)
    collapsed: Dict[datetime, List[Occurrence]] = field(default_factory=dict)
    unoccupied: List[datetime] = field(default_factory=list)

    @property
    def has_issues(self) -> bool:
        return bool(self.findings or self.collapsed)


def classify(offset: timedelta) -> str:
    """Name the defect an offset from the expected start looks like.

    A day-late occurrence that also crossed a clock change is 23 or 25 hours
    off, so "day" allows an hour either side.
    """
    size = abs(offset)
    if size == HOUR:
        return "hour"
    if DAY - HOUR <= size <= DAY + HOUR:
        return "day"
    return "other"


def analyse_series(
    occurrences: Sequence[Occurrence],
    expected_starts: Sequence[datetime],
    now: datetime,
    include_past: bool,
    all_differences: bool,
) -> tuple:
    """Return (findings, collapsed, unoccupied) for one series.

    Pure: *occurrences* and *expected_starts* are aware UTC datetimes.
    """
    expected = sorted(set(expected_starts))
    expected_set = set(expected)
    considered = [o for o in occurrences if include_past or o.start >= now]

    by_start: Dict[datetime, List[Occurrence]] = defaultdict(list)
    for occurrence in considered:
        if not occurrence.is_cancelled:
            by_start[occurrence.start].append(occurrence)
    collapsed = {start: group for start, group in by_start.items() if len(group) > 1}
    collapsed_ids = {o.event_id for group in collapsed.values() for o in group}

    findings: List[Finding] = []
    if expected:
        for occurrence in considered:
            if occurrence.event_id in collapsed_ids:
                continue
            if occurrence.start in expected_set:
                continue
            nearest = min(expected, key=lambda moment: abs(moment - occurrence.start))
            offset = occurrence.start - nearest
            kind = classify(offset)
            if kind == "other" and not all_differences:
                continue
            findings.append(Finding(kind, occurrence, nearest, offset))

    unoccupied: List[datetime] = []
    if collapsed:
        occupied = {o.start for o in occurrences}
        earliest = min(collapsed)
        unoccupied = [
            moment
            for moment in expected
            if moment > earliest
            and moment not in occupied
            and (include_past or moment >= now)
        ]
    return findings, collapsed, unoccupied


async def build_reports(
    db,
    org_filter: Optional[str] = None,
    include_past: bool = False,
    all_differences: bool = False,
    now: Optional[datetime] = None,
) -> List[SeriesReport]:
    now = now or datetime.now(timezone.utc)
    orgs = (await db.execute(select(Organization))).scalars().all()
    if org_filter:
        needle = org_filter.strip().lower()
        orgs = [
            o
            for o in orgs
            if str(o.id) == org_filter or needle in (o.name or "").lower()
        ]
        if not orgs:
            raise SystemExit(f"No organization matched {org_filter!r}")

    service = EventService(db)
    reports: List[SeriesReport] = []
    for org in orgs:
        tz = scheduling_timezone(org)
        parents = (
            (
                await db.execute(
                    select(Event)
                    .where(Event.organization_id == str(org.id))
                    .where(Event.is_recurring.is_(True))
                    .where(Event.recurrence_parent_id.is_(None))
                    .where(Event.recurrence_pattern.isnot(None))
                    .order_by(Event.start_datetime)
                )
            )
            .scalars()
            .all()
        )
        for parent in parents:
            rows = (
                await db.execute(
                    select(Event.id, Event.start_datetime, Event.is_cancelled)
                    .where(Event.organization_id == str(org.id))
                    .where(
                        or_(
                            Event.id == parent.id,
                            Event.recurrence_parent_id == parent.id,
                        )
                    )
                    .order_by(Event.start_datetime, Event.id)
                )
            ).all()
            if len(rows) < 2:
                continue
            counts = dict(
                (
                    await db.execute(
                        select(EventRSVP.event_id, func.count(EventRSVP.id))
                        .where(EventRSVP.event_id.in_([r.id for r in rows]))
                        .group_by(EventRSVP.event_id)
                    )
                ).all()
            )
            occurrences = [
                Occurrence(
                    event_id=str(r.id),
                    start=_utc(r.start_datetime),
                    is_cancelled=bool(r.is_cancelled),
                    rsvp_count=int(counts.get(r.id, 0)),
                )
                for r in rows
            ]
            horizon = max(o.start for o in occurrences)
            if parent.recurrence_end_date is not None:
                horizon = max(horizon, _utc(parent.recurrence_end_date))
            expected = [
                _utc(start)
                for start, _end in service._generate_recurrence_dates(
                    timezone_=tz,
                    start_datetime=_utc(parent.start_datetime),
                    end_datetime=_utc(parent.end_datetime),
                    pattern=parent.recurrence_pattern.value,
                    recurrence_end_date=horizon,
                    custom_days=parent.recurrence_custom_days,
                    weekday=parent.recurrence_weekday,
                    week_ordinal=parent.recurrence_week_ordinal,
                    month=parent.recurrence_month,
                    exceptions=parent.recurrence_exceptions,
                )
            ]
            findings, collapsed, unoccupied = analyse_series(
                occurrences, expected, now, include_past, all_differences
            )
            report = SeriesReport(
                parent_id=str(parent.id),
                title=parent.title,
                organization=org.name or str(org.id),
                pattern=parent.recurrence_pattern.value,
                findings=findings,
                collapsed=collapsed,
                unoccupied=unoccupied,
            )
            if report.has_issues:
                reports.append(report)
    return reports


_KIND_LABEL = {
    "hour": "1 hour off — may be the daylight-saving defect",
    "day": "1 day off — may be the UTC-weekday defect",
    "other": "moved — probably edited by hand",
}


def _fmt(moment: datetime, tz) -> str:
    return moment.astimezone(tz).strftime("%a %b %d, %Y %I:%M %p %Z")


def print_reports(reports: List[SeriesReport], tz_for) -> None:
    bar = "=" * 78
    print(bar)
    print("RECURRING SERIES THE PRE-W18 DEFECTS MAY HAVE LEFT WRONG  (report only)")
    print(bar)
    if not reports:
        print("\nNothing found.")
        print(f"\n{bar}")
        return
    for report in reports:
        tz = tz_for(report.organization)
        print(
            f"\n{report.organization} / {report.title}  [{report.pattern}]"
            f"\n  series={report.parent_id}"
        )
        for start, group in sorted(report.collapsed.items()):
            print(
                f"  COLLAPSED: {len(group)} occurrences all at {_fmt(start, tz)}"
                f" ({sum(o.rsvp_count for o in group)} RSVPs)"
            )
            for occurrence in group:
                print(f"    event={occurrence.event_id}  RSVPs={occurrence.rsvp_count}")
        if report.unoccupied:
            print("  Pattern dates with no occurrence (where they likely belong):")
            for moment in report.unoccupied:
                print(f"    {_fmt(moment, tz)}")
        for finding in report.findings:
            occurrence = finding.occurrence
            status = " (cancelled)" if occurrence.is_cancelled else ""
            print(
                f"  {_KIND_LABEL[finding.kind]}{status}\n"
                f"    event={occurrence.event_id}  RSVPs={occurrence.rsvp_count}\n"
                f"    stored   {_fmt(occurrence.start, tz)}\n"
                f"    expected {_fmt(finding.expected, tz)}"
            )
    print(f"\n{bar}")
    print(f"{len(reports)} series to review. Nothing was changed.")
    print(bar)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Report recurring event series that the pre-W18 defects may have "
            "left an hour off, a day off, or collapsed onto one date. Writes "
            "nothing."
        )
    )
    parser.add_argument(
        "--org",
        metavar="ID_OR_NAME",
        help="Limit to one organization (id, or case-insensitive name substring)",
    )
    parser.add_argument(
        "--include-past",
        action="store_true",
        help="Also list occurrences that have already started",
    )
    parser.add_argument(
        "--all-differences",
        action="store_true",
        help="Also list occurrences moved by amounts no defect explains",
    )
    args = parser.parse_args()

    async def _main() -> int:
        await database_manager.connect()
        try:
            async with async_session_factory() as db:
                reports = await build_reports(
                    db, args.org, args.include_past, args.all_differences
                )
                orgs = (await db.execute(select(Organization))).scalars().all()
                zones = {(o.name or str(o.id)): scheduling_timezone(o) for o in orgs}
                print_reports(
                    reports, lambda name: zones.get(name, scheduling_timezone(None))
                )
                return 0
        finally:
            await database_manager.disconnect()

    try:
        return asyncio.run(_main())
    except SystemExit:
        raise
    except Exception as exc:  # pragma: no cover - operational safety net
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

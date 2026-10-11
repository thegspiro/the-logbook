#!/usr/bin/env python3
"""
Re-date minutes that were created from a meeting before 3 October 2026 (W51-8).

Until then ``MinuteService.create_from_meeting`` combined the meeting's date
and start time *as UTC*, although both are the department's wall clock. A
meeting with no start time was therefore dated UTC midnight — the evening
before, for any department west of Greenwich — and a 7:00 PM meeting read
2:00 PM in Chicago. Minutes created since are dated on the department's clock.

When a row is changed
---------------------
Only when **all** of these hold:

  * the minutes are linked to a meeting (``meeting_minutes.meeting_id``) that
    still exists in the same organization and still has a date;
  * the minutes' ``meeting_date`` is still exactly the value the old code
    would have written from that meeting today — the meeting's date and start
    time read as UTC;
  * the corrected value (the same wall-clock time on the department's
    calendar) differs from it. A department on UTC has nothing to correct.

The second condition is the guard the owner asked for. A secretary who fixed
the date by hand has moved it off the old value, so the row is left alone; so
is a row whose meeting was rescheduled after the minutes were written, since
nothing then says which value is right. Rows skipped this way are not
reported individually: there is nothing wrong with them to report.

Safety
------
* **Dry run by default.** Nothing is written without ``--apply``.
* **Per-organization.** The meeting is resolved in the minutes' own
  organization, and ``--org`` limits the run to one department.
* **Audit trail.** Each changed row is recorded through the normal audit
  logger with its old and new value, which is also what a reversal needs.
* **Idempotent.** A corrected row no longer equals the old value, so a second
  run finds nothing.

Usage:

    # See what would change (default — writes nothing):
    docker exec -it intranet-backend python scripts/backfill_minutes_meeting_dates.py

    # One organization:
    docker exec -it intranet-backend python scripts/backfill_minutes_meeting_dates.py \\
        --org "Falls Church"

    # Apply:
    docker exec -it intranet-backend python scripts/backfill_minutes_meeting_dates.py --apply

Exit codes:
    0 — success (dry run or apply)
    2 — database connection error or unhandled exception
"""

import argparse
import asyncio
import os
import sys
from datetime import datetime, time, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import select  # noqa: E402

from app.core.audit import log_audit_event  # noqa: E402
from app.core.database import (  # noqa: E402
    async_session_factory,
    database_manager,
)
from app.models.meeting import Meeting  # noqa: E402
from app.models.minute import MeetingMinutes  # noqa: E402
from app.models.user import Organization  # noqa: E402
from app.utils.org_timezone import scheduling_timezone  # noqa: E402

SOURCE = "scripts/backfill_minutes_meeting_dates.py"


def _utc(value: datetime) -> datetime:
    """MySQL hands back naive datetimes that are already UTC."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def corrected_date(minutes_date, meeting_date, start_time, tz):
    """The value to write, or None when the row must be left alone.

    ``minutes_date`` is the stored value; ``meeting_date``/``start_time`` come
    from the linked meeting; ``tz`` is the department's timezone.
    """
    if minutes_date is None or meeting_date is None:
        return None
    wall_clock = start_time or time.min
    old = datetime.combine(meeting_date, wall_clock, tzinfo=timezone.utc)
    if _utc(minutes_date) != old:
        return None
    new = datetime.combine(meeting_date, wall_clock, tzinfo=tz).astimezone(timezone.utc)
    return None if new == old else new


async def _plan(db, org_filter):
    """Every row the guard allows changing, with its old and new value."""
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

    plan = []
    for org in orgs:
        tz = scheduling_timezone(org)
        rows = (
            await db.execute(
                select(MeetingMinutes, Meeting)
                .join(
                    Meeting,
                    (Meeting.id == MeetingMinutes.meeting_id)
                    & (Meeting.organization_id == MeetingMinutes.organization_id),
                )
                .where(MeetingMinutes.organization_id == str(org.id))
            )
        ).all()
        for minutes, meeting in rows:
            new = corrected_date(
                minutes.meeting_date, meeting.meeting_date, meeting.start_time, tz
            )
            if new is not None:
                plan.append(
                    {
                        "org": org,
                        "minutes": minutes,
                        "old": _utc(minutes.meeting_date),
                        "new": new,
                    }
                )
    return plan


def _print_plan(plan, applying: bool) -> None:
    bar = "=" * 78
    verb = "APPLYING" if applying else "DRY RUN — no changes written"
    print(bar)
    print(f"RE-DATE MINUTES CREATED FROM A MEETING ON THE UTC CLOCK  ({verb})")
    print(bar)
    if not plan:
        print("\nNothing to do — no minutes still carry the shifted date.")
        print(f"\n{bar}")
        return
    for item in plan:
        print(
            f"\n{item['org'].name} / {item['minutes'].title}\n"
            f"  minutes={item['minutes'].id}\n"
            f"  {item['old'].isoformat()}  ->  {item['new'].isoformat()}"
        )
    print(f"\n{bar}")
    print(f"{len(plan)} minutes record(s) to re-date.")
    if not applying:
        print("\nRe-run with --apply to write them.")
    print(bar)


async def _apply(db, plan) -> int:
    for item in plan:
        minutes = item["minutes"]
        minutes.meeting_date = item["new"]
        await log_audit_event(
            db=db,
            event_type="minutes_meeting_date_backfilled",
            event_category="minutes",
            severity="info",
            event_data={
                "minutes_id": str(minutes.id),
                "meeting_id": str(minutes.meeting_id),
                "old_meeting_date": item["old"].isoformat(),
                "new_meeting_date": item["new"].isoformat(),
                "applied_by": SOURCE,
            },
            organization_id=str(minutes.organization_id),
        )
    if plan:
        await db.commit()
    return len(plan)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Re-date minutes created from a meeting whose date was read as UTC "
            "(only rows still carrying that value)."
        )
    )
    parser.add_argument(
        "--org",
        metavar="ID_OR_NAME",
        help="Limit to one organization (id, or case-insensitive name substring)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write the corrected dates (without this, the run is a dry run)",
    )
    args = parser.parse_args()

    async def _main() -> int:
        await database_manager.connect()
        try:
            async with async_session_factory() as db:
                plan = await _plan(db, args.org)
                _print_plan(plan, args.apply)
                if args.apply:
                    await _apply(db, plan)
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

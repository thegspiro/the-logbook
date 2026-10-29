"""The three public-portal statistics that published null (W76-6).

Data Control offered ``stations``, ``total_volunteer_hours`` and
``total_calls_ytd``, and ``GET /api/public/v1/organization/stats`` sent null for
all three (CLAUDE.md pitfall 19). Owner decision, 2026-10-27, defines each:

- **stations**: facilities of the "Fire Station" type, not archived.
- **total_volunteer_hours**: this calendar year in the department's timezone,
  summing approved admin hours, completed training, shift attendance and event
  attendance.
- **total_calls_ytd**: the department's recorded calls (``org_calls``) this
  calendar year in its timezone.

The four hour sources overlap, so each hour is taken from one of them only. An
event check-in can also produce an admin-hours entry (``source_rsvp_id``) or a
training record (``source_event_id``); the admin entry counts when it is
approved and the attendance then does not, and an event's training record never
counts because its attendance does. The department-wide "contributed hours" in
the compliance report is a different, narrower figure (training plus admin
hours); the portal's was chosen separately and is not that one.
"""

from datetime import date, datetime, time, timezone
from typing import Optional, Tuple

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.admin_hours import AdminHoursEntry, AdminHoursEntryStatus
from app.models.call_tracking import OrgCall
from app.models.event import Event, EventRSVP
from app.models.facilities import Facility, FacilityType
from app.models.training import (
    Shift,
    ShiftAttendance,
    TrainingRecord,
    TrainingStatus,
)
from app.models.user import Organization
from app.utils.org_timezone import scheduling_timezone

STATION_TYPE_NAME = "Fire Station"


def year_to_date(
    organization: Optional[Organization], now: Optional[datetime] = None
) -> Tuple[date, date, datetime]:
    """Jan 1 and today in the department's zone, and Jan 1's start in UTC."""
    zone = scheduling_timezone(organization)
    today = (now or datetime.now(timezone.utc)).astimezone(zone).date()
    jan_1 = date(today.year, 1, 1)
    start = datetime.combine(jan_1, time.min, tzinfo=zone).astimezone(timezone.utc)
    return jan_1, today, start


async def count_stations(db: AsyncSession, organization_id: str) -> int:
    return int(
        await db.scalar(
            select(func.count(Facility.id))
            .join(FacilityType, FacilityType.id == Facility.facility_type_id)
            .where(
                Facility.organization_id == organization_id,
                Facility.is_archived.is_(False),
                FacilityType.name == STATION_TYPE_NAME,
            )
        )
        or 0
    )


async def count_calls_ytd(
    db: AsyncSession,
    organization: Organization,
    now: Optional[datetime] = None,
) -> int:
    jan_1, today, _ = year_to_date(organization, now)
    return int(
        await db.scalar(
            select(func.count(OrgCall.id)).where(
                OrgCall.organization_id == str(organization.id),
                OrgCall.call_date >= jan_1,
                OrgCall.call_date <= today,
            )
        )
        or 0
    )


async def volunteer_hours_ytd(
    db: AsyncSession,
    organization: Organization,
    now: Optional[datetime] = None,
) -> int:
    """Whole hours: the public schema publishes an integer."""
    org_id = str(organization.id)
    jan_1, today, start = year_to_date(organization, now)
    end = now or datetime.now(timezone.utc)

    admin_minutes = await db.scalar(
        select(func.coalesce(func.sum(AdminHoursEntry.duration_minutes), 0)).where(
            AdminHoursEntry.organization_id == org_id,
            AdminHoursEntry.status == AdminHoursEntryStatus.APPROVED,
            AdminHoursEntry.clock_in_at >= start,
            AdminHoursEntry.clock_in_at <= end,
        )
    )
    training_hours = await db.scalar(
        select(func.coalesce(func.sum(TrainingRecord.hours_completed), 0)).where(
            TrainingRecord.organization_id == org_id,
            TrainingRecord.status == TrainingStatus.COMPLETED,
            TrainingRecord.completion_date >= jan_1,
            TrainingRecord.completion_date <= today,
            TrainingRecord.source_event_id.is_(None),
        )
    )
    shift_minutes = await db.scalar(
        select(func.coalesce(func.sum(ShiftAttendance.duration_minutes), 0))
        .join(Shift, Shift.id == ShiftAttendance.shift_id)
        .where(
            Shift.organization_id == org_id,
            Shift.shift_date >= jan_1,
            Shift.shift_date <= today,
        )
    )
    counted_as_admin_hours = (
        select(AdminHoursEntry.id)
        .where(
            AdminHoursEntry.source_rsvp_id == EventRSVP.id,
            AdminHoursEntry.status == AdminHoursEntryStatus.APPROVED,
        )
        .exists()
    )
    event_minutes = await db.scalar(
        select(func.coalesce(func.sum(EventRSVP.attendance_duration_minutes), 0))
        .join(Event, Event.id == EventRSVP.event_id)
        .where(
            and_(
                Event.organization_id == org_id,
                Event.is_cancelled.is_(False),
                Event.start_datetime >= start,
                Event.start_datetime <= end,
                EventRSVP.checked_in.is_(True),
                ~counted_as_admin_hours,
            )
        )
    )
    minutes = float(admin_minutes or 0) + float(shift_minutes or 0)
    minutes += float(event_minutes or 0)
    return round(minutes / 60 + float(training_hours or 0))

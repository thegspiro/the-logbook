"""The public portal's stations, volunteer hours and calls statistics.

W76-6: Data Control offered these three and the stats endpoint published null
for each. Owner decision (2026-10-27) defines them; see
``app/services/public_stats_service.py``. The volunteer-hour sources overlap,
so the overlap cases are seeded deliberately: an event check-in that also
became an approved admin-hours entry, and a training record created from an
event, must each count once.

Integration: every figure is a SQL aggregate.
"""

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.admin_hours import (
    AdminHoursCategory,
    AdminHoursEntry,
    AdminHoursEntryStatus,
)
from app.models.call_tracking import OrgCall
from app.models.event import Event, EventRSVP
from app.models.facilities import Facility, FacilityStatus, FacilityType
from app.models.training import (
    Shift,
    ShiftAttendance,
    TrainingRecord,
    TrainingStatus,
    TrainingType,
)
from app.models.user import Organization
from app.services.public_stats_service import (
    count_calls_ytd,
    count_stations,
    volunteer_hours_ytd,
)

pytestmark = [pytest.mark.integration]

# 03:00 UTC on 1 Jan is still 31 Dec in New York, so "this year" there is 2026
# from midnight local, and a call dated 2025-12-31 is last year's.
NOW = datetime(2026, 6, 15, 16, 0, tzinfo=timezone.utc)
THIS_YEAR = datetime(2026, 3, 10, 18, 0, tzinfo=timezone.utc)
LAST_YEAR = datetime(2025, 12, 31, 23, 0, tzinfo=timezone.utc)  # 18:00 local


@pytest.fixture
async def org(db_session: AsyncSession, setup_org_and_admin):
    org_id, admin_id = setup_org_and_admin
    organization = await db_session.get(Organization, org_id)
    organization.timezone = "America/New_York"
    await db_session.flush()
    return organization, admin_id


async def _facility(db, org_id, type_name, *, archived=False):
    kind = FacilityType(organization_id=org_id, name=f"{type_name}")
    status = FacilityStatus(
        organization_id=org_id, name=f"Operational {uuid.uuid4().hex[:6]}"
    )
    db.add_all([kind, status])
    await db.flush()
    db.add(
        Facility(
            organization_id=org_id,
            name=f"{type_name} {uuid.uuid4().hex[:6]}",
            facility_type_id=kind.id,
            status_id=status.id,
            is_archived=archived,
        )
    )
    await db.flush()


class TestStations:
    async def test_counts_fire_station_facilities_that_are_not_archived(
        self, db_session, org
    ):
        organization, _ = org
        org_id = str(organization.id)
        await _facility(db_session, org_id, "Fire Station")
        # The type name is unique per org, so the second station shares it.
        kind_id = (
            (
                await db_session.execute(
                    FacilityType.__table__.select().where(
                        FacilityType.organization_id == org_id,
                        FacilityType.name == "Fire Station",
                    )
                )
            )
            .first()
            .id
        )
        status = FacilityStatus(organization_id=org_id, name="Closed")
        db_session.add(status)
        await db_session.flush()
        for archived in (False, True):
            db_session.add(
                Facility(
                    organization_id=org_id,
                    name=f"Station {archived}",
                    facility_type_id=kind_id,
                    status_id=status.id,
                    is_archived=archived,
                )
            )
        await _facility(db_session, org_id, "Training Center")
        await db_session.flush()

        assert await count_stations(db_session, org_id) == 2


class TestCalls:
    async def test_counts_this_calendar_year_in_the_departments_timezone(
        self, db_session, org
    ):
        organization, _ = org
        org_id = str(organization.id)
        for day in (date(2026, 1, 1), date(2026, 6, 15), date(2025, 12, 31)):
            db_session.add(OrgCall(organization_id=org_id, call_date=day))
        db_session.add(OrgCall(organization_id=org_id, call_date=date(2026, 6, 16)))
        await db_session.flush()

        assert await count_calls_ytd(db_session, organization, now=NOW) == 2


class TestVolunteerHours:
    async def test_sums_each_source_once(self, db_session, org):
        organization, member_id = org
        org_id = str(organization.id)

        # Admin hours: 2h approved this year count; pending and last year don't.
        category = AdminHoursCategory(organization_id=org_id, name="Office")
        db_session.add(category)
        await db_session.flush()
        for status, when, minutes in (
            (AdminHoursEntryStatus.APPROVED, THIS_YEAR, 120),
            (AdminHoursEntryStatus.PENDING, THIS_YEAR, 600),
            (AdminHoursEntryStatus.APPROVED, LAST_YEAR, 600),
        ):
            db_session.add(
                AdminHoursEntry(
                    organization_id=org_id,
                    user_id=member_id,
                    category_id=category.id,
                    clock_in_at=when,
                    duration_minutes=minutes,
                    status=status,
                )
            )

        # Training: 3h completed this year count; scheduled doesn't.
        for status, hours in (
            (TrainingStatus.COMPLETED, 3.0),
            (TrainingStatus.SCHEDULED, 8.0),
        ):
            db_session.add(
                TrainingRecord(
                    organization_id=org_id,
                    user_id=member_id,
                    course_name="Pump ops",
                    training_type=TrainingType.CONTINUING_EDUCATION,
                    hours_completed=hours,
                    status=status,
                    completion_date=date(2026, 3, 10),
                )
            )

        # Shifts: 12h this year count; last year's doesn't.
        for day in (date(2026, 2, 1), date(2025, 12, 31)):
            shift = Shift(
                organization_id=org_id,
                shift_date=day,
                start_time=datetime.combine(day, datetime.min.time()),
            )
            db_session.add(shift)
            await db_session.flush()
            db_session.add(
                ShiftAttendance(
                    shift_id=shift.id, user_id=member_id, duration_minutes=720
                )
            )

        # Events: one plain check-in of 1.5h counts. A second check-in of 2h
        # also became an approved admin entry (counted above as admin hours
        # would be) and produced a training record; neither repeats it.
        plain = Event(
            organization_id=org_id,
            title="Drill",
            start_datetime=THIS_YEAR,
            end_datetime=THIS_YEAR + timedelta(hours=2),
        )
        overlap = Event(
            organization_id=org_id,
            title="Class",
            start_datetime=THIS_YEAR,
            end_datetime=THIS_YEAR + timedelta(hours=2),
        )
        db_session.add_all([plain, overlap])
        await db_session.flush()
        plain_rsvp = EventRSVP(
            organization_id=org_id,
            event_id=plain.id,
            user_id=member_id,
            checked_in=True,
            attendance_duration_minutes=90,
        )
        overlap_rsvp = EventRSVP(
            organization_id=org_id,
            event_id=overlap.id,
            user_id=member_id,
            checked_in=True,
            attendance_duration_minutes=120,
        )
        db_session.add_all([plain_rsvp, overlap_rsvp])
        await db_session.flush()
        db_session.add(
            AdminHoursEntry(
                organization_id=org_id,
                user_id=member_id,
                category_id=category.id,
                clock_in_at=THIS_YEAR,
                duration_minutes=120,
                status=AdminHoursEntryStatus.APPROVED,
                source_event_id=overlap.id,
                source_rsvp_id=overlap_rsvp.id,
            )
        )
        db_session.add(
            TrainingRecord(
                organization_id=org_id,
                user_id=member_id,
                course_name="Class",
                training_type=TrainingType.CONTINUING_EDUCATION,
                hours_completed=2.0,
                status=TrainingStatus.COMPLETED,
                completion_date=date(2026, 3, 10),
                source_event_id=overlap.id,
            )
        )
        await db_session.flush()

        # 2 admin + 2 admin (from the event) + 3 training + 12 shift + 1.5 event
        assert await volunteer_hours_ytd(db_session, organization, now=NOW) == 20

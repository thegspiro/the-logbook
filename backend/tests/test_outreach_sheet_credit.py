"""Time worked on a community outreach sheet is outreach hours, not shift hours.

Owner decisions, 2026-11-24. Driven against real rows. Pinned:

* a sheet's attendance is left out of the shift-hours totals and of the
  shifts worked toward a shift requirement, while a duty shift still counts;
* a volunteer's sheet check-in and check-out are carried onto their RSVP for
  the event, crediting from the scheduled start as any check-in does;
* the event's finalize credits that time to the admin hours category its type
  maps to, once, however many times the mirror runs;
* a member checked in on both the sheet and the event is counted once;
* a manager's correction on the event outranks the sheet;
* sheet time recorded after the event's attendance is finalized is credited
  anyway, and a second run changes nothing;
* a sheet whose request has no event yet waits, and is credited when the
  event is finalized.
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from app.api.v1.endpoints.events import open_event_staffing_sheet
from app.core.seed_admin_hours import (
    seed_admin_hours_categories,
    seed_event_hour_mappings,
)
from app.models.admin_hours import AdminHoursCategory, AdminHoursEntry
from app.models.event import Event, EventRSVP, EventType
from app.models.event_request import EventRequest, EventRequestStatus
from app.models.training import (
    DueDateType,
    RequirementFrequency,
    RequirementType,
    Shift,
    ShiftAttendance,
    TrainingRequirement,
)
from app.models.user import Organization, User, UserStatus
from app.schemas.event_request import EventRequestStaffingCreate
from app.services.event_request_service import open_staffing_shift
from app.services.event_service import EventService
from app.services.outreach_sheet_credit import (
    catch_up_outreach_sheets,
    sync_sheet_attendance,
)
from app.services.scheduling_service import SchedulingService
from app.services.training_compliance import load_credited_shift_dates
from tests.clock_support import reread_each_test

pytestmark = pytest.mark.integration


def _clock() -> dict[str, Any]:
    """Read as each test starts (tests/clock_support.py), not at import.

    Midday on the 15th of next month, so the event, its sheet and a duty
    shift on the same date share one calendar month in any timezone.
    """
    now = datetime.now(timezone.utc)
    first_of_next = (now.replace(day=1) + timedelta(days=32)).replace(day=1)
    start = first_of_next.replace(day=15, hour=18, minute=0, second=0, microsecond=0)
    return {"START": start}


(START,) = _clock().values()
_reread_clock = reread_each_test(__name__, _clock)


async def _dept(db):
    org = Organization(
        name="Credit FD",
        slug=f"credit-{uuid.uuid4().hex[:10]}",
        timezone="UTC",
        settings={},
    )
    db.add(org)
    await db.flush()
    officer = User(
        organization_id=org.id,
        username=f"officer-{org.id[:8]}",
        email=f"officer-{org.id[:8]}@example.test",
        first_name="Casey",
        last_name="Morgan",
        status=UserStatus.ACTIVE,
    )
    volunteer = User(
        organization_id=org.id,
        username=f"vol-{org.id[:8]}",
        email=f"vol-{org.id[:8]}@example.test",
        first_name="Dana",
        last_name="Ruiz",
        status=UserStatus.ACTIVE,
    )
    db.add_all([officer, volunteer])
    await db.flush()
    categories = await seed_admin_hours_categories(db, org.id, officer.id)
    await db.flush()
    await seed_event_hour_mappings(db, org.id, categories, officer.id)
    await db.flush()
    return org, officer, volunteer


async def _event(db, org, officer) -> Event:
    event = Event(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        title="Station Tour for Lincoln Elementary",
        event_type=EventType.PUBLIC_EDUCATION,
        start_datetime=START,
        end_datetime=START + timedelta(hours=2),
        created_by=officer.id,
    )
    db.add(event)
    await db.flush()
    return event


async def _event_with_sheet(db, org, officer) -> tuple[Event, str]:
    event = await _event(db, org, officer)
    with patch(
        "app.api.v1.endpoints.events.log_audit_event", AsyncMock(return_value=None)
    ):
        await open_event_staffing_sheet(
            event_id=uuid.UUID(event.id),
            data=EventRequestStaffingCreate(roles=[{"role": "tour_guide", "count": 2}]),
            db=db,
            current_user=officer,
        )
    await db.refresh(event)
    assert event.staffing_shift_id is not None
    return event, str(event.staffing_shift_id)


async def _worked(db, shift_id, user, start, end=None) -> ShiftAttendance:
    """A sheet attendance row, as a check-in and check-out leave it."""
    attendance = ShiftAttendance(
        shift_id=shift_id,
        user_id=user.id,
        checked_in_at=start,
        checked_out_at=end,
        duration_minutes=(
            int((end - start).total_seconds() / 60) if end is not None else None
        ),
    )
    db.add(attendance)
    await db.flush()
    return attendance


async def _rsvp(db, event, user) -> EventRSVP:
    rsvp = await db.scalar(
        select(EventRSVP)
        .where(EventRSVP.event_id == event.id, EventRSVP.user_id == user.id)
        .execution_options(populate_existing=True)
    )
    assert rsvp is not None
    return rsvp


async def _outreach_entries(db, org, user) -> list[AdminHoursEntry]:
    rows = await db.execute(
        select(AdminHoursEntry)
        .join(AdminHoursCategory, AdminHoursCategory.id == AdminHoursEntry.category_id)
        .where(
            AdminHoursEntry.organization_id == org.id,
            AdminHoursEntry.user_id == user.id,
            AdminHoursCategory.name == "Community Outreach",
        )
        .execution_options(populate_existing=True)
    )
    return list(rows.scalars().all())


async def _finalize(db, event, org, officer) -> None:
    outcome = await EventService(db).finalize_event_attendance_detailed(
        event.id, org.id, finalized_by=officer.id
    )
    assert outcome.error is None


class TestShiftTotalsLeaveOutreachOut:
    async def test_department_hours_count_the_duty_shift_and_not_the_sheet(
        self, db_session
    ):
        org, officer, volunteer = await _dept(db_session)
        _event_row, sheet_id = await _event_with_sheet(db_session, org, officer)
        service = SchedulingService(db_session)
        duty, error = await service.create_shift(
            org.id,
            {
                "shift_date": START.date(),
                "start_time": START,
                "end_time": START + timedelta(hours=12),
            },
            officer.id,
        )
        assert error is None
        assert duty is not None
        await _worked(
            db_session, sheet_id, volunteer, START, START + timedelta(hours=2)
        )
        await _worked(db_session, duty.id, volunteer, START, START + timedelta(hours=3))

        totals = await service.get_member_month_totals(volunteer.id, org.id)

        month = totals[(START.year, START.month)]
        # Three hours of duty, pending until the shift is closed out. The two
        # on the sheet are not shift hours at all.
        assert month["pending_hours"] == 3
        assert month["pending_shifts"] == 1

    async def test_a_sheet_is_not_a_shift_worked_toward_a_requirement(self, db_session):
        org, officer, volunteer = await _dept(db_session)
        _event_row, sheet_id = await _event_with_sheet(db_session, org, officer)
        duty, error = await SchedulingService(db_session).create_shift(
            org.id,
            {
                "shift_date": START.date(),
                "start_time": START,
                "end_time": START + timedelta(hours=12),
            },
            officer.id,
        )
        assert error is None
        assert duty is not None
        await _worked(
            db_session, sheet_id, volunteer, START, START + timedelta(hours=2)
        )
        await _worked(db_session, duty.id, volunteer, START, START + timedelta(hours=3))
        # Both closed out, so both would be credit if a sheet were a shift.
        for shift_id in (sheet_id, duty.id):
            shift = await db_session.scalar(select(Shift).where(Shift.id == shift_id))
            shift.is_finalized = True
        requirement = TrainingRequirement(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            name="Annual Shifts",
            requirement_type=RequirementType.SHIFTS,
            required_shifts=2,
            frequency=RequirementFrequency.ANNUAL,
            due_date_type=DueDateType.CALENDAR_PERIOD,
            applies_to_all=True,
            active=True,
        )
        db_session.add(requirement)
        await db_session.flush()

        worked = await load_credited_shift_dates(
            db_session, org.id, [volunteer.id], [requirement], START.date(), True
        )

        # The duty shift, and only the duty shift.
        assert worked.get(volunteer.id, []) == [START.date()]


class TestTheSheetIsCarriedOntoTheEvent:
    async def test_a_check_out_is_mirrored_and_credits_from_the_scheduled_start(
        self, db_session
    ):
        org, officer, volunteer = await _dept(db_session)
        event, sheet_id = await _event_with_sheet(db_session, org, officer)
        # Half an hour early to set up: not credited, as for any early tap.
        await _worked(
            db_session,
            sheet_id,
            volunteer,
            START - timedelta(minutes=30),
            START + timedelta(minutes=90),
        )

        outcome = await sync_sheet_attendance(db_session, sheet_id, org.id)
        await db_session.flush()

        rsvp = await _rsvp(db_session, event, volunteer)
        assert outcome.mirrored == 1
        assert rsvp.checked_in is True
        assert rsvp.is_volunteer is True
        assert rsvp.attendance_duration_minutes == 90

    async def test_a_member_still_on_the_clock_is_marked_present_only(self, db_session):
        org, officer, volunteer = await _dept(db_session)
        event, sheet_id = await _event_with_sheet(db_session, org, officer)
        await _worked(db_session, sheet_id, volunteer, START)

        await sync_sheet_attendance(db_session, sheet_id, org.id)
        await db_session.flush()

        rsvp = await _rsvp(db_session, event, volunteer)
        assert rsvp.checked_in is True
        assert rsvp.checked_out_at is None
        assert rsvp.attendance_duration_minutes is None

    async def test_a_managers_correction_outranks_the_sheet(self, db_session):
        org, officer, volunteer = await _dept(db_session)
        event, sheet_id = await _event_with_sheet(db_session, org, officer)
        db_session.add(
            EventRSVP(
                organization_id=org.id,
                event_id=event.id,
                user_id=volunteer.id,
                status="going",
                checked_in=True,
                checked_in_at=START,
                override_duration_minutes=45,
                responded_at=START,
            )
        )
        await _worked(
            db_session, sheet_id, volunteer, START, START + timedelta(hours=2)
        )

        outcome = await sync_sheet_attendance(db_session, sheet_id, org.id)
        await db_session.flush()

        rsvp = await _rsvp(db_session, event, volunteer)
        assert outcome.mirrored == 0
        assert rsvp.override_duration_minutes == 45
        assert rsvp.attendance_duration_minutes is None

    async def test_a_duty_shift_is_left_alone(self, db_session):
        org, officer, volunteer = await _dept(db_session)
        duty, error = await SchedulingService(db_session).create_shift(
            org.id,
            {
                "shift_date": START.date(),
                "start_time": START,
                "end_time": START + timedelta(hours=12),
            },
            officer.id,
        )
        assert error is None
        assert duty is not None
        await _worked(db_session, duty.id, volunteer, START, START + timedelta(hours=3))

        outcome = await sync_sheet_attendance(db_session, duty.id, org.id)

        assert outcome.event_id is None
        assert outcome.volunteers == 0


class TestTheEventCreditsTheHours:
    async def test_finalize_credits_the_sheet_time_once(self, db_session):
        org, officer, volunteer = await _dept(db_session)
        event, sheet_id = await _event_with_sheet(db_session, org, officer)
        await _worked(
            db_session, sheet_id, volunteer, START, START + timedelta(hours=2)
        )

        await _finalize(db_session, event, org, officer)

        entries = await _outreach_entries(db_session, org, volunteer)
        assert [entry.duration_minutes for entry in entries] == [120]

    async def test_a_member_on_both_the_sheet_and_the_event_is_counted_once(
        self, db_session
    ):
        org, officer, volunteer = await _dept(db_session)
        event, sheet_id = await _event_with_sheet(db_session, org, officer)
        db_session.add(
            EventRSVP(
                organization_id=org.id,
                event_id=event.id,
                user_id=volunteer.id,
                status="going",
                checked_in=True,
                checked_in_at=START + timedelta(minutes=5),
                responded_at=START,
            )
        )
        await _worked(
            db_session, sheet_id, volunteer, START, START + timedelta(hours=2)
        )

        await _finalize(db_session, event, org, officer)

        entries = await _outreach_entries(db_session, org, volunteer)
        assert [entry.duration_minutes for entry in entries] == [120]

    async def test_sheet_time_after_finalize_is_credited_and_a_rerun_is_a_no_op(
        self, db_session
    ):
        org, officer, volunteer = await _dept(db_session)
        event, sheet_id = await _event_with_sheet(db_session, org, officer)
        await _finalize(db_session, event, org, officer)
        assert await _outreach_entries(db_session, org, volunteer) == []

        await _worked(
            db_session, sheet_id, volunteer, START, START + timedelta(minutes=75)
        )
        first = await sync_sheet_attendance(db_session, sheet_id, org.id)
        await db_session.flush()
        second = await sync_sheet_attendance(db_session, sheet_id, org.id)
        await db_session.flush()

        entries = await _outreach_entries(db_session, org, volunteer)
        assert first.credited_entries == 1
        assert second.mirrored == 0
        assert [entry.duration_minutes for entry in entries] == [75]

    async def test_a_corrected_check_out_after_finalize_corrects_the_entry(
        self, db_session
    ):
        org, officer, volunteer = await _dept(db_session)
        event, sheet_id = await _event_with_sheet(db_session, org, officer)
        attendance = await _worked(
            db_session, sheet_id, volunteer, START, START + timedelta(hours=2)
        )
        await _finalize(db_session, event, org, officer)

        attendance.checked_out_at = START + timedelta(hours=1)
        attendance.duration_minutes = 60
        await db_session.flush()
        await sync_sheet_attendance(db_session, sheet_id, org.id)
        await db_session.flush()

        entries = await _outreach_entries(db_session, org, volunteer)
        assert [entry.duration_minutes for entry in entries] == [60]


class TestASheetWithNoEventYet:
    async def test_it_waits_and_is_credited_once_the_event_is_finalized(
        self, db_session
    ):
        org, officer, volunteer = await _dept(db_session)
        request = EventRequest(
            organization_id=org.id,
            contact_name="Pat Rivera",
            contact_email="pat@example.test",
            organization_name="Lincoln Elementary",
            outreach_type="station_tour",
            description="Second grade visit",
            status=EventRequestStatus.SCHEDULED,
            event_date=START,
        )
        db_session.add(request)
        await db_session.flush()
        shift, error = await open_staffing_shift(
            db_session, request, org, [{"role": "tour_guide", "count": 2}], officer.id
        )
        assert error is None
        assert shift is not None
        await db_session.flush()
        sheet_id = str(shift.id)
        await _worked(
            db_session, sheet_id, volunteer, START, START + timedelta(hours=2)
        )

        waiting = await sync_sheet_attendance(db_session, sheet_id, org.id)
        assert waiting.event_id is None
        assert await _outreach_entries(db_session, org, volunteer) == []

        event = await _event(db_session, org, officer)
        request.event_id = event.id
        await db_session.flush()
        await _finalize(db_session, event, org, officer)

        entries = await _outreach_entries(db_session, org, volunteer)
        assert [entry.duration_minutes for entry in entries] == [120]


class TestTheAttendanceWritersRunTheMirror:
    async def test_recording_attendance_on_a_sheet_reaches_the_event(self, db_session):
        org, officer, volunteer = await _dept(db_session)
        event, sheet_id = await _event_with_sheet(db_session, org, officer)

        attendance, error = await SchedulingService(db_session).add_attendance(
            uuid.UUID(sheet_id),
            org.id,
            {
                "user_id": volunteer.id,
                "checked_in_at": START,
                "checked_out_at": START + timedelta(hours=2),
            },
        )
        assert error is None
        assert attendance is not None

        rsvp = await _rsvp(db_session, event, volunteer)
        assert rsvp.checked_in is True
        assert rsvp.attendance_duration_minutes == 120


class TestTheOfficerRunCatchUp:
    async def test_the_preview_reports_the_work_and_keeps_none_of_it(self, db_session):
        org, officer, volunteer = await _dept(db_session)
        event, sheet_id = await _event_with_sheet(db_session, org, officer)
        await _finalize(db_session, event, org, officer)
        await _worked(
            db_session, sheet_id, volunteer, START, START + timedelta(hours=2)
        )
        await db_session.flush()

        preview = await catch_up_outreach_sheets(db_session, org.id, dry_run=True)

        assert preview.sheets == 1
        assert preview.volunteers == 1
        assert preview.entries_credited == 1
        assert preview.minutes == 120
        assert await _outreach_entries(db_session, org, volunteer) == []

    async def test_a_run_credits_past_sheets_and_a_second_run_adds_nothing(
        self, db_session
    ):
        org, officer, volunteer = await _dept(db_session)
        event, sheet_id = await _event_with_sheet(db_session, org, officer)
        await _finalize(db_session, event, org, officer)
        await _worked(
            db_session, sheet_id, volunteer, START, START + timedelta(hours=2)
        )
        await db_session.flush()

        first = await catch_up_outreach_sheets(db_session, org.id, dry_run=False)
        second = await catch_up_outreach_sheets(db_session, org.id, dry_run=False)

        entries = await _outreach_entries(db_session, org, volunteer)
        assert first.entries_credited == 1
        assert second.attendance_updated == 0
        assert [entry.duration_minutes for entry in entries] == [120]

    async def test_it_says_which_sheets_cannot_be_credited_yet(self, db_session):
        org, officer, volunteer = await _dept(db_session)
        _open_event, open_sheet = await _event_with_sheet(db_session, org, officer)
        await _worked(
            db_session, open_sheet, volunteer, START, START + timedelta(hours=2)
        )
        await db_session.flush()

        summary = await catch_up_outreach_sheets(db_session, org.id, dry_run=True)

        # The event is still open: its own finalize will credit the hours.
        assert summary.sheets_awaiting_finalize == 1
        assert summary.entries_credited == 0

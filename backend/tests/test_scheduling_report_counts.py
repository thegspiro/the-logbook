"""The coverage and member-hours reports count what the other screens count.

- Coverage read an apparatus's minimum before the shift's own, so a four-seat
  shift with one member was "covered" here while the open-shifts list and the
  widget showed three seats open; it also reported every cancelled shift as
  understaffed, because cancelling one cancels its seats.
- Member hours counted declined and cancelled seats, and seats on cancelled
  shifts, as scheduled work.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.training import (
    AssignmentStatus,
    Shift,
    ShiftAssignment,
    ShiftStatus,
)
from app.models.user import Organization, User, UserStatus
from app.services.scheduling_service import SchedulingService

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


@pytest.fixture
async def dept(db_session):
    org = Organization(
        name="Report Counts FD",
        slug=f"report-counts-{uuid.uuid4().hex[:10]}",
        timezone="America/New_York",
        settings={},
    )
    db_session.add(org)
    await db_session.flush()
    members = []
    for i in range(2):
        user = User(
            organization_id=org.id,
            username=f"m{i}-{org.id[:8]}",
            email=f"m{i}-{org.id[:8]}@example.test",
            first_name="Member",
            last_name=str(i),
            status=UserStatus.ACTIVE,
        )
        db_session.add(user)
        members.append(user)
    await db_session.flush()
    return org, members


def _shift(org, day, **kwargs):
    start = datetime(day.year, day.month, day.day, 11, 0, tzinfo=timezone.utc)
    return Shift(
        organization_id=org.id,
        shift_date=day,
        start_time=start,
        end_time=start + timedelta(hours=12),
        **kwargs,
    )


def _seat(org, shift, user, status=AssignmentStatus.ASSIGNED):
    return ShiftAssignment(
        organization_id=org.id,
        shift_id=shift.id,
        user_id=user.id,
        position="firefighter",
        assignment_status=status,
    )


class TestCoverage:
    async def test_the_shifts_own_minimum_decides_understaffing(self, db_session, dept):
        org, members = dept
        day = datetime.now(timezone.utc).date()
        shift = _shift(org, day, min_staffing=4)
        db_session.add(shift)
        await db_session.flush()
        db_session.add(_seat(org, shift, members[0]))
        await db_session.flush()

        report = await SchedulingService(db_session).get_shift_coverage_report(
            org.id, day, day
        )

        assert report[0]["total_shifts"] == 1
        assert report[0]["understaffed_shifts"] == 1

    async def test_a_cancelled_shift_is_not_coverage_owed(self, db_session, dept):
        org, members = dept
        day = datetime.now(timezone.utc).date()
        shift = _shift(org, day, min_staffing=1, status=ShiftStatus.CANCELLED)
        db_session.add(shift)
        await db_session.flush()
        db_session.add(_seat(org, shift, members[0], status=AssignmentStatus.CANCELLED))
        await db_session.flush()

        report = await SchedulingService(db_session).get_shift_coverage_report(
            org.id, day, day
        )

        assert report[0]["total_shifts"] == 0
        assert report[0]["understaffed_shifts"] == 0


class TestMemberHoursScheduled:
    async def test_only_held_seats_on_running_shifts_are_scheduled(
        self, db_session, dept
    ):
        org, members = dept
        member = members[0]
        day = datetime.now(timezone.utc).date()
        held = _shift(org, day)
        declined = _shift(org, day)
        cancelled_shift = _shift(org, day, status=ShiftStatus.CANCELLED)
        no_show = _shift(org, day)
        db_session.add_all([held, declined, cancelled_shift, no_show])
        await db_session.flush()
        db_session.add_all(
            [
                _seat(org, held, member),
                _seat(org, declined, member, status=AssignmentStatus.DECLINED),
                _seat(org, cancelled_shift, member),
                _seat(org, no_show, member, status=AssignmentStatus.NO_SHOW),
            ]
        )
        await db_session.flush()

        report = await SchedulingService(db_session).get_member_hours_report(
            org.id, day, day
        )
        entry = next(r for r in report if r["user_id"] == member.id)

        # The held seat and the no-show were planned; the rest were not.
        assert entry["shifts_scheduled"] == 2
        assert entry["scheduled_hours"] == 24.0

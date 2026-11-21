"""A shift's assignment picker is told who has an undecided leave request.

Owner decision of 2026-11-21: a member whose leave request covers a shift's
date and is still waiting stays assignable (the request may be denied), but
the scheduler is told, rather than learning of the clash only when an
approval drops the assignment.
"""

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from app.models.leave_request import LeaveRequest
from app.models.leave_request import LeaveRequestStatus as Status
from app.models.training import Shift
from app.services.scheduling_service import SchedulingService
from tests.test_leave_requests import _department, _user

pytestmark = pytest.mark.integration


class TestTheSchedulerSeesUndecidedRequests:
    """A shift's assignment picker names members with an undecided leave
    request covering the shift date. They stay assignable."""

    async def _shift(self, db, org_id, day):
        start = datetime(day.year, day.month, day.day, 7, tzinfo=timezone.utc)
        shift = Shift(
            id=str(uuid.uuid4()),
            organization_id=org_id,
            shift_date=day,
            start_time=start,
            end_time=start + timedelta(hours=12),
        )
        db.add(shift)
        await db.flush()
        return shift

    def _request(self, org_id, user, start, end, status=Status.PENDING):
        return LeaveRequest(
            organization_id=org_id,
            user_id=str(user.id),
            start_date=start,
            end_date=end,
            status=status,
        )

    async def test_names_pending_requests_covering_the_date_in_the_department(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, chief, _, (open_ended, later), member = await _department(
            db_session, org_id, board_size=2
        )
        day = date(2027, 6, 15)
        other_org = str(uuid.uuid4())
        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, "
                "timezone) VALUES (:id, 'Other', 'fire_department', :slug, 'UTC')"
            ),
            {"id": other_org, "slug": f"o-{other_org[:8]}"},
        )
        outsider = await _user(db_session, other_org, "Quinn")
        db_session.add_all(
            [
                self._request(org_id, member, day, day),
                self._request(org_id, open_ended, day - timedelta(days=30), None),
                self._request(org_id, later, day + timedelta(days=1), None),
                self._request(org_id, chief, day, day, status=Status.DENIED),
                self._request(org_id, officer, day, day, status=Status.APPROVED),
                self._request(other_org, outsider, day, day),
            ]
        )
        shift = await self._shift(db_session, org_id, day)

        requested = await SchedulingService(db_session).get_leave_requested_user_ids(
            org_id, shift.id
        )

        assert requested == sorted([str(member.id), str(open_ended.id)])

    async def test_a_shift_in_another_department_names_nobody(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        *_, member = await _department(db_session, org_id)
        day = date(2027, 6, 15)
        db_session.add(self._request(org_id, member, day, day))
        shift = await self._shift(db_session, org_id, day)

        requested = await SchedulingService(db_session).get_leave_requested_user_ids(
            str(uuid.uuid4()), shift.id
        )

        assert requested == []

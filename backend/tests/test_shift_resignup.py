"""A member who stepped away from a shift can sign up for it again.

``uq_shift_assignment_shift_user`` allows one row per member per shift, and a
decline, a shift cancellation or approved time off keeps that row as
DECLINED/CANCELLED. The candidate check ignored those rows but the insert did
not, so the second signup failed with "Member is already assigned to this
shift" and the member could never take the shift back.
"""

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training import AssignmentStatus
from app.services.scheduling_service import SchedulingService, SignupActor

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]

OPEN_POSITIONS = ["officer", "driver", "firefighter", "ems"]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def org_and_members(db_session: AsyncSession):
    """A department with its signup positions declared, an officer and two members."""
    org_id, officer_id, member_id, other_id = _uid(), _uid(), _uid(), _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone, settings) "
            "VALUES (:id, :name, 'fire_department', :slug, :tz, :settings)"
        ),
        {
            "id": org_id,
            "name": "Resignup FD",
            "slug": f"resignup-{org_id[:8]}",
            "tz": "America/New_York",
            "settings": json.dumps({"scheduling": {"open_positions": OPEN_POSITIONS}}),
        },
    )
    for uid, uname in (
        (officer_id, "officer1"),
        (member_id, "ff1"),
        (other_id, "ff2"),
    ):
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) VALUES "
                "(:id, :org, :un, 'Test', 'User', :em, 'hashed', 'active')"
            ),
            {"id": uid, "org": org_id, "un": uname, "em": f"{uname}-{uid[:6]}@t.com"},
        )
    await db_session.flush()
    return org_id, officer_id, member_id, other_id


async def _shift_starting(svc, org_id, creator_id, *, minutes_from_now: float):
    start = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(
        minutes=minutes_from_now
    )
    shift, err = await svc.create_shift(
        uuid.UUID(org_id),
        {
            "shift_date": start.date(),
            "start_time": start,
            "end_time": start + timedelta(hours=12),
        },
        uuid.UUID(creator_id),
    )
    assert err is None, err
    return shift


async def _self_signup(svc, org_id, shift, user_id, position="firefighter"):
    return await svc.create_assignment(
        uuid.UUID(org_id),
        uuid.UUID(shift.id),
        {"user_id": user_id, "position": position},
        uuid.UUID(user_id),
        self_signup=True,
    )


async def _rows_for(db_session, shift_id, user_id):
    result = await db_session.execute(
        text(
            "SELECT id, assignment_status, position, confirmed_at "
            "FROM shift_assignments WHERE shift_id = :s AND user_id = :u"
        ),
        {"s": shift_id, "u": user_id},
    )
    return result.all()


class TestResignupAfterStepAway:
    async def test_member_can_sign_up_again_after_declining(
        self, db_session, org_and_members
    ):
        org_id, officer_id, member_id, _ = org_and_members
        svc = SchedulingService(db_session)
        shift = await _shift_starting(svc, org_id, officer_id, minutes_from_now=600)

        first, err = await _self_signup(svc, org_id, shift, member_id)
        assert err is None, err
        confirmed, err = await svc.confirm_assignment(
            uuid.UUID(first.id),
            uuid.UUID(member_id),
            uuid.UUID(org_id),
            actor=SignupActor.MEMBER,
        )
        assert err is None, err
        declined, err = await svc.decline_assignment(
            uuid.UUID(first.id),
            uuid.UUID(member_id),
            uuid.UUID(org_id),
            actor=SignupActor.MEMBER,
        )
        assert err is None, err
        assert declined.assignment_status == AssignmentStatus.DECLINED

        again, err = await _self_signup(svc, org_id, shift, member_id, "driver")
        assert err is None, err
        assert again is not None
        assert again.assignment_status == AssignmentStatus.ASSIGNED

        rows = await _rows_for(db_session, shift.id, member_id)
        assert len(rows) == 1
        row = rows[0]
        assert row.id == again.id
        assert row.assignment_status == AssignmentStatus.ASSIGNED.value
        assert row.position == "driver"
        # The earlier confirmation belonged to the abandoned seat.
        assert row.confirmed_at is None

    async def test_member_can_sign_up_again_after_a_cancellation(
        self, db_session, org_and_members
    ):
        org_id, officer_id, member_id, _ = org_and_members
        svc = SchedulingService(db_session)
        shift = await _shift_starting(svc, org_id, officer_id, minutes_from_now=600)

        first, err = await _self_signup(svc, org_id, shift, member_id)
        assert err is None, err
        # What approved time off does to a member's seat on that date.
        first.assignment_status = AssignmentStatus.CANCELLED
        await db_session.flush()

        again, err = await _self_signup(svc, org_id, shift, member_id)
        assert err is None, err
        rows = await _rows_for(db_session, shift.id, member_id)
        assert [r.assignment_status for r in rows] == [AssignmentStatus.ASSIGNED.value]

    async def test_officer_can_reassign_a_member_who_declined(
        self, db_session, org_and_members
    ):
        org_id, officer_id, member_id, _ = org_and_members
        svc = SchedulingService(db_session)
        shift = await _shift_starting(svc, org_id, officer_id, minutes_from_now=600)

        first, err = await svc.create_assignment(
            uuid.UUID(org_id),
            uuid.UUID(shift.id),
            {"user_id": member_id, "position": "firefighter"},
            uuid.UUID(officer_id),
        )
        assert err is None, err
        _, err = await svc.decline_assignment(
            uuid.UUID(first.id), uuid.UUID(member_id), uuid.UUID(org_id)
        )
        assert err is None, err

        again, err = await svc.create_assignment(
            uuid.UUID(org_id),
            uuid.UUID(shift.id),
            {"user_id": member_id, "position": "firefighter"},
            uuid.UUID(officer_id),
        )
        assert err is None, err
        assert again.assignment_status == AssignmentStatus.ASSIGNED


class TestWhatStillBlocks:
    async def test_an_active_seat_still_refuses_a_second_signup(
        self, db_session, org_and_members
    ):
        org_id, officer_id, member_id, _ = org_and_members
        svc = SchedulingService(db_session)
        shift = await _shift_starting(svc, org_id, officer_id, minutes_from_now=600)

        first, err = await _self_signup(svc, org_id, shift, member_id)
        assert err is None, err

        second, err = await _self_signup(svc, org_id, shift, member_id, "driver")
        assert second is None
        assert err is not None
        assert "already assigned" in err

        rows = await _rows_for(db_session, shift.id, member_id)
        assert [(r.id, r.position) for r in rows] == [(first.id, "firefighter")]

    async def test_a_refused_resignup_keeps_the_declined_row(
        self, db_session, org_and_members
    ):
        """The old row goes only once the new seat is actually granted."""
        org_id, officer_id, member_id, _ = org_and_members
        svc = SchedulingService(db_session)
        # Already under way: an officer may seat the member, a member may not.
        shift = await _shift_starting(svc, org_id, officer_id, minutes_from_now=-60)

        first, err = await svc.create_assignment(
            uuid.UUID(org_id),
            uuid.UUID(shift.id),
            {"user_id": member_id, "position": "firefighter"},
            uuid.UUID(officer_id),
        )
        assert err is None, err
        _, err = await svc.decline_assignment(
            uuid.UUID(first.id), uuid.UUID(member_id), uuid.UUID(org_id)
        )
        assert err is None, err

        again, err = await _self_signup(svc, org_id, shift, member_id)
        assert again is None
        assert err is not None

        rows = await _rows_for(db_session, shift.id, member_id)
        assert [(r.id, r.assignment_status) for r in rows] == [
            (first.id, AssignmentStatus.DECLINED.value)
        ]

    async def test_another_members_declined_row_is_untouched(
        self, db_session, org_and_members
    ):
        org_id, officer_id, member_id, other_id = org_and_members
        svc = SchedulingService(db_session)
        shift = await _shift_starting(svc, org_id, officer_id, minutes_from_now=600)

        others, err = await _self_signup(svc, org_id, shift, other_id)
        assert err is None, err
        _, err = await svc.decline_assignment(
            uuid.UUID(others.id),
            uuid.UUID(other_id),
            uuid.UUID(org_id),
            actor=SignupActor.MEMBER,
        )
        assert err is None, err

        mine, err = await _self_signup(svc, org_id, shift, member_id)
        assert err is None, err

        rows = await _rows_for(db_session, shift.id, other_id)
        assert [(r.id, r.assignment_status) for r in rows] == [
            (others.id, AssignmentStatus.DECLINED.value)
        ]

"""Attendance and call records on a finalized or cancelled shift.

Finalizing a shift snapshots its hours and call count and feeds training
tracking, so the records behind those snapshots are locked until the shift is
reopened. ``delete_shift_call`` already refused; these tests cover the write
paths that did not: adding, editing and removing attendance, creating and
editing calls, a member's own check-in, and finalizing a cancelled shift.
"""

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.scheduling_service import SchedulingService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def org_and_users(db_session: AsyncSession):
    org_id, officer_id, member_id = _uid(), _uid(), _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone, settings) "
            "VALUES (:id, 'Test FD', 'fire_department', :slug, 'UTC', :settings)"
        ),
        {"id": org_id, "slug": f"test-{org_id[:8]}", "settings": json.dumps({})},
    )
    for uid, uname in [(officer_id, "officer1"), (member_id, "ff1")]:
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) VALUES "
                "(:id, :org, :un, 'A', 'B', :em, 'hashed', 'active')"
            ),
            {"id": uid, "org": org_id, "un": uname, "em": f"{uname}@test.com"},
        )
    await db_session.flush()
    return org_id, officer_id, member_id


async def _shift(svc, org_id, officer_id, start: datetime, hours: int = 12):
    shift, err = await svc.create_shift(
        uuid.UUID(org_id),
        {
            "shift_date": start.date(),
            "start_time": start,
            "end_time": start + timedelta(hours=hours),
        },
        uuid.UUID(officer_id),
    )
    assert err is None, err
    return shift


def _yesterday_morning() -> datetime:
    now = datetime.now(timezone.utc)
    return (now - timedelta(days=1)).replace(hour=7, minute=0, second=0, microsecond=0)


class TestAddAttendance:
    async def test_refuses_a_second_row_for_the_same_member(
        self, db_session, org_and_users
    ):
        """A second row makes check-out and My Attendance raise
        MultipleResultsFound, so the member's own check-out fails."""
        org_id, officer_id, member_id = org_and_users
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, officer_id, _yesterday_morning())

        first, err = await svc.add_attendance(
            uuid.UUID(shift.id), uuid.UUID(org_id), {"user_id": member_id}
        )
        assert err is None
        second, err = await svc.add_attendance(
            uuid.UUID(shift.id), uuid.UUID(org_id), {"user_id": member_id}
        )

        assert second is None
        assert "already" in err.lower()
        records = await svc.get_shift_attendance(uuid.UUID(shift.id), uuid.UUID(org_id))
        assert [r.id for r in records] == [first.id]

    async def test_refuses_a_finalized_shift(self, db_session, org_and_users):
        org_id, officer_id, member_id = org_and_users
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, officer_id, _yesterday_morning())
        shift_id = shift.id
        shift.is_finalized = True
        await db_session.flush()

        att, err = await svc.add_attendance(
            uuid.UUID(shift_id), uuid.UUID(org_id), {"user_id": member_id}
        )

        assert att is None
        assert "finalized" in err
        db_session.expire_all()
        assert (
            await svc.get_shift_attendance(uuid.UUID(shift_id), uuid.UUID(org_id)) == []
        )

    async def test_refuses_a_cancelled_shift(self, db_session, org_and_users):
        org_id, officer_id, member_id = org_and_users
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, officer_id, _yesterday_morning())
        _, err = await svc.cancel_shift(uuid.UUID(shift.id), uuid.UUID(org_id))
        assert err is None

        att, err = await svc.add_attendance(
            uuid.UUID(shift.id), uuid.UUID(org_id), {"user_id": member_id}
        )

        assert att is None
        assert "cancelled" in err

    async def test_refuses_check_out_before_check_in(self, db_session, org_and_users):
        """A reversed pair stored a negative duration."""
        org_id, officer_id, member_id = org_and_users
        svc = SchedulingService(db_session)
        start = _yesterday_morning()
        shift = await _shift(svc, org_id, officer_id, start)

        att, err = await svc.add_attendance(
            uuid.UUID(shift.id),
            uuid.UUID(org_id),
            {
                "user_id": member_id,
                "checked_in_at": start + timedelta(hours=12),
                "checked_out_at": start,
            },
        )

        assert att is None
        assert "check-out" in err.lower()


class TestUpdateAndRemoveAttendance:
    async def _attended(self, svc, org_id, officer_id, member_id):
        start = _yesterday_morning()
        shift = await _shift(svc, org_id, officer_id, start)
        att, err = await svc.add_attendance(
            uuid.UUID(shift.id),
            uuid.UUID(org_id),
            {
                "user_id": member_id,
                "checked_in_at": start,
                "checked_out_at": start + timedelta(hours=12),
            },
        )
        assert err is None
        return shift, att, start

    async def test_update_refuses_check_out_before_stored_check_in(
        self, db_session, org_and_users
    ):
        org_id, officer_id, member_id = org_and_users
        svc = SchedulingService(db_session)
        _, att, start = await self._attended(svc, org_id, officer_id, member_id)

        updated, err = await svc.update_attendance(
            uuid.UUID(att.id),
            uuid.UUID(org_id),
            {"checked_out_at": start - timedelta(hours=1)},
        )

        assert updated is None
        assert "check-out" in err.lower()

    async def test_update_refuses_a_finalized_shift(self, db_session, org_and_users):
        org_id, officer_id, member_id = org_and_users
        svc = SchedulingService(db_session)
        shift, att, start = await self._attended(svc, org_id, officer_id, member_id)
        shift_id, att_id = shift.id, att.id
        shift.is_finalized = True
        await db_session.flush()

        updated, err = await svc.update_attendance(
            uuid.UUID(att_id),
            uuid.UUID(org_id),
            {"checked_out_at": start + timedelta(hours=20)},
        )

        assert updated is None
        assert "finalized" in err
        db_session.expire_all()
        records = await svc.get_shift_attendance(uuid.UUID(shift_id), uuid.UUID(org_id))
        assert records[0].duration_minutes == 720

    async def test_remove_refuses_a_finalized_shift(self, db_session, org_and_users):
        org_id, officer_id, member_id = org_and_users
        svc = SchedulingService(db_session)
        shift, att, _ = await self._attended(svc, org_id, officer_id, member_id)
        shift_id, att_id = shift.id, att.id
        shift.is_finalized = True
        await db_session.flush()

        success, err = await svc.remove_attendance(uuid.UUID(att_id), uuid.UUID(org_id))

        assert success is False
        assert "finalized" in err
        db_session.expire_all()
        records = await svc.get_shift_attendance(uuid.UUID(shift_id), uuid.UUID(org_id))
        assert [r.id for r in records] == [att_id]


class TestShiftCallsOnAFinalizedShift:
    async def test_create_refuses(self, db_session, org_and_users):
        org_id, officer_id, _ = org_and_users
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, officer_id, _yesterday_morning())
        shift_id = shift.id
        shift.is_finalized = True
        await db_session.flush()

        call, err = await svc.create_shift_call(
            uuid.UUID(org_id), uuid.UUID(shift_id), {"incident_type": "ems"}
        )

        assert call is None
        assert "finalized" in err
        db_session.expire_all()
        assert await svc.get_shift_calls(uuid.UUID(shift_id), uuid.UUID(org_id)) == []

    async def test_update_refuses(self, db_session, org_and_users):
        org_id, officer_id, _ = org_and_users
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, officer_id, _yesterday_morning())
        call, err = await svc.create_shift_call(
            uuid.UUID(org_id), uuid.UUID(shift.id), {"incident_type": "ems"}
        )
        assert err is None
        call_id = call.id
        shift.is_finalized = True
        await db_session.flush()

        updated, err = await svc.update_shift_call(
            uuid.UUID(call_id), uuid.UUID(org_id), {"incident_type": "fire"}
        )

        assert updated is None
        assert "finalized" in err
        db_session.expire_all()
        stored = await svc.get_shift_call_by_id(uuid.UUID(call_id), uuid.UUID(org_id))
        assert stored.incident_type == "ems"


class TestCancelledShift:
    async def test_member_cannot_check_in(self, db_session, org_and_users):
        org_id, officer_id, member_id = org_and_users
        svc = SchedulingService(db_session)
        start = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(hours=1)
        shift = await _shift(svc, org_id, officer_id, start)
        _, err = await svc.cancel_shift(uuid.UUID(shift.id), uuid.UUID(org_id))
        assert err is None

        att, err = await svc.member_check_in(shift.id, member_id, uuid.UUID(org_id))

        assert att is None
        assert "cancelled" in err

    async def test_cannot_be_finalized(self, db_session, org_and_users):
        org_id, officer_id, _ = org_and_users
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, officer_id, _yesterday_morning())
        _, err = await svc.cancel_shift(uuid.UUID(shift.id), uuid.UUID(org_id))
        assert err is None

        finalized, err = await svc.finalize_shift(
            uuid.UUID(shift.id), uuid.UUID(org_id), officer_id
        )

        assert finalized is None
        assert "cancelled" in err

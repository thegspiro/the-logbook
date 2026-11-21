"""A shift officer does not record their own hours (ADV2-8).

Owner decision 2026-11-16. The shift's named officer may close out the shift
without ``scheduling.manage``, which let them set their own check-in and
check-out times, add their own attendance row, or credit themselves manual
hours at finalize. Pre-shift work and event attendance already refuse the
self case; close-out now does too. A ``scheduling.manage`` holder may still
record anyone, themselves included.

The close-out wizard sends every member's row on each save, so the officer's
own row is refused only when it changes, compared to the minute.
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1.endpoints import scheduling as endpoint
from app.models.training import Shift, ShiftAttendance
from app.models.user import Organization, User, UserStatus
from app.schemas.scheduling import (
    CloseoutAttendanceEntry,
    CloseoutAttendanceRequest,
    ManualHoursEntry,
    ShiftAttendanceCreate,
    ShiftFinalizeRequest,
)

pytestmark = [pytest.mark.integration]

START = datetime(2026, 11, 10, 7, 0, tzinfo=timezone.utc)
END = START + timedelta(hours=12)


def _caller(user, permissions=()) -> SimpleNamespace:
    return SimpleNamespace(
        id=user.id,
        organization_id=user.organization_id,
        username="crew",
        positions=[SimpleNamespace(slug="officer", permissions=list(permissions))],
        roles=[],
        rank=None,
    )


async def _person(db, org_id: str, name: str) -> SimpleNamespace:
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        username=f"{name}-{uuid.uuid4().hex[:8]}",
        email=f"{name}-{uuid.uuid4().hex[:8]}@own-hours.test",
        first_name=name.title(),
        last_name="Crew",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db.add(user)
    await db.flush()
    # Plain values: a refused save rolls back and expires every ORM object,
    # and reading an expired attribute outside the session's await fails.
    return SimpleNamespace(id=user.id, organization_id=org_id)


@pytest.fixture
async def shift(db_session):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Own Hours Department",
        slug=f"own-hours-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(org)
    await db_session.flush()
    officer = await _person(db_session, org.id, "officer")
    member = await _person(db_session, org.id, "member")
    record = Shift(
        organization_id=org.id,
        shift_date=START.date(),
        start_time=START,
        end_time=END,
        shift_officer_id=officer.id,
        open_to_all_members=True,
    )
    db_session.add(record)
    await db_session.flush()
    # The officer checked in themselves, at a time with seconds in it.
    db_session.add(
        ShiftAttendance(
            id=str(uuid.uuid4()),
            shift_id=record.id,
            user_id=officer.id,
            checked_in_at=START + timedelta(minutes=2, seconds=34),
            checked_out_at=END,
            duration_minutes=718,
        )
    )
    # Committed, so it survives the rollback a refused save makes.
    await db_session.commit()
    return SimpleNamespace(
        db=db_session,
        shift=SimpleNamespace(id=record.id, organization_id=org.id),
        officer=officer,
        member=member,
    )


def _entry(user, checked_in, checked_out) -> CloseoutAttendanceEntry:
    return CloseoutAttendanceEntry(
        user_id=user.id, checked_in_at=checked_in, checked_out_at=checked_out
    )


async def _row(db, shift_id: str, user_id: str):
    db.expire_all()
    return (
        await db.execute(
            select(ShiftAttendance).where(
                ShiftAttendance.shift_id == shift_id,
                ShiftAttendance.user_id == user_id,
            )
        )
    ).scalar_one_or_none()


async def _save(f, caller, *entries):
    return await endpoint.save_shift_closeout_attendance(
        uuid.UUID(f.shift.id),
        CloseoutAttendanceRequest(entries=list(entries)),
        db=f.db,
        current_user=caller,
    )


class TestCloseoutAttendance:
    async def test_the_officer_cannot_change_their_own_times(self, shift):
        f = shift
        with pytest.raises(HTTPException) as refused:
            await _save(
                f,
                _caller(f.officer),
                _entry(f.member, START, END),
                _entry(f.officer, START - timedelta(hours=2), END),
            )

        assert refused.value.status_code == 403
        own = await _row(f.db, f.shift.id, f.officer.id)
        assert own.checked_in_at.replace(tzinfo=None) == (
            START + timedelta(minutes=2, seconds=34)
        ).replace(tzinfo=None)
        # Nothing in the refused save was applied, the colleague's row included.
        assert await _row(f.db, f.shift.id, f.member.id) is None

    async def test_their_own_row_sent_back_unchanged_saves_the_rest(self, shift):
        f = shift
        # What the wizard sends: the stored check-in, cut to the minute.
        state = await _save(
            f,
            _caller(f.officer),
            _entry(f.member, START, END),
            _entry(f.officer, START + timedelta(minutes=2), END),
        )

        assert state["own_hours_locked_user_id"] == f.officer.id
        member_row = await _row(f.db, f.shift.id, f.member.id)
        assert member_row.duration_minutes == 720
        own = await _row(f.db, f.shift.id, f.officer.id)
        assert own.duration_minutes == 718

    async def test_an_officer_with_no_row_cannot_add_one(self, shift):
        f = shift
        other_officer = await _person(f.db, f.shift.organization_id, "relief")
        record = await f.db.get(Shift, f.shift.id)
        record.shift_officer_id = other_officer.id
        await f.db.commit()

        blank = await _save(
            f, _caller(other_officer), _entry(other_officer, None, None)
        )
        assert blank["own_hours_locked_user_id"] == other_officer.id
        assert await _row(f.db, f.shift.id, other_officer.id) is None

        with pytest.raises(HTTPException) as refused:
            await _save(f, _caller(other_officer), _entry(other_officer, START, END))
        assert refused.value.status_code == 403

    async def test_a_scheduling_admin_records_anyone_themselves_included(self, shift):
        f = shift
        admin = _caller(f.officer, ["scheduling.manage"])

        state = await _save(f, admin, _entry(f.officer, START, END))

        assert state["own_hours_locked_user_id"] is None
        own = await _row(f.db, f.shift.id, f.officer.id)
        assert own.duration_minutes == 720


class TestTheOtherPaths:
    async def test_the_officer_cannot_add_their_own_attendance_row(self, shift):
        f = shift
        with pytest.raises(HTTPException) as refused:
            await endpoint.add_attendance(
                uuid.UUID(f.shift.id),
                ShiftAttendanceCreate(
                    user_id=f.officer.id, checked_in_at=START, checked_out_at=END
                ),
                db=f.db,
                current_user=_caller(f.officer),
            )
        assert refused.value.status_code == 403

    async def test_the_officer_cannot_credit_themselves_manual_hours(self, shift):
        f = shift
        with pytest.raises(HTTPException) as refused:
            await endpoint.finalize_shift(
                uuid.UUID(f.shift.id),
                ShiftFinalizeRequest(
                    manual_hours=[ManualHoursEntry(user_id=f.officer.id, hours=12)]
                ),
                db=f.db,
                current_user=_caller(f.officer),
            )
        assert refused.value.status_code == 403
        f.db.expire_all()
        reloaded = await f.db.get(Shift, f.shift.id)
        assert not reloaded.is_finalized

    async def test_the_get_tells_the_wizard_which_row_is_locked(self, shift):
        f = shift
        state = await endpoint.get_shift_closeout_state(
            uuid.UUID(f.shift.id), db=f.db, current_user=_caller(f.officer)
        )
        assert state["own_hours_locked_user_id"] == f.officer.id

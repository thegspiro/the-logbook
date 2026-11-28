"""Scheduling (app-review B19 pass 6).

- A member who once declined a seat on a shift can still take a seat on it
  by picking up an open swap; the declined row no longer collides with the
  seat being moved to them.
- Approving time off no longer cancels a seat on a shift that was already
  finalized: the hours were credited and the seat is history.
- A member cannot decline a seat on a finalized shift, and declining twice
  answers with the declined seat rather than an error.
- A rotation pattern's days on and days off cannot be negative.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.models.training import AssignmentStatus, ShiftAssignment, TimeOffStatus
from app.schemas.scheduling import ShiftPatternCreate, ShiftPatternUpdate
from app.services.scheduling_service import SchedulingService, SignupActor
from tests.test_open_swap_pickup import (
    _add_member,
    _add_org,
    _open_swap,
    _seat,
    _shift,
)


@pytest.fixture(autouse=True)
def _department_today(monkeypatch):
    monkeypatch.setattr(
        "app.services.scheduling_service.resolve_org_today",
        AsyncMock(return_value=date.today()),
    )


async def _status(db, assignment_id):
    return (
        await db.execute(
            select(ShiftAssignment.assignment_status).where(
                ShiftAssignment.id == assignment_id
            )
        )
    ).scalar_one()


async def _finalized_in_the_past(db, svc, org_id, manager, member, days_ago):
    shift = await _shift(svc, org_id, manager, days_ahead=3)
    seat = await _seat(svc, org_id, shift, member, manager, "driver")
    seat_id = str(seat.id)
    end = datetime.now(timezone.utc) - timedelta(days=days_ago, minutes=5)
    shift.shift_date = (end - timedelta(hours=12)).date()
    shift.start_time = end - timedelta(hours=12)
    shift.end_time = end
    await db.flush()
    _, err = await svc.finalize_shift(
        uuid.UUID(str(shift.id)),
        org_id,
        manager,
        manual_hours=[{"user_id": member, "hours": 12}],
    )
    assert err is None, err
    return shift, seat_id


@pytest.mark.integration
class TestPickUpAfterDeclining:
    async def test_the_declined_row_does_not_block_the_pickup(self, db_session):
        org_id = await _add_org(db_session)
        engineer = await _add_member(db_session, org_id, "engineer")
        engineer2 = await _add_member(db_session, org_id, "engineer")
        manager = await _add_member(db_session, org_id, None)
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, manager)
        await _seat(svc, org_id, shift, engineer, manager, "driver")
        other = await _seat(svc, org_id, shift, engineer2, manager, "firefighter")
        _, err = await svc.decline_assignment(
            uuid.UUID(str(other.id)), engineer2, org_id
        )
        assert err is None
        swap = await _open_swap(svc, org_id, engineer, shift)

        result, err = await svc.pick_up_open_swap(
            uuid.UUID(str(swap.id)), org_id, engineer2
        )

        assert err is None
        assert result is not None
        seats = (
            (
                await db_session.execute(
                    select(ShiftAssignment).where(
                        ShiftAssignment.shift_id == str(shift.id),
                        ShiftAssignment.user_id == engineer2,
                    )
                )
            )
            .scalars()
            .all()
        )
        # One row per member per shift: the declined one is gone and the
        # driver's seat is theirs.
        assert [s.position for s in seats] == ["driver"]


@pytest.mark.integration
class TestTimeOffAndFinalizedShifts:
    async def test_approval_leaves_a_finalized_seat_alone(self, db_session):
        org_id = await _add_org(db_session)
        engineer = await _add_member(db_session, org_id, "engineer")
        manager = await _add_member(db_session, org_id, None)
        svc = SchedulingService(db_session)
        shift, seat_id = await _finalized_in_the_past(
            db_session, svc, org_id, manager, engineer, days_ago=4
        )
        before = await _status(db_session, seat_id)
        request, err = await svc.create_time_off(
            org_id,
            engineer,
            {
                "start_date": shift.shift_date - timedelta(days=1),
                "end_date": date.today() + timedelta(days=1),
            },
        )
        assert err is None

        _, err = await svc.review_time_off(
            uuid.UUID(str(request.id)), org_id, manager, TimeOffStatus.APPROVED
        )

        assert err is None
        assert await _status(db_session, seat_id) == before
        assert before != AssignmentStatus.CANCELLED


@pytest.mark.integration
class TestDecliningAFinalizedSeat:
    async def test_is_refused(self, db_session):
        org_id = await _add_org(db_session)
        engineer = await _add_member(db_session, org_id, "engineer")
        manager = await _add_member(db_session, org_id, None)
        svc = SchedulingService(db_session)
        _, seat_id = await _finalized_in_the_past(
            db_session, svc, org_id, manager, engineer, days_ago=0
        )
        before = await _status(db_session, seat_id)

        result, err = await svc.decline_assignment(
            uuid.UUID(seat_id), engineer, org_id, actor=SignupActor.MEMBER
        )

        assert result is None
        assert err == "Shift was finalized"
        assert await _status(db_session, seat_id) == before

    async def test_declining_twice_returns_the_declined_seat(self, db_session):
        org_id = await _add_org(db_session)
        engineer = await _add_member(db_session, org_id, "engineer")
        manager = await _add_member(db_session, org_id, None)
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, manager)
        seat = await _seat(svc, org_id, shift, engineer, manager, "driver")
        await svc.decline_assignment(uuid.UUID(str(seat.id)), engineer, org_id)

        result, err = await svc.decline_assignment(
            uuid.UUID(str(seat.id)), engineer, org_id
        )

        assert err is None
        assert result is not None
        assert result.assignment_status == AssignmentStatus.DECLINED


@pytest.mark.unit
class TestPatternDays:
    @pytest.mark.parametrize("schema", [ShiftPatternCreate, ShiftPatternUpdate])
    @pytest.mark.parametrize("field", ["days_on", "days_off"])
    def test_a_negative_count_is_refused(self, schema, field):
        payload = {field: -2}
        if schema is ShiftPatternCreate:
            payload.update(
                name="Rotation", pattern_type="platoon", start_date=date(2026, 1, 1)
            )
        with pytest.raises(ValidationError):
            schema(**payload)

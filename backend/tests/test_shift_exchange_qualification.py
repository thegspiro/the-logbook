"""
A two-way shift exchange needs both members cleared for the seat they take.

Seats stay with their shifts: after an exchange each member works the other's
seat, so each must be eligible for that seat's position by the same rule as
signup (rank grants, qualifications, completed training, open positions). The
rule is enforced when the request is submitted, applied to the exchange
picker, and re-checked at approval, where a duty officer may override it.

One-way requests — handing a seat over, or moving to another shift — are not
exchanges and are untouched by this rule.

The fixture department names no open positions, unlike the one in
``test_scheduling.py``: an open position is open to every member, which would
make everyone qualified for everything and prove nothing here.
"""

import json
import uuid
from datetime import date, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.api.v1.endpoints import scheduling as scheduling_endpoint
from app.core.error_codes import CodedValueError, ErrorCode
from app.models.training import ShiftAssignment, SwapRequestStatus
from app.schemas.scheduling import ShiftSwapReview
from app.services.scheduling_service import SchedulingService

pytestmark = [pytest.mark.integration]


@pytest.fixture(autouse=True)
def _department_today(monkeypatch):
    monkeypatch.setattr(
        "app.services.scheduling_service.resolve_org_today",
        AsyncMock(return_value=date.today()),
    )


def _uid() -> str:
    return str(uuid.uuid4())


async def _add_member(db_session, org_id: str, rank: str | None) -> str:
    user_id = _uid()
    username = f"m_{user_id[:8]}"
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status, rank) VALUES "
            "(:id, :org, :un, 'Test', :ln, :em, 'hashed', 'active', :rank)"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": username,
            "ln": (rank or "manager").title(),
            "em": f"{username}@test.com",
            "rank": rank,
        },
    )
    await db_session.flush()
    return user_id


@pytest.fixture
async def department(db_session):
    """Lieutenant, two engineers, a firefighter, and a reviewing officer.

    Default rank grants: a lieutenant may sit officer, driver or firefighter;
    an engineer driver or firefighter; a firefighter only firefighter.
    """
    org_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone, settings) "
            "VALUES (:id, 'Exchange FD', 'fire_department', :slug, "
            "'America/New_York', :settings)"
        ),
        {
            "id": org_id,
            "slug": f"xfd-{org_id[:8]}",
            "settings": json.dumps({"scheduling": {}}),
        },
    )
    members = {
        "lieutenant": await _add_member(db_session, org_id, "lieutenant"),
        "engineer": await _add_member(db_session, org_id, "engineer"),
        "engineer2": await _add_member(db_session, org_id, "engineer"),
        "firefighter": await _add_member(db_session, org_id, "firefighter"),
        "manager": await _add_member(db_session, org_id, None),
    }
    return org_id, members


async def _shift(svc, org_id, creator_id, days_ahead):
    day = date.today() + timedelta(days=days_ahead)
    shift, err = await svc.create_shift(
        uuid.UUID(org_id),
        {
            "shift_date": day,
            "start_time": datetime(day.year, day.month, day.day, 7, 0),
            "positions": [
                {"position": "officer", "required": True},
                {"position": "driver", "required": True},
                {"position": "firefighter", "required": True},
            ],
        },
        uuid.UUID(creator_id),
    )
    assert err is None
    return shift


async def _seat(svc, org_id, shift, user_id, creator_id, position):
    assignment, err = await svc.create_assignment(
        uuid.UUID(org_id),
        uuid.UUID(shift.id),
        {"user_id": user_id, "position": position},
        uuid.UUID(creator_id),
    )
    assert err is None, err
    return assignment


async def _exchange(svc, org_id, requester_id, offering, target_id, requested):
    return await svc.create_swap_request(
        uuid.UUID(org_id),
        uuid.UUID(requester_id),
        {
            "offering_shift_id": offering.id,
            "requesting_shift_id": requested.id,
            "target_user_id": target_id,
        },
    )


class TestRefusedWhenSubmitted:
    async def test_a_driver_cannot_exchange_with_a_firefighter_seat(
        self, db_session, department
    ):
        org_id, m = department
        svc = SchedulingService(db_session)
        a = await _shift(svc, org_id, m["manager"], 3)
        b = await _shift(svc, org_id, m["manager"], 4)
        await _seat(svc, org_id, a, m["engineer"], m["manager"], "driver")
        await _seat(svc, org_id, b, m["firefighter"], m["manager"], "firefighter")

        swap, err = await _exchange(svc, org_id, m["engineer"], a, m["firefighter"], b)

        assert swap is None
        assert (
            err == "The member you asked is not qualified for your Driver/Operator seat"
        )

    async def test_a_driver_cannot_take_an_officer_seat(self, db_session, department):
        org_id, m = department
        svc = SchedulingService(db_session)
        a = await _shift(svc, org_id, m["manager"], 3)
        b = await _shift(svc, org_id, m["manager"], 4)
        await _seat(svc, org_id, a, m["engineer"], m["manager"], "driver")
        await _seat(svc, org_id, b, m["lieutenant"], m["manager"], "officer")

        swap, err = await _exchange(svc, org_id, m["engineer"], a, m["lieutenant"], b)

        assert swap is None
        assert err == "You are not qualified for their Officer seat"

    async def test_an_officer_holding_a_driver_seat_can_exchange_with_a_driver(
        self, db_session, department
    ):
        org_id, m = department
        svc = SchedulingService(db_session)
        a = await _shift(svc, org_id, m["manager"], 3)
        b = await _shift(svc, org_id, m["manager"], 4)
        await _seat(svc, org_id, a, m["engineer"], m["manager"], "driver")
        await _seat(svc, org_id, b, m["lieutenant"], m["manager"], "driver")

        swap, err = await _exchange(svc, org_id, m["engineer"], a, m["lieutenant"], b)

        assert err is None
        assert swap.status == SwapRequestStatus.PENDING

    async def test_the_target_must_hold_a_seat_on_the_requested_shift(
        self, db_session, department
    ):
        org_id, m = department
        svc = SchedulingService(db_session)
        a = await _shift(svc, org_id, m["manager"], 3)
        b = await _shift(svc, org_id, m["manager"], 4)
        await _seat(svc, org_id, a, m["engineer"], m["manager"], "driver")

        swap, err = await _exchange(svc, org_id, m["engineer"], a, m["engineer2"], b)

        assert swap is None
        assert err == "That member is not on the shift you asked to exchange for"

    async def test_a_training_seat_cannot_be_exchanged(self, db_session, department):
        org_id, m = department
        svc = SchedulingService(db_session)
        a = await _shift(svc, org_id, m["manager"], 3)
        b = await _shift(svc, org_id, m["manager"], 4)
        mine = await _seat(svc, org_id, a, m["engineer"], m["manager"], "driver")
        await _seat(svc, org_id, b, m["engineer2"], m["manager"], "driver")
        mine.is_training = True
        await db_session.flush()

        swap, err = await _exchange(svc, org_id, m["engineer"], a, m["engineer2"], b)

        assert swap is None
        assert err == "A training seat cannot be exchanged"

    async def test_a_one_way_offer_is_not_an_exchange_and_is_not_gated(
        self, db_session, department
    ):
        org_id, m = department
        svc = SchedulingService(db_session)
        a = await _shift(svc, org_id, m["manager"], 3)
        await _seat(svc, org_id, a, m["engineer"], m["manager"], "driver")

        swap, err = await svc.create_swap_request(
            uuid.UUID(org_id),
            uuid.UUID(m["engineer"]),
            {"offering_shift_id": a.id, "target_user_id": m["firefighter"]},
        )

        assert err is None
        assert swap.status == SwapRequestStatus.PENDING


class TestRecheckedAtApproval:
    async def _pending_exchange_that_then_lapses(self, db_session, department):
        """Valid when submitted; the engineer is demoted before review."""
        org_id, m = department
        svc = SchedulingService(db_session)
        a = await _shift(svc, org_id, m["manager"], 3)
        b = await _shift(svc, org_id, m["manager"], 4)
        mine = await _seat(svc, org_id, a, m["engineer"], m["manager"], "driver")
        theirs = await _seat(svc, org_id, b, m["engineer2"], m["manager"], "driver")
        swap, err = await _exchange(svc, org_id, m["engineer"], a, m["engineer2"], b)
        assert err is None
        engineer = await db_session.get(scheduling_endpoint.User, m["engineer"])
        engineer.rank = "firefighter"
        await db_session.flush()
        return svc, org_id, m, swap, mine, theirs

    async def test_refused_with_the_override_code(self, db_session, department):
        svc, org_id, m, swap, _, _ = await self._pending_exchange_that_then_lapses(
            db_session, department
        )

        # Read before the refusal: the service rolls back, which expires it.
        swap_id = uuid.UUID(swap.id)

        with pytest.raises(CodedValueError) as refused:
            await svc.review_swap_request(
                swap_id,
                uuid.UUID(org_id),
                uuid.UUID(m["manager"]),
                SwapRequestStatus.APPROVED,
            )

        assert refused.value.error_code == ErrorCode.SCHED_EXCHANGE_NOT_QUALIFIED
        assert "requesting member is not qualified for the Driver/Operator seat" in str(
            refused.value
        )
        persisted = await svc.get_swap_request_by_id(swap_id, uuid.UUID(org_id))
        assert persisted.status == SwapRequestStatus.PENDING

    async def test_an_officer_override_completes_it_and_is_noted(
        self, db_session, department
    ):
        (
            svc,
            org_id,
            m,
            swap,
            mine,
            theirs,
        ) = await self._pending_exchange_that_then_lapses(db_session, department)

        reviewed, err = await svc.review_swap_request(
            uuid.UUID(swap.id),
            uuid.UUID(org_id),
            uuid.UUID(m["manager"]),
            SwapRequestStatus.APPROVED,
            reviewer_notes="Short-handed weekend",
            override_qualification=True,
        )

        assert err is None
        assert reviewed.status == SwapRequestStatus.APPROVED
        assert reviewed.reviewer_notes == (
            f"{SchedulingService.QUALIFICATION_OVERRIDE_NOTE} Short-handed weekend"
        )
        assert svc.last_review_overrode_qualification is True
        seats = {
            row.id: str(row.user_id)
            for row in (
                await db_session.execute(
                    ShiftAssignment.__table__.select().where(
                        ShiftAssignment.id.in_([mine.id, theirs.id])
                    )
                )
            ).all()
        }
        assert seats[mine.id] == m["engineer2"]
        assert seats[theirs.id] == m["engineer"]

    async def test_a_qualified_exchange_is_not_marked_as_overridden(
        self, db_session, department
    ):
        org_id, m = department
        svc = SchedulingService(db_session)
        a = await _shift(svc, org_id, m["manager"], 3)
        b = await _shift(svc, org_id, m["manager"], 4)
        await _seat(svc, org_id, a, m["engineer"], m["manager"], "driver")
        await _seat(svc, org_id, b, m["engineer2"], m["manager"], "driver")
        swap, _ = await _exchange(svc, org_id, m["engineer"], a, m["engineer2"], b)

        reviewed, err = await svc.review_swap_request(
            uuid.UUID(swap.id),
            uuid.UUID(org_id),
            uuid.UUID(m["manager"]),
            SwapRequestStatus.APPROVED,
            reviewer_notes="ok",
            override_qualification=True,
        )

        assert err is None
        assert reviewed.reviewer_notes == "ok"
        assert svc.last_review_overrode_qualification is False

    async def test_the_endpoint_audits_an_override(
        self, db_session, department, monkeypatch
    ):
        svc, org_id, m, swap, _, _ = await self._pending_exchange_that_then_lapses(
            db_session, department
        )
        audit = AsyncMock()
        monkeypatch.setattr(scheduling_endpoint, "log_audit_event", audit)
        manager = await db_session.get(scheduling_endpoint.User, m["manager"])

        await scheduling_endpoint.review_swap_request(
            uuid.UUID(swap.id),
            ShiftSwapReview(
                status=SwapRequestStatus.APPROVED, override_qualification=True
            ),
            db=db_session,
            current_user=manager,
        )

        audit.assert_awaited_once()
        assert (
            audit.await_args.kwargs["event_type"]
            == "shift_exchange_qualification_override"
        )


class TestExchangePicker:
    async def test_lists_only_seats_both_members_qualify_for(
        self, db_session, department
    ):
        org_id, m = department
        svc = SchedulingService(db_session)
        a = await _shift(svc, org_id, m["manager"], 3)
        b = await _shift(svc, org_id, m["manager"], 4)
        c = await _shift(svc, org_id, m["manager"], 5)
        await _seat(svc, org_id, a, m["engineer"], m["manager"], "driver")
        await _seat(svc, org_id, b, m["lieutenant"], m["manager"], "officer")
        await _seat(svc, org_id, b, m["engineer2"], m["manager"], "driver")
        await _seat(svc, org_id, c, m["firefighter"], m["manager"], "firefighter")
        await _seat(svc, org_id, c, m["lieutenant"], m["manager"], "driver")

        candidates = await svc.get_exchange_candidates(
            uuid.UUID(org_id), uuid.UUID(a.id), uuid.UUID(m["engineer"])
        )

        listed = {(c["shift_id"], c["user_id"], c["position"]) for c in candidates}
        assert listed == {
            (b.id, m["engineer2"], "driver"),
            (c.id, m["lieutenant"], "driver"),
        }

    async def test_skips_shifts_the_caller_already_works(self, db_session, department):
        org_id, m = department
        svc = SchedulingService(db_session)
        a = await _shift(svc, org_id, m["manager"], 3)
        b = await _shift(svc, org_id, m["manager"], 4)
        await _seat(svc, org_id, a, m["engineer"], m["manager"], "driver")
        await _seat(svc, org_id, b, m["engineer"], m["manager"], "firefighter")
        await _seat(svc, org_id, b, m["engineer2"], m["manager"], "driver")

        candidates = await svc.get_exchange_candidates(
            uuid.UUID(org_id), uuid.UUID(a.id), uuid.UUID(m["engineer"])
        )

        assert candidates == []

    async def test_no_seat_on_the_shift_is_a_409(self, db_session, department):
        org_id, m = department
        svc = SchedulingService(db_session)
        a = await _shift(svc, org_id, m["manager"], 3)
        caller = await db_session.get(scheduling_endpoint.User, m["engineer"])

        with pytest.raises(HTTPException) as refused:
            await scheduling_endpoint.list_exchange_candidates(
                uuid.UUID(a.id), db=db_session, current_user=caller
            )

        assert refused.value.status_code == 409

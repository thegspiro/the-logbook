"""
An open swap is offered to the members cleared for its seat (W33-4).

An open swap names nobody and asks for no shift back. It used to be visible
only to its requester and the officers, and an officer's approval "moved
nothing" while telling the member "Swap Request Approved". Now every member
cleared for the seat by the signup eligibility rule — the rule exchanges use —
sees it, and the first to pick it up takes the seat. Approval no longer applies
to an open swap; denying one still does.

The fixture department names no open positions (see
``test_shift_exchange_qualification.py``): an open position would make every
member eligible for every seat and prove nothing here.
"""

import json
import uuid
from datetime import date, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select, text

from app.api.v1.endpoints import scheduling as scheduling_endpoint
from app.models.training import ShiftAssignment, SwapRequestStatus
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


async def _add_org(db_session) -> str:
    org_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone, settings) "
            "VALUES (:id, 'Pickup FD', 'fire_department', :slug, "
            "'America/New_York', :settings)"
        ),
        {
            "id": org_id,
            "slug": f"pfd-{org_id[:8]}",
            "settings": json.dumps({"scheduling": {}}),
        },
    )
    return org_id


async def _add_member(db_session, org_id: str, rank: str | None) -> str:
    user_id = _uid()
    username = f"p_{user_id[:8]}"
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            # `rank` is reserved in MySQL 8; quoted for the same reason as in
            # test_shift_exchange_qualification.py.
            "last_name, email, password_hash, status, `rank`) VALUES "
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
    """Lieutenant, two engineers, a firefighter, and an officer to review.

    Default rank grants: a lieutenant may sit officer, driver or firefighter;
    an engineer driver or firefighter; a firefighter only firefighter.
    """
    org_id = await _add_org(db_session)
    members = {
        "lieutenant": await _add_member(db_session, org_id, "lieutenant"),
        "engineer": await _add_member(db_session, org_id, "engineer"),
        "engineer2": await _add_member(db_session, org_id, "engineer"),
        "firefighter": await _add_member(db_session, org_id, "firefighter"),
        "manager": await _add_member(db_session, org_id, None),
    }
    return org_id, members


async def _shift(svc, org_id, creator_id, days_ahead=3):
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


async def _open_swap(svc, org_id, requester_id, shift):
    swap, err = await svc.create_swap_request(
        uuid.UUID(org_id),
        uuid.UUID(requester_id),
        {"offering_shift_id": shift.id, "reason": "Family commitment"},
    )
    assert err is None, err
    return swap


async def _holder(db_session, assignment_id: str) -> str:
    # Takes the id, not the row: a refused pickup rolls the session back,
    # which expires the row and turns ``row.id`` into a lazy load.
    row = (
        await db_session.execute(
            select(ShiftAssignment.user_id).where(ShiftAssignment.id == assignment_id)
        )
    ).scalar_one()
    return str(row)


class TestWhoIsOffered:
    async def test_a_member_cleared_for_the_seat_sees_it(self, db_session, department):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        await _seat(svc, org_id, shift, m["engineer"], m["manager"], "driver")
        swap = await _open_swap(svc, org_id, m["engineer"], shift)

        offered = await svc.get_open_swaps_for_member(
            uuid.UUID(org_id), uuid.UUID(m["engineer2"])
        )

        assert [o["swap_request_id"] for o in offered] == [str(swap.id)]
        assert offered[0]["position"] == "driver"
        assert offered[0]["reason"] == "Family commitment"

    async def test_a_member_not_cleared_for_the_seat_does_not(
        self, db_session, department
    ):
        """A firefighter is not cleared to drive, so a driver seat is not
        offered to them — the exchange rule, applied to a pickup."""
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        await _seat(svc, org_id, shift, m["engineer"], m["manager"], "driver")
        await _open_swap(svc, org_id, m["engineer"], shift)

        offered = await svc.get_open_swaps_for_member(
            uuid.UUID(org_id), uuid.UUID(m["firefighter"])
        )

        assert offered == []

    async def test_the_requester_is_not_offered_their_own_seat(
        self, db_session, department
    ):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        await _seat(svc, org_id, shift, m["engineer"], m["manager"], "driver")
        await _open_swap(svc, org_id, m["engineer"], shift)

        assert (
            await svc.get_open_swaps_for_member(
                uuid.UUID(org_id), uuid.UUID(m["engineer"])
            )
            == []
        )

    async def test_a_member_already_on_the_shift_is_not_offered_it(
        self, db_session, department
    ):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        await _seat(svc, org_id, shift, m["engineer"], m["manager"], "driver")
        await _seat(svc, org_id, shift, m["lieutenant"], m["manager"], "officer")
        await _open_swap(svc, org_id, m["engineer"], shift)

        assert (
            await svc.get_open_swaps_for_member(
                uuid.UUID(org_id), uuid.UUID(m["lieutenant"])
            )
            == []
        )

    async def test_another_departments_member_is_offered_nothing(
        self, db_session, department
    ):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        await _seat(svc, org_id, shift, m["engineer"], m["manager"], "driver")
        await _open_swap(svc, org_id, m["engineer"], shift)
        other_org = await _add_org(db_session)
        outsider = await _add_member(db_session, other_org, "engineer")

        assert (
            await svc.get_open_swaps_for_member(
                uuid.UUID(other_org), uuid.UUID(outsider)
            )
            == []
        )


class TestPickingUp:
    async def test_the_seat_moves_to_the_member_who_picks_it_up(
        self, db_session, department
    ):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        seat = await _seat(svc, org_id, shift, m["engineer"], m["manager"], "driver")
        seat_id = str(seat.id)
        swap = await _open_swap(svc, org_id, m["engineer"], shift)

        result, err = await svc.pick_up_open_swap(
            swap.id, uuid.UUID(org_id), uuid.UUID(m["engineer2"])
        )

        assert err is None
        assert result.status == SwapRequestStatus.APPROVED
        assert str(result.target_user_id) == m["engineer2"]
        assert await _holder(db_session, seat_id) == m["engineer2"]

    async def test_a_member_not_cleared_for_the_seat_is_refused(
        self, db_session, department
    ):
        """Never bypassed: a pickup sent without the list still meets the
        eligibility rule."""
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        seat = await _seat(svc, org_id, shift, m["lieutenant"], m["manager"], "officer")
        seat_id = str(seat.id)
        swap = await _open_swap(svc, org_id, m["lieutenant"], shift)

        result, err = await svc.pick_up_open_swap(
            swap.id, uuid.UUID(org_id), uuid.UUID(m["engineer"])
        )

        assert result is None
        assert "eligible" in err
        assert await _holder(db_session, seat_id) == m["lieutenant"]

    async def test_a_member_already_on_the_shift_is_refused(
        self, db_session, department
    ):
        """The seat cap and duplicate checks are a signup's — one member
        cannot end up holding two seats on a shift."""
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        seat = await _seat(svc, org_id, shift, m["engineer"], m["manager"], "driver")
        seat_id = str(seat.id)
        await _seat(svc, org_id, shift, m["lieutenant"], m["manager"], "officer")
        swap = await _open_swap(svc, org_id, m["engineer"], shift)

        result, err = await svc.pick_up_open_swap(
            swap.id, uuid.UUID(org_id), uuid.UUID(m["lieutenant"])
        )

        assert result is None
        assert err
        assert await _holder(db_session, seat_id) == m["engineer"]

    async def test_it_can_be_picked_up_once(self, db_session, department):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        seat = await _seat(svc, org_id, shift, m["engineer"], m["manager"], "driver")
        seat_id = str(seat.id)
        swap = await _open_swap(svc, org_id, m["engineer"], shift)
        await svc.pick_up_open_swap(
            swap.id, uuid.UUID(org_id), uuid.UUID(m["engineer2"])
        )

        result, err = await svc.pick_up_open_swap(
            swap.id, uuid.UUID(org_id), uuid.UUID(m["lieutenant"])
        )

        assert result is None
        assert err == "This swap is not open for anyone to pick up"
        assert await _holder(db_session, seat_id) == m["engineer2"]

    async def test_a_member_cannot_pick_up_their_own(self, db_session, department):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        await _seat(svc, org_id, shift, m["engineer"], m["manager"], "driver")
        swap = await _open_swap(svc, org_id, m["engineer"], shift)

        result, err = await svc.pick_up_open_swap(
            swap.id, uuid.UUID(org_id), uuid.UUID(m["engineer"])
        )

        assert result is None
        assert err == "You cannot pick up your own shift"

    async def test_a_training_seat_cannot_be_picked_up(self, db_session, department):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        seat = await _seat(svc, org_id, shift, m["engineer"], m["manager"], "driver")
        seat_id = str(seat.id)
        seat.is_training = True
        await db_session.flush()
        swap = await _open_swap(svc, org_id, m["engineer"], shift)

        result, err = await svc.pick_up_open_swap(
            swap.id, uuid.UUID(org_id), uuid.UUID(m["engineer2"])
        )

        assert result is None
        assert "training seat" in err
        assert await _holder(db_session, seat_id) == m["engineer"]

    async def test_a_targeted_offer_is_not_open_for_pickup(
        self, db_session, department
    ):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        await _seat(svc, org_id, shift, m["engineer"], m["manager"], "driver")
        offer, err = await svc.create_swap_request(
            uuid.UUID(org_id),
            uuid.UUID(m["engineer"]),
            {"offering_shift_id": shift.id, "target_user_id": m["engineer2"]},
        )
        assert err is None

        result, err = await svc.pick_up_open_swap(
            offer.id, uuid.UUID(org_id), uuid.UUID(m["lieutenant"])
        )

        assert result is None
        assert err == "This swap is not open for anyone to pick up"

    async def test_another_departments_member_cannot_pick_it_up(
        self, db_session, department
    ):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        seat = await _seat(svc, org_id, shift, m["engineer"], m["manager"], "driver")
        seat_id = str(seat.id)
        swap = await _open_swap(svc, org_id, m["engineer"], shift)
        other_org = await _add_org(db_session)
        outsider = await _add_member(db_session, other_org, "engineer")

        result, err = await svc.pick_up_open_swap(
            swap.id, uuid.UUID(other_org), uuid.UUID(outsider)
        )

        assert result is None
        assert err == "Swap request not found"
        assert await _holder(db_session, seat_id) == m["engineer"]


class TestOfficerReview:
    async def test_approving_an_open_swap_is_refused(self, db_session, department):
        """It used to report "Approved" while moving nothing."""
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        seat = await _seat(svc, org_id, shift, m["engineer"], m["manager"], "driver")
        seat_id = str(seat.id)
        swap = await _open_swap(svc, org_id, m["engineer"], shift)

        result, err = await svc.review_swap_request(
            swap.id,
            uuid.UUID(org_id),
            uuid.UUID(m["manager"]),
            SwapRequestStatus.APPROVED,
        )

        assert result is None
        assert "picks it up" in err
        assert await _holder(db_session, seat_id) == m["engineer"]

    async def test_denying_an_open_swap_still_works(self, db_session, department):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        await _seat(svc, org_id, shift, m["engineer"], m["manager"], "driver")
        swap = await _open_swap(svc, org_id, m["engineer"], shift)

        result, err = await svc.review_swap_request(
            swap.id,
            uuid.UUID(org_id),
            uuid.UUID(m["manager"]),
            SwapRequestStatus.DENIED,
        )

        assert err is None
        assert result.status == SwapRequestStatus.DENIED

    async def test_the_shift_officer_is_not_asked_to_review_an_open_swap(
        self, db_session, department
    ):
        """There is no Approve to send them to; members pick it up."""
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        shift.shift_officer_id = m["manager"]
        await db_session.flush()
        await _seat(svc, org_id, shift, m["engineer"], m["manager"], "driver")
        send = AsyncMock()
        svc._send_notification = send

        await _open_swap(svc, org_id, m["engineer"], shift)

        message = send.await_args.kwargs["message"]
        assert "pick it up" in message
        assert "review" not in message


class TestRouting:
    def test_the_open_list_is_routed_before_the_by_id_read(self):
        """``/swap-requests/{request_id}`` would otherwise capture "open" and
        answer 422 for a path that is not a UUID."""
        paths = [getattr(r, "path", "") for r in scheduling_endpoint.router.routes]
        assert paths.index("/swap-requests/open") < paths.index(
            "/swap-requests/{request_id}"
        )

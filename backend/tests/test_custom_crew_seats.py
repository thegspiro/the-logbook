"""A department's own crew seat can be filled (SCHED-CUSTOM-SEAT).

A department defines its own seats (Scheduling → Position Names, or a seat
typed onto a template or apparatus), and until this change nobody could be put
in one: every request schema typed ``position`` as the closed ``ShiftPosition``
enum, and both position columns were MySQL ENUMs of the built-in seats.

The rule now is one function, ``app.utils.positions.resolve_seat``: a seat is
valid on a shift when the shift names it; a built-in seat keeps working exactly
as before; anything else is a 422 (``LB-SCHED-003``) on every path that seats a
member. Eligibility for a custom seat comes from where the department grants
seats today — a rank's ``eligible_positions``, the open-positions list, an
open-to-all shift — and with no grant nobody is eligible.

The fixture department names no open positions, which would make every member
eligible for every seat and prove nothing.
"""

import json
import uuid
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import sqlalchemy as sa
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints import scheduling as scheduling_endpoint
from app.core.error_codes import ErrorCode
from app.models.operational_rank import OperationalRank
from app.models.training import (
    ShiftAssignment,
    ShiftTemplate,
    StandingShiftClaim,
    SwapRequestStatus,
)
from app.schemas.scheduling import (
    ShiftAssignmentCreate,
    ShiftAssignmentUpdate,
    ShiftSignupRequest,
    ShiftSwapOfferResponseRequest,
    ShiftSwapReview,
    StandingShiftCreate,
)
from app.services.scheduling_service import SchedulingService
from app.services.shift_eligibility_service import ShiftEligibilityService
from app.utils.positions import (
    SEAT_NAME_MAX_LENGTH,
    UnknownSeatError,
    resolve_department_seat,
    resolve_seat,
)

CUSTOM = "rescue_tech"


# ---------------------------------------------------------------------------
# The rule itself, and the request schemas — no database
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestResolveSeat:
    def test_a_custom_seat_on_the_shift_is_accepted(self):
        assert resolve_seat(CUSTOM, ["officer", CUSTOM]) == CUSTOM

    def test_it_comes_back_in_the_shifts_spelling(self):
        # The assignment has to line up with the seat the board renders.
        assert resolve_seat(" Rescue_Tech ", ["officer", CUSTOM]) == CUSTOM

    def test_a_custom_seat_the_shift_does_not_name_is_unknown(self):
        with pytest.raises(UnknownSeatError) as caught:
            resolve_seat(CUSTOM, ["officer", "driver"])
        assert caught.value.error_code is ErrorCode.SCHED_UNKNOWN_SEAT
        assert "rescue_tech" in str(caught.value)

    def test_a_shift_with_no_seats_names_no_custom_seat(self):
        with pytest.raises(UnknownSeatError):
            resolve_seat(CUSTOM, [])

    @pytest.mark.parametrize("seats", [[], ["officer", "driver"]])
    def test_a_builtin_seat_is_unchanged(self, seats):
        # On a seatless shift any built-in seat is open; on a seated shift the
        # capacity check refuses a missing one, exactly as before.
        assert resolve_seat("FIREFIGHTER", seats) == "firefighter"
        assert resolve_seat("EMT", seats) == "ems"

    def test_a_builtin_enum_member_is_accepted(self):
        from app.models.training import ShiftPosition

        assert resolve_seat(ShiftPosition.DRIVER, ["driver"]) == "driver"

    def test_an_overlong_seat_is_refused(self):
        with pytest.raises(UnknownSeatError):
            resolve_seat("x" * (SEAT_NAME_MAX_LENGTH + 1), ["x" * 101])

    def test_the_department_vocabulary_for_a_standing_shift(self):
        assert resolve_department_seat("Rescue_Tech", [CUSTOM]) == CUSTOM
        assert resolve_department_seat("officer", []) == "officer"
        with pytest.raises(UnknownSeatError):
            resolve_department_seat("hazmat_tech", [CUSTOM])

    def test_the_endpoint_answers_an_unknown_seat_with_a_422(self):
        refusal = scheduling_endpoint._curated_refusal(UnknownSeatError("nope"))
        assert refusal.status_code == 422
        assert refusal.error_code is ErrorCode.SCHED_UNKNOWN_SEAT


@pytest.mark.unit
class TestRequestSchemas:
    """These refused any seat outside the enum with a 422 at request parsing."""

    @pytest.mark.parametrize(
        "schema", [ShiftSignupRequest, ShiftAssignmentUpdate, StandingShiftCreate]
    )
    def test_a_custom_seat_parses(self, schema):
        extra = (
            {"weekday": 1, "start_date": date.today(), "end_date": date.today()}
            if schema is StandingShiftCreate
            else {}
        )
        assert schema(position=CUSTOM, **extra).position == CUSTOM

    def test_the_assignment_create_schema_accepts_one(self):
        parsed = ShiftAssignmentCreate(user_id=uuid.uuid4(), position=CUSTOM)
        assert parsed.position == CUSTOM

    def test_a_seat_is_settled_like_a_stored_one(self):
        # canonical_position, as normalize_stored_positions applies on save.
        assert ShiftSignupRequest(position=" EMT ").position == "ems"
        assert ShiftSignupRequest(position=" Rescue_Tech ").position == "Rescue_Tech"

    def test_the_default_is_still_the_firefighter_seat(self):
        assert ShiftSignupRequest().position == "firefighter"

    @pytest.mark.parametrize("bad", ["", "   ", "x" * (SEAT_NAME_MAX_LENGTH + 1)])
    def test_a_blank_or_overlong_seat_is_refused(self, bad):
        with pytest.raises(ValidationError):
            ShiftSignupRequest(position=bad)


# ---------------------------------------------------------------------------
# Every path that seats a member — against the database
# ---------------------------------------------------------------------------


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
def _department_today(monkeypatch):
    monkeypatch.setattr(
        "app.services.scheduling_service.resolve_org_today",
        AsyncMock(return_value=date.today()),
    )


@pytest.fixture
def _no_audit(monkeypatch):
    monkeypatch.setattr(scheduling_endpoint, "log_audit_event", AsyncMock())


async def _add_org(db_session, name: str) -> str:
    org_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone, settings) "
            "VALUES (:id, :name, 'fire_department', :slug, "
            "'America/New_York', :settings)"
        ),
        {
            "id": org_id,
            "name": name,
            "slug": f"cs-{org_id[:8]}",
            "settings": json.dumps({"scheduling": {}}),
        },
    )
    return org_id


async def _add_member(db_session, org_id: str, rank: str | None) -> str:
    user_id = _uid()
    username = f"cs_{user_id[:8]}"
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            # `rank` is reserved in MySQL 8.
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
async def department(db_session, _department_today):
    """Two rescue technicians, a firefighter and an officer to assign.

    The department's own ``rescue`` rank grants the custom seat alongside the
    firefighter seat. The default ``firefighter`` rank grants only its own.
    A second department carries a template with a seat this one never defined.
    """
    org_id = await _add_org(db_session, "Custom Seat FD")
    db_session.add(
        OperationalRank(
            organization_id=org_id,
            rank_code="rescue",
            display_name="Rescue Technician",
            eligible_positions=["firefighter", CUSTOM],
        )
    )
    members = {
        "rescue": await _add_member(db_session, org_id, "rescue"),
        "rescue2": await _add_member(db_session, org_id, "rescue"),
        "firefighter": await _add_member(db_session, org_id, "firefighter"),
        "manager": await _add_member(db_session, org_id, None),
    }
    db_session.add(
        ShiftTemplate(
            organization_id=org_id,
            name="Rescue company",
            start_time_of_day="07:00",
            end_time_of_day="19:00",
            duration_hours=12.0,
            positions=[{"position": CUSTOM, "required": True}],
        )
    )

    other_org = await _add_org(db_session, "Elsewhere FD")
    db_session.add(
        ShiftTemplate(
            organization_id=other_org,
            name="Hazmat",
            start_time_of_day="07:00",
            end_time_of_day="19:00",
            duration_hours=12.0,
            positions=[{"position": "hazmat_tech", "required": True}],
        )
    )
    await db_session.flush()
    return org_id, members


async def _shift(svc, org_id, creator_id, days_ahead=3, seats=None):
    day = date.today() + timedelta(days=days_ahead)
    shift, err = await svc.create_shift(
        uuid.UUID(org_id),
        {
            "shift_date": day,
            "start_time": datetime(day.year, day.month, day.day, 7, 0),
            "positions": (
                seats
                if seats is not None
                else [
                    {"position": "officer", "required": True},
                    {"position": CUSTOM, "required": True},
                    {"position": CUSTOM, "required": True},
                    {"position": "firefighter", "required": True},
                ]
            ),
        },
        uuid.UUID(creator_id),
    )
    assert err is None, err
    # Ids, not the row: a refused request rolls the session back and an
    # expired row would turn ``shift.id`` into a lazy load.
    return SimpleNamespace(id=str(shift.id), shift_date=shift.shift_date)


async def _seat(svc, org_id, shift_id, user_id, creator_id, position):
    assignment, err = await svc.create_assignment(
        uuid.UUID(org_id),
        uuid.UUID(str(shift_id)),
        {"user_id": user_id, "position": position},
        uuid.UUID(creator_id),
    )
    assert err is None, err
    return assignment


async def _position_of(db_session, shift_id, user_id):
    return (
        await db_session.execute(
            select(ShiftAssignment.position).where(
                ShiftAssignment.shift_id == str(shift_id),
                ShiftAssignment.user_id == str(user_id),
            )
        )
    ).scalar_one_or_none()


async def _drop_custom_seats(db_session, shift_id):
    """An officer edits the seat off the shift after it was filled."""
    await db_session.execute(
        text("UPDATE shifts SET positions = :p WHERE id = :id"),
        {
            "p": json.dumps(
                [
                    {"position": "officer", "required": True},
                    {"position": "firefighter", "required": True},
                ]
            ),
            "id": str(shift_id),
        },
    )
    await db_session.commit()
    db_session.expire_all()


async def _user(db_session, user_id):
    # Positions eagerly: the endpoints read the caller's grants, and a lazy
    # load outside the request's greenlet raises.
    return (
        await db_session.execute(
            select(scheduling_endpoint.User)
            .options(selectinload(scheduling_endpoint.User.positions))
            .where(scheduling_endpoint.User.id == user_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


def _assert_unknown_seat(caught):
    assert caught.value.status_code == 422
    assert caught.value.error_code is ErrorCode.SCHED_UNKNOWN_SEAT


@pytest.mark.integration
class TestSignup:
    async def test_a_member_granted_the_seat_signs_up_for_it(
        self, db_session, department
    ):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])

        response = await scheduling_endpoint.signup_for_shift(
            uuid.UUID(shift.id),
            ShiftSignupRequest(position=CUSTOM),
            db=db_session,
            current_user=await _user(db_session, m["rescue"]),
        )

        assert response["position"] == CUSTOM
        assert await _position_of(db_session, shift.id, m["rescue"]) == CUSTOM

    async def test_a_seat_the_shift_does_not_have_is_a_422(
        self, db_session, department
    ):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])

        with pytest.raises(HTTPException) as caught:
            await scheduling_endpoint.signup_for_shift(
                uuid.UUID(shift.id),
                ShiftSignupRequest(position="hazmat_tech"),
                db=db_session,
                current_user=await _user(db_session, m["rescue"]),
            )

        _assert_unknown_seat(caught)
        assert await _position_of(db_session, shift.id, m["rescue"]) is None

    async def test_a_member_nobody_granted_the_seat_is_refused(
        self, db_session, department
    ):
        """The safe default: no grant, no seat — the rule for any seat."""
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])

        with pytest.raises(HTTPException) as caught:
            await scheduling_endpoint.signup_for_shift(
                uuid.UUID(shift.id),
                ShiftSignupRequest(position=CUSTOM),
                db=db_session,
                current_user=await _user(db_session, m["firefighter"]),
            )

        assert caught.value.status_code == 403

    async def test_a_builtin_seat_still_works(self, db_session, department):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])

        response = await scheduling_endpoint.signup_for_shift(
            uuid.UUID(shift.id),
            ShiftSignupRequest(position="firefighter"),
            db=db_session,
            current_user=await _user(db_session, m["firefighter"]),
        )

        assert response["position"] == "firefighter"

    async def test_the_seat_cap_counts_a_custom_seat(self, db_session, department):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(
            svc, org_id, m["manager"], seats=[{"position": CUSTOM, "required": True}]
        )
        await _seat(svc, org_id, shift.id, m["rescue"], m["manager"], CUSTOM)

        assignment, err = await svc.create_assignment(
            uuid.UUID(org_id),
            uuid.UUID(shift.id),
            {"user_id": m["rescue2"], "position": CUSTOM},
            uuid.UUID(m["manager"]),
        )

        assert assignment is None
        assert "filled" in err


@pytest.mark.integration
class TestEligibility:
    async def test_a_rank_grant_reaches_the_custom_seat(self, db_session, department):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        eligibility = ShiftEligibilityService(db_session)

        rescue = await _user(db_session, m["rescue"])
        firefighter = await _user(db_session, m["firefighter"])

        assert CUSTOM in await eligibility.get_eligible_positions(
            rescue, org_id, shift.id
        )
        assert CUSTOM not in await eligibility.get_eligible_positions(
            firefighter, org_id, shift.id
        )
        bulk = await eligibility.get_eligible_positions_bulk(rescue, org_id, [shift.id])
        assert CUSTOM in bulk[shift.id]

    async def test_a_grant_covers_the_seat_however_the_template_cased_it(
        self, db_session, department
    ):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(
            svc,
            org_id,
            m["manager"],
            seats=[{"position": "Rescue_Tech", "required": True}],
        )

        eligible = await ShiftEligibilityService(db_session).get_eligible_positions(
            await _user(db_session, m["rescue"]), org_id, shift.id
        )

        assert eligible == ["Rescue_Tech"]
        assignment = await _seat(
            svc, org_id, shift.id, m["rescue"], m["manager"], CUSTOM
        )
        assert assignment.position == "Rescue_Tech"

    async def test_an_open_to_all_shift_opens_the_custom_seat(
        self, db_session, department
    ):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        await db_session.execute(
            text("UPDATE shifts SET open_to_all_members = 1 WHERE id = :id"),
            {"id": shift.id},
        )
        await db_session.commit()
        db_session.expire_all()

        eligible = await ShiftEligibilityService(db_session).get_eligible_positions(
            await _user(db_session, m["firefighter"]), org_id, shift.id
        )

        assert CUSTOM in eligible


@pytest.mark.integration
class TestOfficerAssignment:
    async def test_an_officer_seats_a_member_in_a_custom_seat(
        self, db_session, department, monkeypatch
    ):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        monkeypatch.setattr(
            scheduling_endpoint,
            "_authorize_shift_management",
            AsyncMock(return_value=await svc.get_shift_by_id(shift.id, org_id)),
        )

        response = await scheduling_endpoint.create_assignment(
            uuid.UUID(shift.id),
            ShiftAssignmentCreate(user_id=uuid.UUID(m["rescue"]), position=CUSTOM),
            db=db_session,
            current_user=await _user(db_session, m["manager"]),
        )

        assert response["position"] == CUSTOM

    async def test_an_unknown_seat_is_a_422(self, db_session, department, monkeypatch):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        monkeypatch.setattr(
            scheduling_endpoint,
            "_authorize_shift_management",
            AsyncMock(return_value=await svc.get_shift_by_id(shift.id, org_id)),
        )

        with pytest.raises(HTTPException) as caught:
            await scheduling_endpoint.create_assignment(
                uuid.UUID(shift.id),
                ShiftAssignmentCreate(
                    user_id=uuid.UUID(m["rescue"]), position="hazmat_tech"
                ),
                db=db_session,
                current_user=await _user(db_session, m["manager"]),
            )

        _assert_unknown_seat(caught)

    async def test_an_edit_moves_a_member_into_a_custom_seat(
        self, db_session, department, monkeypatch
    ):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        assignment = await _seat(
            svc, org_id, shift.id, m["rescue"], m["manager"], "firefighter"
        )
        monkeypatch.setattr(
            scheduling_endpoint, "_authorize_assignment_management", AsyncMock()
        )
        manager = await _user(db_session, m["manager"])

        response = await scheduling_endpoint.update_assignment(
            uuid.UUID(assignment.id),
            ShiftAssignmentUpdate(position="Rescue_Tech"),
            db=db_session,
            current_user=manager,
        )
        assert response["position"] == CUSTOM

        with pytest.raises(HTTPException) as caught:
            await scheduling_endpoint.update_assignment(
                uuid.UUID(assignment.id),
                ShiftAssignmentUpdate(position="hazmat_tech"),
                db=db_session,
                current_user=manager,
            )
        _assert_unknown_seat(caught)
        assert await _position_of(db_session, shift.id, m["rescue"]) == CUSTOM


@pytest.mark.integration
class TestSwaps:
    async def test_an_accepted_offer_moves_a_custom_seat(self, db_session, department):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        await _seat(svc, org_id, shift.id, m["rescue"], m["manager"], CUSTOM)
        swap, err = await svc.create_swap_request(
            uuid.UUID(org_id),
            uuid.UUID(m["rescue"]),
            {"offering_shift_id": shift.id, "target_user_id": m["rescue2"]},
        )
        assert err is None, err
        swap_id = str(swap.id)

        await scheduling_endpoint.respond_to_swap_offer(
            uuid.UUID(swap_id),
            ShiftSwapOfferResponseRequest(accept=True),
            db=db_session,
            current_user=await _user(db_session, m["rescue2"]),
        )

        assert await _position_of(db_session, shift.id, m["rescue2"]) == CUSTOM
        assert await _position_of(db_session, shift.id, m["rescue"]) is None

    async def test_accepting_a_seat_the_shift_no_longer_has_is_a_422(
        self, db_session, department
    ):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        await _seat(svc, org_id, shift.id, m["rescue"], m["manager"], CUSTOM)
        swap, err = await svc.create_swap_request(
            uuid.UUID(org_id),
            uuid.UUID(m["rescue"]),
            {"offering_shift_id": shift.id, "target_user_id": m["rescue2"]},
        )
        assert err is None, err
        swap_id = str(swap.id)
        await _drop_custom_seats(db_session, shift.id)

        with pytest.raises(HTTPException) as caught:
            await scheduling_endpoint.respond_to_swap_offer(
                uuid.UUID(swap_id),
                ShiftSwapOfferResponseRequest(accept=True),
                db=db_session,
                current_user=await _user(db_session, m["rescue2"]),
            )

        _assert_unknown_seat(caught)
        assert await _position_of(db_session, shift.id, m["rescue"]) == CUSTOM

    @pytest.mark.usefixtures("_no_audit")
    async def test_a_reviewed_exchange_swaps_custom_seats(self, db_session, department):
        org_id, m = department
        svc = SchedulingService(db_session)
        a = await _shift(svc, org_id, m["manager"], 3)
        b = await _shift(svc, org_id, m["manager"], 4)
        await _seat(svc, org_id, a.id, m["rescue"], m["manager"], CUSTOM)
        await _seat(svc, org_id, b.id, m["rescue2"], m["manager"], "firefighter")
        swap, err = await svc.create_swap_request(
            uuid.UUID(org_id),
            uuid.UUID(m["rescue"]),
            {
                "offering_shift_id": a.id,
                "requesting_shift_id": b.id,
                "target_user_id": m["rescue2"],
            },
        )
        assert err is None, err
        swap_id = str(swap.id)

        await scheduling_endpoint.review_swap_request(
            uuid.UUID(swap_id),
            ShiftSwapReview(status=SwapRequestStatus.APPROVED),
            db=db_session,
            current_user=await _user(db_session, m["manager"]),
        )

        assert await _position_of(db_session, a.id, m["rescue2"]) == CUSTOM
        assert await _position_of(db_session, b.id, m["rescue"]) == "firefighter"

    @pytest.mark.usefixtures("_no_audit")
    async def test_reviewing_an_exchange_of_a_vanished_seat_is_a_422(
        self, db_session, department
    ):
        org_id, m = department
        svc = SchedulingService(db_session)
        a = await _shift(svc, org_id, m["manager"], 3)
        b = await _shift(svc, org_id, m["manager"], 4)
        await _seat(svc, org_id, a.id, m["rescue"], m["manager"], CUSTOM)
        await _seat(svc, org_id, b.id, m["rescue2"], m["manager"], "firefighter")
        swap, err = await svc.create_swap_request(
            uuid.UUID(org_id),
            uuid.UUID(m["rescue"]),
            {
                "offering_shift_id": a.id,
                "requesting_shift_id": b.id,
                "target_user_id": m["rescue2"],
            },
        )
        assert err is None, err
        swap_id = str(swap.id)
        await _drop_custom_seats(db_session, a.id)

        with pytest.raises(HTTPException) as caught:
            await scheduling_endpoint.review_swap_request(
                uuid.UUID(swap_id),
                ShiftSwapReview(
                    status=SwapRequestStatus.APPROVED, override_qualification=True
                ),
                db=db_session,
                current_user=await _user(db_session, m["manager"]),
            )

        _assert_unknown_seat(caught)

    async def test_requesting_an_exchange_of_a_vanished_seat_is_a_422(
        self, db_session, department
    ):
        org_id, m = department
        svc = SchedulingService(db_session)
        a = await _shift(svc, org_id, m["manager"], 3)
        b = await _shift(svc, org_id, m["manager"], 4)
        await _seat(svc, org_id, a.id, m["rescue"], m["manager"], CUSTOM)
        await _seat(svc, org_id, b.id, m["rescue2"], m["manager"], "firefighter")
        await _drop_custom_seats(db_session, a.id)

        with pytest.raises(UnknownSeatError):
            await svc.create_swap_request(
                uuid.UUID(org_id),
                uuid.UUID(m["rescue"]),
                {
                    "offering_shift_id": a.id,
                    "requesting_shift_id": b.id,
                    "target_user_id": m["rescue2"],
                },
            )


@pytest.mark.integration
class TestOpenSwapPickup:
    @pytest.mark.usefixtures("_no_audit")
    async def test_an_eligible_member_picks_up_a_custom_seat(
        self, db_session, department
    ):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        await _seat(svc, org_id, shift.id, m["rescue"], m["manager"], CUSTOM)
        swap, err = await svc.create_swap_request(
            uuid.UUID(org_id), uuid.UUID(m["rescue"]), {"offering_shift_id": shift.id}
        )
        assert err is None, err
        swap_id = str(swap.id)

        offered = await svc.get_open_swaps_for_member(
            uuid.UUID(org_id), uuid.UUID(m["rescue2"])
        )
        assert [o["position"] for o in offered] == [CUSTOM]
        assert (
            await svc.get_open_swaps_for_member(
                uuid.UUID(org_id), uuid.UUID(m["firefighter"])
            )
            == []
        )

        await scheduling_endpoint.pick_up_open_swap(
            uuid.UUID(swap_id),
            db=db_session,
            current_user=await _user(db_session, m["rescue2"]),
        )

        assert await _position_of(db_session, shift.id, m["rescue2"]) == CUSTOM

    @pytest.mark.usefixtures("_no_audit")
    async def test_picking_up_a_seat_the_shift_no_longer_has_is_a_422(
        self, db_session, department
    ):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        await _seat(svc, org_id, shift.id, m["rescue"], m["manager"], CUSTOM)
        swap, err = await svc.create_swap_request(
            uuid.UUID(org_id), uuid.UUID(m["rescue"]), {"offering_shift_id": shift.id}
        )
        assert err is None, err
        swap_id = str(swap.id)
        await _drop_custom_seats(db_session, shift.id)

        with pytest.raises(HTTPException) as caught:
            await scheduling_endpoint.pick_up_open_swap(
                uuid.UUID(swap_id),
                db=db_session,
                current_user=await _user(db_session, m["rescue2"]),
            )

        _assert_unknown_seat(caught)


@pytest.mark.integration
class TestStandingShifts:
    def _payload(self, position: str) -> StandingShiftCreate:
        start = date.today() + timedelta(days=1)
        return StandingShiftCreate(
            position=position,
            weekday=(start.isoweekday() % 7),
            start_date=start,
            end_date=start + timedelta(days=13),
        )

    @pytest.mark.usefixtures("_no_audit")
    async def test_a_seat_the_department_defined_can_be_claimed(
        self, db_session, department
    ):
        org_id, m = department
        svc = SchedulingService(db_session)
        start = date.today() + timedelta(days=1)
        shift = await _shift(svc, org_id, m["manager"], days_ahead=1)
        assert shift.shift_date == start

        result = await scheduling_endpoint.create_standing_shift(
            self._payload("Rescue_Tech"),
            db=db_session,
            current_user=await _user(db_session, m["rescue"]),
        )

        assert result["claim"].position == CUSTOM
        assert await _position_of(db_session, shift.id, m["rescue"]) == CUSTOM

    @pytest.mark.usefixtures("_no_audit")
    async def test_another_departments_seat_is_a_422(self, db_session, department):
        org_id, m = department

        with pytest.raises(HTTPException) as caught:
            await scheduling_endpoint.create_standing_shift(
                self._payload("hazmat_tech"),
                db=db_session,
                current_user=await _user(db_session, m["rescue"]),
            )

        _assert_unknown_seat(caught)
        claims = (
            await db_session.execute(
                select(StandingShiftClaim).where(
                    StandingShiftClaim.user_id == m["rescue"]
                )
            )
        ).all()
        assert claims == []

    @pytest.mark.usefixtures("_no_audit")
    async def test_a_builtin_seat_is_claimed_as_before(self, db_session, department):
        org_id, m = department

        result = await scheduling_endpoint.create_standing_shift(
            self._payload("FIREFIGHTER"),
            db=db_session,
            current_user=await _user(db_session, m["firefighter"]),
        )

        assert result["claim"].position == "firefighter"


@pytest.mark.integration
class TestCrossDepartment:
    async def test_another_departments_template_seat_is_not_a_seat_here(
        self, db_session, department
    ):
        """The other department's template names ``hazmat_tech``; nothing in
        this department does, so neither the shift rule nor the department
        vocabulary accepts it."""
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])

        names = await svc.department_seat_names(org_id)
        assert CUSTOM in names
        assert "hazmat_tech" not in names
        with pytest.raises(UnknownSeatError):
            await svc.create_assignment(
                uuid.UUID(org_id),
                uuid.UUID(shift.id),
                {"user_id": m["rescue"], "position": "hazmat_tech"},
                uuid.UUID(m["manager"]),
            )


# ---------------------------------------------------------------------------
# The migration, against a real MySQL database of its own
# ---------------------------------------------------------------------------


_MIGRATION = "56c91e7d9e10"


def _load_migration():
    import importlib.util
    from pathlib import Path

    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    matches = sorted(versions.glob(f"*_{_MIGRATION}_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location("widen_seats", matches[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def scratch_engine():
    """A database of its own, so ALTERs never touch the suite's tables."""
    from app.core.config import settings

    name = f"{settings.DB_NAME}_seatmig"
    server_url = settings.SYNC_DATABASE_URL.rsplit("/", 1)[0] + "/"
    server = sa.create_engine(server_url, isolation_level="AUTOCOMMIT")
    with server.connect() as conn:
        conn.execute(text(f"DROP DATABASE IF EXISTS `{name}`"))
        conn.execute(
            text(
                f"CREATE DATABASE `{name}` "
                "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            )
        )
    engine = sa.create_engine(server_url + name)
    yield engine
    engine.dispose()
    with server.connect() as conn:
        conn.execute(text(f"DROP DATABASE IF EXISTS `{name}`"))
    server.dispose()


_LOWER = (
    "'officer','driver','firefighter','ems','paramedic','captain',"
    "'lieutenant','probationary','volunteer','other'"
)
_UPPER = (
    "'OFFICER','DRIVER','FIREFIGHTER','EMS','PARAMEDIC','CAPTAIN',"
    "'LIEUTENANT','PROBATIONARY','VOLUNTEER','OTHER'"
)


def _make_tables(engine, labels: str, rows):
    with engine.begin() as conn:
        for table in ("shift_assignments", "standing_shift_claims"):
            default = "'firefighter'" if labels == _LOWER else "'FIREFIGHTER'"
            conn.execute(
                text(
                    f"CREATE TABLE {table} (id VARCHAR(36) PRIMARY KEY, "
                    f"position ENUM({labels}) NOT NULL DEFAULT {default})"
                )
            )
            for row_id, value in rows:
                conn.execute(
                    text(f"INSERT INTO {table} VALUES (:id, :v)"),
                    {"id": row_id, "v": value},
                )


def _run(engine, step: str):
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    module = _load_migration()
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, step)()


def _column(engine, table):
    with engine.connect() as conn:
        return conn.execute(
            text(
                "SELECT COLUMN_TYPE, COLUMN_DEFAULT, IS_NULLABLE "
                "FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
                "AND TABLE_NAME = :t AND COLUMN_NAME = 'position'"
            ),
            {"t": table},
        ).one()


def _values(engine, table):
    with engine.connect() as conn:
        return dict(conn.execute(text(f"SELECT id, position FROM {table}")).all())


@pytest.mark.integration
class TestMigration:
    def test_existing_values_survive_and_the_column_widens(self, scratch_engine):
        _make_tables(scratch_engine, _LOWER, [("a", "officer"), ("b", "paramedic")])

        _run(scratch_engine, "upgrade")

        for table in ("shift_assignments", "standing_shift_claims"):
            column_type, default, nullable = _column(scratch_engine, table)
            assert column_type == "varchar(100)"
            assert default.strip("'") == "firefighter"
            assert nullable == "NO"
            assert _values(scratch_engine, table) == {
                "a": "officer",
                "b": "paramedic",
            }
        with scratch_engine.begin() as conn:
            conn.execute(
                text("INSERT INTO shift_assignments VALUES ('c', :v)"), {"v": CUSTOM}
            )
        assert _values(scratch_engine, "shift_assignments")["c"] == CUSTOM

    def test_legacy_uppercase_member_names_are_folded(self, scratch_engine):
        """The startup ENUM pass used to fold these; it no longer touches the
        position columns, so the migration does it once."""
        _make_tables(scratch_engine, _UPPER, [("a", "OFFICER"), ("b", "EMS")])

        _run(scratch_engine, "upgrade")

        assert _values(scratch_engine, "shift_assignments") == {
            "a": "officer",
            "b": "ems",
        }

    def test_a_second_run_changes_nothing(self, scratch_engine):
        _make_tables(scratch_engine, _LOWER, [("a", "driver")])
        _run(scratch_engine, "upgrade")
        with scratch_engine.begin() as conn:
            conn.execute(
                text("INSERT INTO shift_assignments VALUES ('c', 'Rescue_Tech')")
            )

        _run(scratch_engine, "upgrade")

        assert _column(scratch_engine, "shift_assignments")[0] == "varchar(100)"
        assert _values(scratch_engine, "shift_assignments") == {
            "a": "driver",
            "c": "Rescue_Tech",
        }

    def test_a_database_without_the_tables_is_skipped(self, scratch_engine):
        _run(scratch_engine, "upgrade")
        _run(scratch_engine, "downgrade")

    def test_downgrade_refuses_while_a_custom_seat_is_stored(self, scratch_engine):
        _make_tables(scratch_engine, _LOWER, [("a", "officer")])
        _run(scratch_engine, "upgrade")
        with scratch_engine.begin() as conn:
            conn.execute(
                text("INSERT INTO standing_shift_claims VALUES ('c', :v)"),
                {"v": CUSTOM},
            )

        with pytest.raises(RuntimeError) as caught:
            _run(scratch_engine, "downgrade")

        assert "standing_shift_claims: rescue_tech" in str(caught.value)
        # Nothing narrowed, on either table, and nothing lost.
        for table in ("shift_assignments", "standing_shift_claims"):
            assert _column(scratch_engine, table)[0] == "varchar(100)"
        assert _values(scratch_engine, "standing_shift_claims")["c"] == CUSTOM

    def test_downgrade_narrows_when_only_builtin_seats_are_stored(self, scratch_engine):
        _make_tables(scratch_engine, _LOWER, [("a", "officer"), ("b", "ems")])
        _run(scratch_engine, "upgrade")

        _run(scratch_engine, "downgrade")

        column_type, default, _ = _column(scratch_engine, "shift_assignments")
        assert column_type.startswith("enum(")
        assert "'paramedic'" in column_type
        assert default.strip("'") == "firefighter"
        assert _values(scratch_engine, "shift_assignments") == {
            "a": "officer",
            "b": "ems",
        }

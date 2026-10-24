"""Every path that places a member in a seat meets the same candidate check.

The review of 2026-10-24 found the check applied in full on a new assignment
and only in part elsewhere:

* a seat or status change through ``update_assignment`` re-applied only the
  driver rule, so "assign as firefighter, PATCH to officer" skipped the
  eligibility and named-seat checks, and a declined row could be revived while
  somebody else held its seat;
* on a shift with no named seats, the candidate check asked only "eligible for
  something", so a firefighter could take the officer seat — and, through an
  officer's assignment, the shift's officer authority;
* ``confirm_assignment`` set CONFIRMED from any status, cancelled shift or not;
* naming a shift officer who had an old declined row hit the unique
  constraint, and one with a cancelled row was named but left off the roster;
* an assigner could seat a member on a cancelled shift;
* an explicit null on a NOT NULL column failed late and unexplained;
* a swap could target a cancelled shift, or one the requester already held.
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

# Every member is cleared for these and nothing else, so "officer" is a seat
# nobody here holds unless a shift is open to all members.
OPEN_POSITIONS = ["firefighter", "ems"]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def dept(db_session: AsyncSession):
    org_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone, settings) "
            "VALUES (:id, :name, 'fire_department', :slug, :tz, :settings)"
        ),
        {
            "id": org_id,
            "name": "Gates FD",
            "slug": f"gates-{org_id[:8]}",
            "tz": "America/New_York",
            "settings": json.dumps({"scheduling": {"open_positions": OPEN_POSITIONS}}),
        },
    )
    users = {}
    for name, status in (
        ("chief", "active"),
        ("alice", "active"),
        ("bob", "active"),
        ("gone", "inactive"),
    ):
        uid = _uid()
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) VALUES "
                "(:id, :org, :un, 'Test', 'User', :em, 'hashed', :st)"
            ),
            {
                "id": uid,
                "org": org_id,
                "un": f"{name}-{uid[:6]}",
                "em": f"{name}-{uid[:6]}@t.com",
                "st": status,
            },
        )
        users[name] = uid
    await db_session.flush()
    return org_id, users


async def _shift(
    svc, db_session, org_id, creator, *, positions=None, open_to_all=False, days=3
):
    start = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=days)
    data = {
        "shift_date": start.date(),
        "start_time": start,
        "end_time": start + timedelta(hours=12),
    }
    if positions is not None:
        data["positions"] = [{"position": p, "required": True} for p in positions]
    shift, err = await svc.create_shift(uuid.UUID(org_id), data, uuid.UUID(creator))
    assert err is None, err
    if open_to_all:
        await db_session.execute(
            text("UPDATE shifts SET open_to_all_members = 1 WHERE id = :id"),
            {"id": shift.id},
        )
        await db_session.commit()
        await db_session.refresh(shift)
    return shift


async def _assign(svc, org_id, shift, user_id, position, actor, by):
    return await svc.create_assignment(
        uuid.UUID(org_id),
        uuid.UUID(shift.id),
        {"user_id": user_id, "position": position},
        uuid.UUID(by),
        actor=actor,
    )


async def _cancel(db_session, shift):
    await db_session.execute(
        text("UPDATE shifts SET status = 'cancelled' WHERE id = :id"),
        {"id": shift.id},
    )
    await db_session.commit()
    await db_session.refresh(shift)


class TestSeatEligibilityOnAShiftWithNoNamedSeats:
    async def test_an_assigner_cannot_seat_a_member_in_a_seat_they_are_not_cleared_for(
        self, db_session, dept
    ):
        org_id, users = dept
        svc = SchedulingService(db_session)
        shift = await _shift(svc, db_session, org_id, users["chief"])

        result, err = await _assign(
            svc,
            org_id,
            shift,
            users["alice"],
            "officer",
            SignupActor.ASSIGNER,
            users["chief"],
        )

        assert result is None
        assert err == "Member is no longer eligible for the officer position"
        await db_session.refresh(shift)
        # The officer seat would also have made her the shift's officer.
        assert shift.shift_officer_id is None

    async def test_a_seat_the_member_is_cleared_for_still_works(self, db_session, dept):
        org_id, users = dept
        svc = SchedulingService(db_session)
        shift = await _shift(svc, db_session, org_id, users["chief"])

        result, err = await _assign(
            svc,
            org_id,
            shift,
            users["alice"],
            "firefighter",
            SignupActor.ASSIGNER,
            users["chief"],
        )

        assert err is None, err
        assert result is not None


class TestAssignmentEdits:
    async def test_a_seat_change_is_held_to_eligibility(self, db_session, dept):
        org_id, users = dept
        svc = SchedulingService(db_session)
        shift = await _shift(svc, db_session, org_id, users["chief"])
        seated, err = await _assign(
            svc,
            org_id,
            shift,
            users["alice"],
            "firefighter",
            SignupActor.MANAGER,
            users["chief"],
        )
        assert err is None, err

        result, err = await svc.update_assignment(
            uuid.UUID(seated.id), uuid.UUID(org_id), {"position": "officer"}
        )

        assert result is None
        assert err == "Member is no longer eligible for the officer position"

    async def test_a_seat_change_is_held_to_the_named_seat_cap(self, db_session, dept):
        org_id, users = dept
        svc = SchedulingService(db_session)
        shift = await _shift(
            svc,
            db_session,
            org_id,
            users["chief"],
            positions=["officer", "firefighter"],
            open_to_all=True,
        )
        _, err = await _assign(
            svc,
            org_id,
            shift,
            users["alice"],
            "officer",
            SignupActor.MANAGER,
            users["chief"],
        )
        assert err is None, err
        bob, err = await _assign(
            svc,
            org_id,
            shift,
            users["bob"],
            "firefighter",
            SignupActor.MANAGER,
            users["chief"],
        )
        assert err is None, err

        result, err = await svc.update_assignment(
            uuid.UUID(bob.id), uuid.UUID(org_id), {"position": "officer"}
        )

        assert result is None
        assert err == "Position was filled after this request was submitted"

    async def test_a_declined_row_cannot_be_revived_into_a_refilled_seat(
        self, db_session, dept
    ):
        org_id, users = dept
        svc = SchedulingService(db_session)
        shift = await _shift(
            svc, db_session, org_id, users["chief"], positions=["firefighter"]
        )
        alice, err = await _assign(
            svc,
            org_id,
            shift,
            users["alice"],
            "firefighter",
            SignupActor.MANAGER,
            users["chief"],
        )
        assert err is None, err
        _, err = await svc.update_assignment(
            uuid.UUID(alice.id),
            uuid.UUID(org_id),
            {"assignment_status": AssignmentStatus.DECLINED},
        )
        assert err is None, err
        _, err = await _assign(
            svc,
            org_id,
            shift,
            users["bob"],
            "firefighter",
            SignupActor.MANAGER,
            users["chief"],
        )
        assert err is None, err

        result, err = await svc.update_assignment(
            uuid.UUID(alice.id),
            uuid.UUID(org_id),
            {"assignment_status": AssignmentStatus.ASSIGNED},
        )

        assert result is None
        assert err == "Position was filled after this request was submitted"

    async def test_notes_alone_are_not_rechecked(self, db_session, dept):
        org_id, users = dept
        svc = SchedulingService(db_session)
        shift = await _shift(svc, db_session, org_id, users["chief"])
        seated, err = await _assign(
            svc,
            org_id,
            shift,
            users["alice"],
            "firefighter",
            SignupActor.MANAGER,
            users["chief"],
        )
        assert err is None, err

        result, err = await svc.update_assignment(
            uuid.UUID(seated.id), uuid.UUID(org_id), {"notes": "Bring the TIC"}
        )

        assert err is None, err
        assert result.notes == "Bring the TIC"

    async def test_an_explicit_null_on_a_required_column_is_refused_by_name(
        self, db_session, dept
    ):
        org_id, users = dept
        svc = SchedulingService(db_session)
        shift = await _shift(svc, db_session, org_id, users["chief"])
        seated, err = await _assign(
            svc,
            org_id,
            shift,
            users["alice"],
            "firefighter",
            SignupActor.MANAGER,
            users["chief"],
        )
        assert err is None, err

        result, err = await svc.update_assignment(
            uuid.UUID(seated.id), uuid.UUID(org_id), {"is_training": None}
        )

        assert result is None
        assert err == "Field 'is_training' cannot be cleared"


class TestConfirm:
    async def test_a_declined_assignment_cannot_be_confirmed(self, db_session, dept):
        org_id, users = dept
        svc = SchedulingService(db_session)
        shift = await _shift(svc, db_session, org_id, users["chief"])
        seated, err = await _assign(
            svc,
            org_id,
            shift,
            users["alice"],
            "firefighter",
            SignupActor.MANAGER,
            users["chief"],
        )
        assert err is None, err
        _, err = await svc.decline_assignment(
            uuid.UUID(seated.id),
            uuid.UUID(users["alice"]),
            uuid.UUID(org_id),
            actor=SignupActor.MEMBER,
        )
        assert err is None, err

        result, err = await svc.confirm_assignment(
            uuid.UUID(seated.id),
            uuid.UUID(users["alice"]),
            uuid.UUID(org_id),
            actor=SignupActor.MEMBER,
        )

        assert result is None
        assert err == "This assignment is no longer active to confirm"

    async def test_an_assignment_on_a_cancelled_shift_cannot_be_confirmed(
        self, db_session, dept
    ):
        org_id, users = dept
        svc = SchedulingService(db_session)
        shift = await _shift(svc, db_session, org_id, users["chief"])
        seated, err = await _assign(
            svc,
            org_id,
            shift,
            users["alice"],
            "firefighter",
            SignupActor.MANAGER,
            users["chief"],
        )
        assert err is None, err
        await _cancel(db_session, shift)

        result, err = await svc.confirm_assignment(
            uuid.UUID(seated.id),
            uuid.UUID(users["alice"]),
            uuid.UUID(org_id),
            actor=SignupActor.MEMBER,
        )

        assert result is None
        assert err == "Shift was cancelled"


class TestCancelledShifts:
    async def test_an_assigner_cannot_seat_a_member_on_a_cancelled_shift(
        self, db_session, dept
    ):
        org_id, users = dept
        svc = SchedulingService(db_session)
        shift = await _shift(svc, db_session, org_id, users["chief"])
        await _cancel(db_session, shift)

        result, err = await _assign(
            svc,
            org_id,
            shift,
            users["alice"],
            "firefighter",
            SignupActor.ASSIGNER,
            users["chief"],
        )

        assert result is None
        assert err == "Shift was cancelled"

    async def test_the_records_path_still_can(self, db_session, dept):
        org_id, users = dept
        svc = SchedulingService(db_session)
        shift = await _shift(svc, db_session, org_id, users["chief"])
        await _cancel(db_session, shift)

        result, err = await _assign(
            svc,
            org_id,
            shift,
            users["alice"],
            "firefighter",
            SignupActor.MANAGER,
            users["chief"],
        )

        assert err is None, err
        assert result is not None


class TestNamingTheShiftOfficer:
    @pytest.mark.parametrize(
        "old_status", [AssignmentStatus.DECLINED, AssignmentStatus.CANCELLED]
    )
    async def test_an_old_inactive_row_is_replaced_by_a_live_officer_seat(
        self, db_session, dept, old_status
    ):
        org_id, users = dept
        svc = SchedulingService(db_session)
        shift = await _shift(
            svc,
            db_session,
            org_id,
            users["chief"],
            positions=["officer", "firefighter"],
        )
        seated, err = await _assign(
            svc,
            org_id,
            shift,
            users["alice"],
            "firefighter",
            SignupActor.MANAGER,
            users["chief"],
        )
        assert err is None, err
        _, err = await svc.update_assignment(
            uuid.UUID(seated.id), uuid.UUID(org_id), {"assignment_status": old_status}
        )
        assert err is None, err

        updated, err = await svc.update_shift(
            uuid.UUID(shift.id),
            uuid.UUID(org_id),
            {"shift_officer_id": users["alice"]},
        )

        assert err is None, err
        assert updated.shift_officer_id == users["alice"]
        rows = (
            await db_session.execute(
                text(
                    "SELECT assignment_status, position FROM shift_assignments "
                    "WHERE shift_id = :s AND user_id = :u"
                ),
                {"s": shift.id, "u": users["alice"]},
            )
        ).all()
        assert [(r.assignment_status, r.position) for r in rows] == [
            (AssignmentStatus.ASSIGNED.value, "officer")
        ]

    async def test_a_former_member_cannot_be_named(self, db_session, dept):
        org_id, users = dept
        svc = SchedulingService(db_session)
        shift = await _shift(svc, db_session, org_id, users["chief"])

        result, err = await svc.update_shift(
            uuid.UUID(shift.id), uuid.UUID(org_id), {"shift_officer_id": users["gone"]}
        )

        assert result is None
        assert err == "Shift officer is not an active member"

    async def test_an_explicit_null_start_time_is_refused_by_name(
        self, db_session, dept
    ):
        org_id, users = dept
        svc = SchedulingService(db_session)
        shift = await _shift(svc, db_session, org_id, users["chief"])

        result, err = await svc.update_shift(
            uuid.UUID(shift.id), uuid.UUID(org_id), {"start_time": None}
        )

        assert result is None
        assert err == "Field 'start_time' cannot be cleared"


class TestSwapTargets:
    async def test_a_cancelled_shift_cannot_be_requested(self, db_session, dept):
        org_id, users = dept
        svc = SchedulingService(db_session)
        mine = await _shift(svc, db_session, org_id, users["chief"])
        theirs = await _shift(svc, db_session, org_id, users["chief"], days=5)
        _, err = await _assign(
            svc,
            org_id,
            mine,
            users["alice"],
            "firefighter",
            SignupActor.MANAGER,
            users["chief"],
        )
        assert err is None, err
        await _cancel(db_session, theirs)

        result, err = await svc.create_swap_request(
            uuid.UUID(org_id),
            uuid.UUID(users["alice"]),
            {"offering_shift_id": mine.id, "requesting_shift_id": theirs.id},
        )

        assert result is None
        assert err == "The requested shift was cancelled"

    async def test_a_shift_already_held_cannot_be_requested(self, db_session, dept):
        org_id, users = dept
        svc = SchedulingService(db_session)
        mine = await _shift(svc, db_session, org_id, users["chief"])
        also_mine = await _shift(svc, db_session, org_id, users["chief"], days=5)
        for shift in (mine, also_mine):
            _, err = await _assign(
                svc,
                org_id,
                shift,
                users["alice"],
                "firefighter",
                SignupActor.MANAGER,
                users["chief"],
            )
            assert err is None, err

        result, err = await svc.create_swap_request(
            uuid.UUID(org_id),
            uuid.UUID(users["alice"]),
            {"offering_shift_id": mine.id, "requesting_shift_id": also_mine.id},
        )

        assert result is None
        assert err == "You are already assigned to the requested shift"


class TestOpenToAllShiftWithNoNamedSeats:
    """An open-to-all shift naming no seats offers the built-in seats.

    The open-to-all bypass returned the shift's own seat list, which is empty
    when it names none — read as "eligible for nothing", so nobody at all could
    sign up for it.
    """

    async def test_a_member_can_sign_up_for_a_seat_outside_their_own_set(
        self, db_session, dept
    ):
        org_id, users = dept
        svc = SchedulingService(db_session)
        shift = await _shift(svc, db_session, org_id, users["chief"], open_to_all=True)

        result, err = await svc.create_assignment(
            uuid.UUID(org_id),
            uuid.UUID(shift.id),
            {"user_id": users["alice"], "position": "officer"},
            uuid.UUID(users["alice"]),
            self_signup=True,
        )

        assert err is None, err
        assert result.position == "officer"

    async def test_the_single_and_bulk_answers_agree(self, db_session, dept):
        from app.models.user import User
        from app.services.shift_eligibility_service import ShiftEligibilityService
        from app.utils.positions import CANONICAL_POSITIONS

        org_id, users = dept
        svc = SchedulingService(db_session)
        shift = await _shift(svc, db_session, org_id, users["chief"], open_to_all=True)
        alice = await db_session.get(User, users["alice"])
        eligibility = ShiftEligibilityService(db_session)

        single = await eligibility.get_eligible_positions(alice, org_id, shift.id)
        bulk = await eligibility.get_eligible_positions_bulk(alice, org_id, [shift.id])

        assert single == sorted(CANONICAL_POSITIONS)
        assert bulk == {shift.id: sorted(CANONICAL_POSITIONS)}


class TestTradePickerSources:
    async def test_an_open_to_all_shift_lists_members_the_roster_would_not(
        self, db_session, dept
    ):
        org_id, users = dept
        svc = SchedulingService(db_session)
        shift = await _shift(
            svc,
            db_session,
            org_id,
            users["chief"],
            positions=["officer"],
            open_to_all=True,
        )
        _, err = await _assign(
            svc,
            org_id,
            shift,
            users["alice"],
            "officer",
            SignupActor.MANAGER,
            users["chief"],
        )
        assert err is None, err

        # Nobody holds "officer" by rank, qualification or the department's
        # open positions, so the roster is empty; the shift is open to all.
        result = await svc.get_trade_candidates(
            uuid.UUID(org_id), uuid.UUID(shift.id), uuid.UUID(users["alice"]), "officer"
        )

        listed = {c["user_id"] for c in result}
        assert users["bob"] in listed
        assert users["chief"] in listed
        assert users["alice"] not in listed
        assert users["gone"] not in listed

    async def test_the_roster_matches_a_seat_whatever_its_case(self, db_session, dept):
        from app.services.shift_eligibility_service import ShiftEligibilityService

        org_id, users = dept
        await db_session.execute(
            text("UPDATE organizations SET settings = :s WHERE id = :id"),
            {
                "id": org_id,
                "s": json.dumps({"scheduling": {"open_positions": ["rescue_tech"]}}),
            },
        )
        await db_session.commit()

        roster = await ShiftEligibilityService(db_session).get_position_roster(
            org_id, "Rescue_Tech"
        )

        assert roster["is_open_position"] is True
        assert {users["alice"], users["bob"], users["chief"]} <= {
            m["user_id"] for m in roster["members"]
        }

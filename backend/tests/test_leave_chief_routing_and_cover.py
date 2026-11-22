"""An approver's own request goes to the Chief; a stand-in covers an away approver.

Owner decisions of 2026-11-21:

- A member who holds an approver position when they ask has their request
  decided by the Chief, not by their fellow approvers; if they are the Chief,
  or no Chief can decide, by the officers who manage leave. Only requests
  made from now on: a request already waiting keeps its approvers.
- An approver away for a period may be covered by an officer who manages
  leave, named by the approver or by such an officer. The stand-in votes in
  the approver's place, and the approver cannot vote until the cover ends; a
  vote the stand-in cast keeps counting after it ends. The stand-in must
  manage leave when the cover is set and whenever it is used.
"""

from datetime import timedelta

import pytest
from sqlalchemy import delete, select

from app.models.audit import AuditLog
from app.models.leave_request import LeaveRequest, LeaveRequestVote
from app.models.user import user_positions
from app.services.leave_request_service import LeaveRequestService
from app.utils.org_timezone import resolve_org_today
from tests.test_leave_requests import (
    _as,
    _ask,
    _configure,
    _department,
    _position,
    _user,
    _vote,
)

pytestmark = pytest.mark.integration


async def _board_department(db, org_id, board_size=2, rule="any"):
    officer, chief, board, members, member = await _department(
        db, org_id, board_size=board_size
    )
    await _configure(
        db,
        officer,
        requests_enabled=True,
        request_approver_position_ids=[board.id],
        request_decision_rule=rule,
    )
    return officer, chief, board, members, member


async def _cover(db, actor, approver, stand_in, start, end):
    async with _as(db, actor, []) as client:
        return await client.post(
            "/users/leave-requests/covers",
            json={
                "approver_id": str(approver.id),
                "stand_in_id": str(stand_in.id),
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
            },
        )


async def _board(db, viewer):
    async with _as(db, viewer, []) as client:
        response = await client.get("/users/leave-requests/covers")
    assert response.status_code == 200, response.text
    return response.json()


class TestAnApproversOwnRequestGoesToTheChief:
    async def test_the_chief_decides_and_fellow_approvers_do_not(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        _, chief, _, (asker, fellow), _ = await _board_department(db_session, org_id)

        request = await _ask(db_session, asker)

        assert request["routed_to_chief"] is True
        assert request["approver_count"] == 1
        response = await _vote(db_session, fellow, request["id"], "approve")
        assert response.status_code == 404
        response = await _vote(db_session, chief, request["id"], "approve")
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "approved"

    async def test_a_members_request_still_goes_to_the_approvers(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        _, chief, _, (board0, _), member = await _board_department(db_session, org_id)

        request = await _ask(db_session, member)

        assert request["routed_to_chief"] is False
        assert request["approver_count"] == 2
        response = await _vote(db_session, chief, request["id"], "approve")
        assert response.status_code == 404
        response = await _vote(db_session, board0, request["id"], "approve")
        assert response.json()["status"] == "approved"

    async def test_a_request_made_before_the_rule_keeps_its_approvers(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        _, chief, _, (asker, fellow), _ = await _board_department(db_session, org_id)
        request = await _ask(db_session, asker)
        # As every request stored before the column existed reads.
        stored = await db_session.get(LeaveRequest, request["id"])
        stored.routed_to_chief = False
        await db_session.flush()

        response = await _vote(db_session, chief, request["id"], "approve")
        assert response.status_code == 404
        response = await _vote(db_session, fellow, request["id"], "approve")
        assert response.json()["status"] == "approved"

    async def test_a_chief_who_is_also_an_approver_goes_to_those_who_manage_leave(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, chief, board, (board0, _), _ = await _board_department(
            db_session, org_id
        )
        await db_session.execute(
            user_positions.insert().values(user_id=chief.id, position_id=board.id)
        )
        await db_session.flush()

        request = await _ask(db_session, chief)

        assert request["routed_to_chief"] is True
        response = await _vote(db_session, board0, request["id"], "approve")
        assert response.status_code == 404
        response = await _vote(db_session, officer, request["id"], "approve")
        assert response.json()["status"] == "approved"


class TestAStandInDecidesInTheApproversPlace:
    async def test_the_stand_in_votes_for_the_away_approver(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, _, _, (away, _), member = await _board_department(
            db_session, org_id, rule="all"
        )
        today = await resolve_org_today(db_session, org_id)
        response = await _cover(
            db_session, away, away, officer, today, today + timedelta(days=6)
        )
        assert response.status_code == 201, response.text
        request = await _ask(db_session, member)

        refused = await _vote(db_session, away, request["id"], "approve")
        assert refused.status_code == 409
        assert "standing in for you" in refused.json()["detail"]

        response = await _vote(db_session, officer, request["id"], "approve")
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "pending"
        assert body["approvals"] == 1
        assert body["approver_count"] == 2
        [vote] = body["votes"]
        assert vote["voter_name"] == "Olive Tester"
        assert vote["on_behalf_of_name"] == "Board0 Tester"

    async def test_the_stand_ins_vote_still_counts_once_the_cover_ends(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, _, _, (away, present), member = await _board_department(
            db_session, org_id, rule="all"
        )
        today = await resolve_org_today(db_session, org_id)
        await _cover(db_session, officer, away, officer, today, today)
        request = await _ask(db_session, member)
        await _vote(db_session, officer, request["id"], "approve")

        cover_id = (await _board(db_session, officer))["covers"][0]["id"]
        async with _as(db_session, away, []) as client:
            cleared = await client.delete(f"/users/leave-requests/covers/{cover_id}")
        assert cleared.status_code == 200, cleared.text

        # The approver's seat is already filled, by the stand-in's vote.
        again = await _vote(db_session, away, request["id"], "approve")
        assert again.status_code == 409
        response = await _vote(db_session, present, request["id"], "approve")
        assert response.json()["status"] == "approved"

    async def test_a_stand_in_who_stops_managing_leave_stops_standing_in(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, _, _, (away, _), member = await _board_department(db_session, org_id)
        today = await resolve_org_today(db_session, org_id)
        await _cover(db_session, away, away, officer, today, today)
        await db_session.execute(
            delete(user_positions).where(user_positions.c.user_id == officer.id)
        )
        await db_session.flush()
        # Each request loads members afresh; the shared test session would
        # otherwise hand back the officer's positions as first loaded.
        db_session.expire(officer, ["positions"])
        request = await _ask(db_session, member)

        response = await _vote(db_session, away, request["id"], "approve")

        assert response.status_code == 200, response.text
        assert response.json()["status"] == "approved"

    async def test_a_stand_in_who_is_also_an_approver_fills_both_seats(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, _, board, (away,), member = await _board_department(
            db_session, org_id, board_size=1, rule="all"
        )
        manage = await _position(db_session, org_id, "deputy", ["members.manage"])
        both = await _user(db_session, org_id, "Bailey", [board, manage])
        today = await resolve_org_today(db_session, org_id)
        await _cover(db_session, officer, away, both, today, today)
        request = await _ask(db_session, member)
        assert request["approver_count"] == 2

        response = await _vote(db_session, both, request["id"], "approve")

        assert response.json()["status"] == "approved"
        seats = (
            await db_session.execute(
                select(LeaveRequestVote.seat_id, LeaveRequestVote.on_behalf_of).where(
                    LeaveRequestVote.request_id == request["id"]
                )
            )
        ).all()
        assert sorted(tuple(row) for row in seats) == sorted(
            [(str(both.id), None), (str(away.id), str(away.id))]
        )

    async def test_reminders_go_to_the_stand_in(self, db_session, setup_org_and_admin):
        org_id, _ = setup_org_and_admin
        officer, _, _, (away, present), member = await _board_department(
            db_session, org_id, rule="all"
        )
        today = await resolve_org_today(db_session, org_id)
        await _cover(db_session, officer, away, officer, today, today)
        request = await _ask(db_session, member)
        stored = await db_session.get(LeaveRequest, request["id"])

        waiting = await LeaveRequestService(db_session).waiting_on_ids(org_id, stored)

        assert waiting == {str(officer.id), str(present.id)}


class TestSettingACover:
    async def test_set_and_cleared_are_audited(self, db_session, setup_org_and_admin):
        org_id, _ = setup_org_and_admin
        officer, _, _, (away, _), _ = await _board_department(db_session, org_id)
        today = await resolve_org_today(db_session, org_id)
        await _cover(db_session, away, away, officer, today, today)
        cover_id = (await _board(db_session, away))["covers"][0]["id"]
        async with _as(db_session, officer, []) as client:
            await client.delete(f"/users/leave-requests/covers/{cover_id}")

        events = (
            await db_session.execute(
                select(AuditLog.event_type, AuditLog.event_data)
                .where(AuditLog.event_type.like("leave_approver_cover_%"))
                .order_by(AuditLog.id)
            )
        ).all()
        assert [e[0] for e in events] == [
            "leave_approver_cover_set",
            "leave_approver_cover_cleared",
        ]
        assert all(e[1]["cover_id"] == cover_id for e in events)

    async def test_the_stand_in_must_manage_leave(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        _, _, _, (away, other), _ = await _board_department(db_session, org_id)
        today = await resolve_org_today(db_session, org_id)

        response = await _cover(db_session, away, away, other, today, today)

        assert response.status_code == 400
        assert "manages leave" in response.json()["detail"]

    async def test_only_an_officer_may_set_someone_elses(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, _, _, (away, other), _ = await _board_department(db_session, org_id)
        today = await resolve_org_today(db_session, org_id)

        response = await _cover(db_session, other, away, officer, today, today)

        assert response.status_code == 409

    async def test_a_member_who_is_not_an_approver_cannot_be_covered(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, _, _, _, member = await _board_department(db_session, org_id)
        today = await resolve_org_today(db_session, org_id)

        response = await _cover(db_session, officer, member, officer, today, today)

        assert response.status_code == 400

    async def test_overlapping_and_backdated_covers_are_refused(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, _, _, (away, _), _ = await _board_department(db_session, org_id)
        today = await resolve_org_today(db_session, org_id)
        first = await _cover(
            db_session, away, away, officer, today, today + timedelta(days=5)
        )
        assert first.status_code == 201

        overlap = await _cover(
            db_session,
            away,
            away,
            officer,
            today + timedelta(days=5),
            today + timedelta(days=9),
        )
        backdated = await _cover(
            db_session,
            away,
            away,
            officer,
            today - timedelta(days=1),
            today - timedelta(days=1),
        )

        assert overlap.status_code == 409
        assert backdated.status_code == 400

    async def test_a_member_sees_only_covers_naming_them(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, _, _, (away, other), member = await _board_department(
            db_session, org_id
        )
        today = await resolve_org_today(db_session, org_id)
        await _cover(db_session, away, away, officer, today, today)

        assert len((await _board(db_session, officer))["covers"]) == 1
        assert len((await _board(db_session, away))["covers"]) == 1
        assert (await _board(db_session, other))["covers"] == []
        plain = await _board(db_session, member)
        assert plain["covers"] == []
        assert plain["approvers"] == []
        assert plain["stand_ins"] == []

    async def test_a_member_it_does_not_name_is_not_told_it_exists(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, _, _, (away, other), _ = await _board_department(db_session, org_id)
        today = await resolve_org_today(db_session, org_id)
        await _cover(db_session, away, away, officer, today, today)
        cover_id = (await _board(db_session, away))["covers"][0]["id"]

        async with _as(db_session, other, []) as client:
            hidden = await client.delete(f"/users/leave-requests/covers/{cover_id}")

        assert hidden.status_code == 404
        assert len((await _board(db_session, officer))["covers"]) == 1

"""Members asking for leave, decided by the department's approvers and rule.

The department chooses who decides (positions, falling back to the Chief and
then to everyone who can record leave) and how (any one approver, a majority,
or all of them). An approval creates the leave as an officer would.
"""

import uuid
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload

from app.api.dependencies import get_current_active_user, get_current_user
from app.api.v1.endpoints import leave_requests
from app.core.database import get_db
from app.models.audit import AuditLog
from app.models.leave_request import LeaveDecisionRule as Rule
from app.models.leave_request import LeaveRequestStatus as Status
from app.models.leave_request import LeaveVote as Vote
from app.models.user import MemberLeaveOfAbsence, Position, User, user_positions
from app.services.leave_request_service import approvals_needed, settle

PRIVATE_REASON = "Recovering from surgery"


@pytest.mark.unit
class TestTheRule:
    @pytest.mark.parametrize(
        ("rule", "count", "needed"),
        [
            (Rule.ANY, 5, 1),
            (Rule.MAJORITY, 5, 3),
            (Rule.MAJORITY, 4, 3),
            (Rule.MAJORITY, 1, 1),
            (Rule.ALL, 3, 3),
            (Rule.ALL, 0, 0),
        ],
    )
    def test_approvals_needed(self, rule, count, needed):
        assert approvals_needed(rule, count) == needed

    def test_any_is_settled_by_the_vote_just_cast(self):
        assert settle(Rule.ANY, 3, 0, 1, latest=Vote.DENY) == Status.DENIED
        assert settle(Rule.ANY, 3, 1, 0, latest=Vote.APPROVE) == Status.APPROVED

    def test_majority_waits_then_approves(self):
        assert settle(Rule.MAJORITY, 5, 2, 0) is None
        assert settle(Rule.MAJORITY, 5, 3, 1) == Status.APPROVED

    def test_majority_is_denied_once_approval_cannot_be_reached(self):
        # 5 approvers need 3; 2 denials leave 3 possible, 3 denials leave 2.
        assert settle(Rule.MAJORITY, 5, 0, 2) is None
        assert settle(Rule.MAJORITY, 5, 1, 3) == Status.DENIED
        # 4 approvers need 3, so 2 denials already decide it.
        assert settle(Rule.MAJORITY, 4, 2, 2) == Status.DENIED

    def test_all_needs_everyone_and_one_denial_denies(self):
        assert settle(Rule.ALL, 3, 2, 0) is None
        assert settle(Rule.ALL, 3, 3, 0) == Status.APPROVED
        assert settle(Rule.ALL, 3, 2, 1) == Status.DENIED

    def test_nobody_to_decide_settles_nothing(self):
        assert settle(Rule.ANY, 0, 0, 0, latest=Vote.APPROVE) is None


async def _position(db, org_id: str, slug: str, permissions: list[str]) -> Position:
    position = Position(
        organization_id=org_id,
        name=slug.replace("_", " ").title(),
        slug=f"{slug}" if slug in ("chief",) else f"{slug}-{uuid.uuid4().hex[:6]}",
        permissions=permissions,
    )
    db.add(position)
    await db.flush()
    return position


async def _user(db, org_id: str, first: str, positions=()) -> User:
    user_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, 'Tester', :em, 'x', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"{first.lower()}-{user_id[:8]}",
            "fn": first,
            "em": f"{user_id[:8]}@example.com",
        },
    )
    for position in positions:
        await db.execute(
            user_positions.insert().values(user_id=user_id, position_id=position.id)
        )
    await db.flush()
    return (
        await db.execute(
            select(User)
            .where(User.id == user_id)
            .options(selectinload(User.positions))
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


@asynccontextmanager
async def _as(db, user: User, queued: list):
    """A client signed in as ``user``; each background email lands in ``queued``."""

    def _recorder(name):
        async def _record(*args, **kwargs):
            queued.append((name, args, kwargs))

        return _record

    app = FastAPI()
    app.include_router(leave_requests.router, prefix="/users")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_current_active_user] = lambda: user
    with patch.object(
        leave_requests, "send_request_submitted", _recorder("submitted")
    ), patch.object(
        leave_requests, "send_request_denied", _recorder("denied")
    ), patch.object(
        leave_requests, "send_approval_notice", _recorder("leave_notice")
    ), patch.object(
        leave_requests, "send_cover_named", _recorder("cover_named")
    ), patch.object(
        leave_requests, "send_cover_cleared", _recorder("cover_cleared")
    ), patch(
        "app.services.scheduling_service.SchedulingService."
        "cancel_member_assignments_in_range",
        AsyncMock(return_value=0),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://t"
        ) as client:
            yield client


async def _department(db, org_id: str, board_size: int = 0):
    """An officer who manages leave, the Chief, ``board_size`` board members and
    a member who asks."""
    manage = await _position(db, org_id, "secretary", ["members.manage"])
    chief = await _position(db, org_id, "chief", [])
    board = await _position(db, org_id, "board", [])
    officer = await _user(db, org_id, "Olive", [manage])
    chief_user = await _user(db, org_id, "Charlie", [chief])
    members = [await _user(db, org_id, f"Board{i}", [board]) for i in range(board_size)]
    member = await _user(db, org_id, "Morgan")
    return officer, chief_user, board, members, member


async def _configure(db, officer, **settings):
    async with _as(db, officer, []) as client:
        current = (await client.get("/users/leaves-of-absence/settings")).json()
        current.pop("available_positions")
        current.update(settings)
        response = await client.put("/users/leaves-of-absence/settings", json=current)
        assert response.status_code == 200, response.text
        return response.json()


async def _ask(db, member) -> dict:
    queued: list = []
    async with _as(db, member, queued) as client:
        response = await client.post(
            "/users/leave-requests",
            json={
                "leave_type": "medical",
                "start_date": "2026-12-01",
                "end_date": "2027-02-28",
                "reason": PRIVATE_REASON,
            },
        )
    assert response.status_code == 201, response.text
    assert [q[0] for q in queued] == ["submitted"]
    return response.json()


async def _vote(db, voter, request_id, vote, queued=None):
    async with _as(db, voter, queued if queued is not None else []) as client:
        return await client.post(
            f"/users/leave-requests/{request_id}/vote", json={"vote": vote}
        )


@pytest.mark.integration
class TestSettings:
    async def test_defaults_keep_todays_behaviour(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, *_ = await _department(db_session, org_id)
        async with _as(db_session, officer, []) as client:
            body = (await client.get("/users/leaves-of-absence/settings")).json()
        assert body["end_reminder_days"] == 7
        assert body["end_reminder_copy_officers"] is True
        assert body["requests_enabled"] is False
        assert body["request_decision_rule"] == "any"

    async def test_a_change_is_audited_from_and_to(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, *_ = await _department(db_session, org_id)
        await _configure(db_session, officer, request_decision_rule="majority")

        entry = (
            await db_session.execute(
                select(AuditLog)
                .where(AuditLog.event_type == "leave_settings_updated")
                .order_by(AuditLog.id.desc())
                .limit(1)
            )
        ).scalar_one()
        assert entry.event_data["changes"]["request_decision_rule"] == {
            "from": "any",
            "to": "majority",
        }

    async def test_another_departments_position_is_refused(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, *_ = await _department(db_session, org_id)
        other_org = str(uuid.uuid4())
        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, "
                "timezone) VALUES (:id, 'Other', 'fire_department', :slug, 'UTC')"
            ),
            {"id": other_org, "slug": f"o-{other_org[:8]}"},
        )
        foreign = await _position(db_session, other_org, "board", [])
        async with _as(db_session, officer, []) as client:
            current = (await client.get("/users/leaves-of-absence/settings")).json()
            current.pop("available_positions")
            current["request_approver_position_ids"] = [foreign.id]
            response = await client.put(
                "/users/leaves-of-absence/settings", json=current
            )
        assert response.status_code == 400

    async def test_only_those_who_manage_leave_may_change_them(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        *_, member = await _department(db_session, org_id)
        async with _as(db_session, member, []) as client:
            response = await client.get("/users/leaves-of-absence/settings")
        assert response.status_code == 403


@pytest.mark.integration
class TestRequests:
    async def test_requests_are_refused_until_the_department_turns_them_on(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        *_, member = await _department(db_session, org_id)
        async with _as(db_session, member, []) as client:
            assert (await client.get("/users/leave-requests/config")).json() == {
                "requests_enabled": False
            }
            response = await client.post(
                "/users/leave-requests", json={"start_date": "2026-12-01"}
            )
        assert response.status_code == 403

    async def test_with_no_positions_chosen_the_chief_decides(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, chief, _, _, member = await _department(db_session, org_id)
        await _configure(db_session, officer, requests_enabled=True)
        request = await _ask(db_session, member)

        # The officer who manages leave is not asked while there is a Chief.
        assert (
            await _vote(db_session, officer, request["id"], "approve")
        ).status_code == 409
        queued: list = []
        response = await _vote(db_session, chief, request["id"], "approve", queued)

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "approved"
        leave = (
            await db_session.execute(
                select(MemberLeaveOfAbsence).where(
                    MemberLeaveOfAbsence.id == body["leave_id"]
                )
            )
        ).scalar_one()
        assert str(leave.user_id) == member.id
        assert str(leave.granted_by) == chief.id
        assert leave.linked_training_waiver_id is not None
        assert [q[0] for q in queued] == ["leave_notice"]
        assert queued[0][2]["summary"].startswith("Your request")

    async def test_a_majority_of_the_board_decides(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, _, board, members, member = await _department(
            db_session, org_id, board_size=3
        )
        await _configure(
            db_session,
            officer,
            requests_enabled=True,
            request_approver_position_ids=[board.id],
            request_decision_rule="majority",
        )
        request = await _ask(db_session, member)

        first = (await _vote(db_session, members[0], request["id"], "approve")).json()
        assert first["status"] == "pending"
        assert (first["approvals"], first["approvals_needed"]) == (1, 2)
        second = (await _vote(db_session, members[1], request["id"], "approve")).json()
        assert second["status"] == "approved"
        # Settled: the third member's vote is too late.
        late = await _vote(db_session, members[2], request["id"], "deny")
        assert late.status_code == 409

    async def test_a_majority_denies_once_approval_cannot_be_reached(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, _, board, members, member = await _department(
            db_session, org_id, board_size=3
        )
        await _configure(
            db_session,
            officer,
            requests_enabled=True,
            request_approver_position_ids=[board.id],
            request_decision_rule="majority",
        )
        request = await _ask(db_session, member)

        await _vote(db_session, members[0], request["id"], "deny")
        queued: list = []
        body = (
            await _vote(db_session, members[1], request["id"], "deny", queued)
        ).json()

        assert body["status"] == "denied"
        assert [q[0] for q in queued] == ["denied"]

    async def test_all_must_approve_and_one_denial_denies(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, _, board, members, member = await _department(
            db_session, org_id, board_size=2
        )
        await _configure(
            db_session,
            officer,
            requests_enabled=True,
            request_approver_position_ids=[board.id],
            request_decision_rule="all",
        )
        request = await _ask(db_session, member)

        assert (await _vote(db_session, members[0], request["id"], "approve")).json()[
            "status"
        ] == "pending"
        assert (await _vote(db_session, members[1], request["id"], "deny")).json()[
            "status"
        ] == "denied"

    async def test_one_vote_each_and_never_on_ones_own(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, _, board, members, member = await _department(
            db_session, org_id, board_size=3
        )
        await _configure(
            db_session,
            officer,
            requests_enabled=True,
            request_approver_position_ids=[board.id],
            request_decision_rule="all",
        )
        request = await _ask(db_session, member)

        assert (
            await _vote(db_session, members[0], request["id"], "approve")
        ).status_code == 200
        again = await _vote(db_session, members[0], request["id"], "approve")
        assert again.status_code == 409
        own = await _vote(db_session, member, request["id"], "approve")
        assert own.status_code == 409

    async def test_a_stranger_cannot_see_or_decide_it(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, *_, member = await _department(db_session, org_id)
        await _configure(db_session, officer, requests_enabled=True)
        request = await _ask(db_session, member)
        stranger = await _user(db_session, org_id, "Sam")

        async with _as(db_session, stranger, []) as client:
            assert (
                await client.get(f"/users/leave-requests/{request['id']}")
            ).status_code == 404
            assert (await client.get("/users/leave-requests")).json() == []
        assert (
            await _vote(db_session, stranger, request["id"], "approve")
        ).status_code == 404

    async def test_the_approver_reads_the_reason(self, db_session, setup_org_and_admin):
        org_id, _ = setup_org_and_admin
        officer, chief, _, _, member = await _department(db_session, org_id)
        await _configure(db_session, officer, requests_enabled=True)
        request = await _ask(db_session, member)

        async with _as(db_session, chief, []) as client:
            [listed] = (await client.get("/users/leave-requests")).json()
        assert listed["id"] == request["id"]
        assert listed["reason"] == PRIVATE_REASON
        assert listed["can_vote"] is True

    async def test_the_member_can_withdraw_while_it_waits(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, chief, _, _, member = await _department(db_session, org_id)
        await _configure(db_session, officer, requests_enabled=True)
        request = await _ask(db_session, member)

        async with _as(db_session, member, []) as client:
            withdrawn = await client.post(
                f"/users/leave-requests/{request['id']}/withdraw"
            )
            mine = (await client.get("/users/leave-requests/me")).json()
        assert withdrawn.json()["status"] == "withdrawn"
        assert [r["status"] for r in mine] == ["withdrawn"]
        assert (
            await _vote(db_session, chief, request["id"], "approve")
        ).status_code == 409

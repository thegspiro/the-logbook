"""Leave requests: extensions, questions, changed dates, the recheck and reminders.

Owner decisions of 2026-11-16:

- A request that overlaps an active leave, or starts the day after it ends,
  extends that leave; one entirely inside a leave, or overlapping another
  waiting request, is refused.
- An approver's question pauses voting until the member answers.
- "Approve with changes": the member accepts or declines; accepting moves the
  request onto the new dates and starts voting again with the proposer's
  approval counted.
- Undecided requests are reminded about by email and in-app, three days in
  and weekly after.
- Waiting requests are rechecked daily against the current approvers.
"""

import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select

from app.api.dependencies import get_current_active_user, get_current_user
from app.api.v1.endpoints import leave_requests
from app.core.database import get_db
from app.models.leave_request import LeaveNoticeSend, LeaveRequest
from app.models.notification import NotificationLog
from app.models.user import (
    LeaveType,
    MemberLeaveOfAbsence,
    Organization,
    user_positions,
)
from app.services import leave_workflow_notices as notices
from app.services.leave_request_service import LeaveRequestService
from tests.test_leave_requests import _configure, _department

PRIVATE_QUESTION = "Is this for the surgery you mentioned?"


@asynccontextmanager
async def _as(db, user, queued: list):
    """A client signed in as ``user``; each queued notice lands in ``queued``."""

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
        leave_requests, "send_leave_notice", _recorder("leave_notice")
    ), patch.object(
        leave_requests, "send_request_event", _recorder("event")
    ), patch(
        "app.services.scheduling_service.SchedulingService."
        "cancel_member_assignments_in_range",
        AsyncMock(return_value=0),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://t"
        ) as client:
            yield client


async def _ask(db, member, start, end=None, expect=201):
    async with _as(db, member, []) as client:
        response = await client.post(
            "/users/leave-requests",
            json={
                "leave_type": "personal",
                "start_date": start,
                **({"end_date": end} if end else {}),
            },
        )
    assert response.status_code == expect, response.text
    return response.json()


async def _post(db, user, path, body, queued=None):
    async with _as(db, user, queued if queued is not None else []) as client:
        return await client.post(path, json=body)


def _leave(db, org_id, member, start, end):
    leave = MemberLeaveOfAbsence(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        user_id=member.id,
        leave_type=LeaveType.LEAVE_OF_ABSENCE,
        start_date=start,
        end_date=end,
        active=True,
    )
    db.add(leave)
    return leave


async def _leaves_of(db, member):
    return (
        (
            await db.execute(
                select(MemberLeaveOfAbsence).where(
                    MemberLeaveOfAbsence.user_id == member.id,
                    MemberLeaveOfAbsence.active.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )


@pytest.mark.integration
class TestExtensions:
    async def test_an_overlapping_request_extends_the_leave(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, chief, _, _, member = await _department(db_session, org_id)
        await _configure(db_session, officer, requests_enabled=True)
        leave = _leave(db_session, org_id, member, date(2026, 12, 1), date(2027, 1, 31))
        await db_session.flush()

        request = await _ask(db_session, member, "2027-01-15", "2027-03-31")
        assert request["extends_leave"] == {
            "start_date": "2026-12-01",
            "end_date": "2027-01-31",
        }

        queued: list = []
        body = (
            await _post(
                db_session,
                chief,
                f"/users/leave-requests/{request['id']}/vote",
                {"vote": "approve"},
                queued,
            )
        ).json()

        assert body["status"] == "approved"
        assert body["leave_id"] == leave.id
        [only] = await _leaves_of(db_session, member)
        assert (only.start_date, only.end_date) == (
            date(2026, 12, 1),
            date(2027, 3, 31),
        )
        [(name, args, kwargs)] = queued
        assert name == "leave_notice"
        assert args[3] == "updated"
        assert kwargs["summary"] == "Your request to extend your leave was approved."

    async def test_a_request_starting_the_day_after_extends_it(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, *_, member = await _department(db_session, org_id)
        await _configure(db_session, officer, requests_enabled=True)
        leave = _leave(db_session, org_id, member, date(2026, 12, 1), date(2027, 1, 31))
        await db_session.flush()

        request = await _ask(db_session, member, "2027-02-01", "2027-02-28")

        assert request["extends_leave"]["end_date"] == "2027-01-31"
        stored = await db_session.get(LeaveRequest, request["id"])
        assert stored.extends_leave_id == leave.id

    async def test_a_request_starting_later_is_a_new_leave(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, *_, member = await _department(db_session, org_id)
        await _configure(db_session, officer, requests_enabled=True)
        _leave(db_session, org_id, member, date(2026, 12, 1), date(2027, 1, 31))
        await db_session.flush()

        request = await _ask(db_session, member, "2027-02-02", "2027-02-28")

        assert request["extends_leave"] is None

    async def test_dates_already_covered_are_refused(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, *_, member = await _department(db_session, org_id)
        await _configure(db_session, officer, requests_enabled=True)
        _leave(db_session, org_id, member, date(2026, 12, 1), date(2027, 1, 31))
        await db_session.flush()

        async with _as(db_session, member, []) as client:
            response = await client.post(
                "/users/leave-requests",
                json={"start_date": "2026-12-10", "end_date": "2027-01-10"},
            )
        assert response.status_code == 403
        assert "already covers" in response.json()["detail"]

    async def test_dates_overlapping_a_waiting_request_are_refused(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, *_, member = await _department(db_session, org_id)
        await _configure(db_session, officer, requests_enabled=True)
        await _ask(db_session, member, "2027-03-01", "2027-03-31")

        async with _as(db_session, member, []) as client:
            response = await client.post(
                "/users/leave-requests",
                json={"start_date": "2027-03-15", "end_date": "2027-04-15"},
            )
        assert response.status_code == 403
        assert "still waiting" in response.json()["detail"]

    async def test_approval_rechecks_leave_recorded_meanwhile(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, chief, _, _, member = await _department(db_session, org_id)
        await _configure(db_session, officer, requests_enabled=True)
        request = await _ask(db_session, member, "2027-03-01", "2027-03-31")
        # An officer records a leave inside those dates while it waits.
        _leave(db_session, org_id, member, date(2027, 3, 10), date(2027, 3, 20))
        await db_session.flush()

        response = await _post(
            db_session,
            chief,
            f"/users/leave-requests/{request['id']}/vote",
            {"vote": "approve"},
        )

        # Not covered (the request is wider), so the approval extends the
        # officer's leave to the request's dates rather than adding a second.
        assert response.status_code == 200, response.text
        [only] = await _leaves_of(db_session, member)
        assert (only.start_date, only.end_date) == (date(2027, 3, 1), date(2027, 3, 31))


@pytest.mark.integration
class TestApprovalRefusedOnRecheck:
    async def test_dates_now_touching_two_leaves_cannot_be_approved(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, chief, _, _, member = await _department(db_session, org_id)
        await _configure(db_session, officer, requests_enabled=True)
        _leave(db_session, org_id, member, date(2027, 1, 1), date(2027, 3, 5))
        await db_session.flush()
        request = await _ask(db_session, member, "2027-03-01", "2027-03-31")
        # While it waits, an officer records a second leave the request's dates
        # also touch: approving now would need the two merged.
        _leave(db_session, org_id, member, date(2027, 3, 20), date(2027, 4, 10))
        await db_session.flush()

        response = await _post(
            db_session,
            chief,
            f"/users/leave-requests/{request['id']}/vote",
            {"vote": "approve"},
        )

        assert response.status_code == 409
        assert "more than one of your leaves" in response.json()["detail"]
        stored = await db_session.get(LeaveRequest, request["id"])
        await db_session.refresh(stored)
        assert stored.status.value == "pending"
        assert len(await _leaves_of(db_session, member)) == 2


@pytest.mark.integration
class TestQuestions:
    async def test_a_question_pauses_voting_until_the_member_answers(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, chief, _, _, member = await _department(db_session, org_id)
        await _configure(db_session, officer, requests_enabled=True)
        request = await _ask(db_session, member, "2027-03-01", "2027-03-31")
        path = f"/users/leave-requests/{request['id']}"

        queued: list = []
        asked = await _post(
            db_session, chief, f"{path}/question", {"text": PRIVATE_QUESTION}, queued
        )
        assert asked.status_code == 200, asked.text
        assert asked.json()["awaiting"] == "answer"
        assert [q[0] for q in queued] == ["event"]
        assert queued[0][1][2] == notices.QUESTION_ASKED

        blocked = await _post(db_session, chief, f"{path}/vote", {"vote": "approve"})
        assert blocked.status_code == 409

        queued = []
        answered = await _post(
            db_session, member, f"{path}/answer", {"text": "Yes."}, queued
        )
        assert answered.json()["awaiting"] is None
        assert queued[0][1][2] == notices.ANSWERED
        assert [(m["kind"], m["body"]) for m in answered.json()["messages"]] == [
            ("question", PRIVATE_QUESTION),
            ("answer", "Yes."),
        ]

        voted = await _post(db_session, chief, f"{path}/vote", {"vote": "approve"})
        assert voted.json()["status"] == "approved"

    async def test_only_the_member_answers_and_only_approvers_ask(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, chief, _, _, member = await _department(db_session, org_id)
        await _configure(db_session, officer, requests_enabled=True)
        request = await _ask(db_session, member, "2027-03-01", "2027-03-31")
        path = f"/users/leave-requests/{request['id']}"

        own = await _post(db_session, member, f"{path}/question", {"text": "Hi"})
        assert own.status_code == 409
        await _post(db_session, chief, f"{path}/question", {"text": "Why?"})
        not_theirs = await _post(db_session, chief, f"{path}/answer", {"text": "x"})
        assert not_theirs.status_code == 404
        twice = await _post(db_session, chief, f"{path}/question", {"text": "And?"})
        assert twice.status_code == 409


@pytest.mark.integration
class TestApproveWithChanges:
    async def test_under_any_one_accepting_settles_on_the_new_dates(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, chief, _, _, member = await _department(db_session, org_id)
        await _configure(db_session, officer, requests_enabled=True)
        request = await _ask(db_session, member, "2027-03-01", "2027-03-31")
        path = f"/users/leave-requests/{request['id']}"

        proposed = await _post(
            db_session,
            chief,
            f"{path}/changes",
            {"start_date": "2027-03-15", "end_date": "2027-04-15", "note": "Later"},
        )
        assert proposed.json()["awaiting"] == "proposal"
        assert proposed.json()["proposal"]["start_date"] == "2027-03-15"
        assert (
            await _post(db_session, chief, f"{path}/vote", {"vote": "approve"})
        ).status_code == 409

        queued: list = []
        accepted = (
            await _post(
                db_session, member, f"{path}/changes/respond", {"accept": True}, queued
            )
        ).json()

        assert accepted["status"] == "approved"
        assert (accepted["start_date"], accepted["end_date"]) == (
            "2027-03-15",
            "2027-04-15",
        )
        [leave] = await _leaves_of(db_session, member)
        assert (leave.start_date, leave.end_date) == (
            date(2027, 3, 15),
            date(2027, 4, 15),
        )
        # The notice names the approver who decided, so it reaches the member.
        [(name, args, _)] = queued
        assert name == "leave_notice"
        assert args[2] == chief.id

    async def test_under_majority_votes_restart_with_the_proposers_approval(
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
        request = await _ask(db_session, member, "2027-03-01", "2027-03-31")
        path = f"/users/leave-requests/{request['id']}"
        a, b, _c = members
        assert (await _post(db_session, a, f"{path}/vote", {"vote": "approve"})).json()[
            "approvals"
        ] == 1

        await _post(
            db_session,
            b,
            f"{path}/changes",
            {"start_date": "2027-03-01", "end_date": "2027-03-20"},
        )
        accepted = (
            await _post(db_session, member, f"{path}/changes/respond", {"accept": True})
        ).json()

        # Round two: B's approval counts, A's from round one does not.
        assert accepted["status"] == "pending"
        assert accepted["vote_round"] == 2
        assert (accepted["approvals"], accepted["approvals_needed"]) == (1, 2)
        again = (await _post(db_session, a, f"{path}/vote", {"vote": "approve"})).json()
        assert again["status"] == "approved"
        assert again["end_date"] == "2027-03-20"

    async def test_declining_keeps_the_members_dates_and_the_votes(
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
        request = await _ask(db_session, member, "2027-03-01", "2027-03-31")
        path = f"/users/leave-requests/{request['id']}"
        await _post(db_session, members[0], f"{path}/vote", {"vote": "approve"})
        await _post(
            db_session,
            members[1],
            f"{path}/changes",
            {"start_date": "2027-03-01", "end_date": "2027-03-10"},
        )

        queued: list = []
        declined = (
            await _post(
                db_session,
                member,
                f"{path}/changes/respond",
                {"accept": False},
                queued,
            )
        ).json()

        assert declined["awaiting"] is None
        assert declined["end_date"] == "2027-03-31"
        assert (declined["vote_round"], declined["approvals"]) == (1, 1)
        assert queued[0][1][2] == notices.CHANGES_DECLINED


@pytest.mark.integration
class TestDailyRecheck:
    async def test_a_majority_reached_by_an_approver_leaving_is_settled(
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
        request = await _ask(db_session, member, "2027-03-01", "2027-03-31")
        await _post(
            db_session,
            members[0],
            f"/users/leave-requests/{request['id']}/vote",
            {"vote": "approve"},
        )
        # Two of the three board members step down: one approval of one
        # approver is now a majority, and nobody is left to vote it through.
        for gone in members[1:]:
            await db_session.execute(
                delete(user_positions).where(user_positions.c.user_id == gone.id)
            )
        await db_session.flush()

        with patch(
            "app.services.scheduling_service.SchedulingService."
            "cancel_member_assignments_in_range",
            AsyncMock(return_value=0),
        ):
            settled = await LeaveRequestService(db_session).resettle_pending(org_id)

        assert [r.id for r in settled] == [request["id"]]
        assert settled[0].status.value == "approved"
        [leave] = await _leaves_of(db_session, member)
        assert leave.end_date == date(2027, 3, 31)

    async def test_nothing_settles_while_the_rule_is_unmet(
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
        request = await _ask(db_session, member, "2027-03-01", "2027-03-31")
        await _post(
            db_session,
            members[0],
            f"/users/leave-requests/{request['id']}/vote",
            {"vote": "approve"},
        )

        assert await LeaveRequestService(db_session).resettle_pending(org_id) == []


@pytest.mark.unit
class TestReminderSchedule:
    @pytest.mark.parametrize(
        ("days", "number"),
        [(0, 0), (2, 0), (3, 1), (9, 1), (10, 2), (17, 3)],
    )
    def test_three_days_then_weekly(self, days, number):
        made = date(2027, 3, 1)
        assert (
            notices.reminder_number(made, date.fromordinal(made.toordinal() + days))
            == number
        )


@pytest.mark.integration
class TestReminders:
    async def _run(self, db, org_id, today):
        async def _on(*_a, **_kw):
            return today

        org = (
            await db.execute(select(Organization).where(Organization.id == org_id))
        ).scalar_one()
        with patch.object(notices, "resolve_org_today", _on), patch(
            "app.services.email_service.EmailService.send_email",
            AsyncMock(return_value=(1, 0)),
        ) as send:
            count = await notices.send_request_reminders(db, org)
        return count, [c.kwargs["to_emails"][0] for c in send.call_args_list]

    async def test_approvers_who_have_not_voted_are_reminded_once(
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
        request = await _ask(db_session, member, "2027-03-01", "2027-03-31")
        await _post(
            db_session,
            members[0],
            f"/users/leave-requests/{request['id']}/vote",
            {"vote": "approve"},
        )
        stored = await db_session.get(LeaveRequest, request["id"])
        stored.created_at = datetime(2027, 1, 4, 12, tzinfo=timezone.utc)
        await db_session.flush()

        # Two days in: nothing yet.
        assert await self._run(db_session, org_id, date(2027, 1, 6)) == (0, [])
        count, emailed = await self._run(db_session, org_id, date(2027, 1, 7))

        assert count == 1
        assert emailed == [members[1].email]
        bells = (
            (
                await db_session.execute(
                    select(NotificationLog).where(
                        NotificationLog.category == notices.BELL_CATEGORY,
                        NotificationLog.recipient_id == members[1].id,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(bells) == 1
        assert bells[0].action_url == "/members/leave-requests"
        # The same day again, and the rest of the week: already claimed.
        assert await self._run(db_session, org_id, date(2027, 1, 9)) == (0, [])
        # A week after the first: the second reminder.
        assert (await self._run(db_session, org_id, date(2027, 1, 14)))[0] == 1
        claims = (
            (
                await db_session.execute(
                    select(LeaveNoticeSend.key).where(
                        LeaveNoticeSend.kind == notices.KIND_REQUEST_REMINDER
                    )
                )
            )
            .scalars()
            .all()
        )
        assert sorted(claims) == [f"{request['id']}:1", f"{request['id']}:2"]

    async def test_a_request_waiting_on_its_member_is_not_reminded_about(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, chief, _, _, member = await _department(db_session, org_id)
        await _configure(db_session, officer, requests_enabled=True)
        request = await _ask(db_session, member, "2027-03-01", "2027-03-31")
        await _post(
            db_session,
            chief,
            f"/users/leave-requests/{request['id']}/question",
            {"text": "Why?"},
        )
        stored = await db_session.get(LeaveRequest, request["id"])
        stored.created_at = datetime(2027, 1, 4, 12, tzinfo=timezone.utc)
        await db_session.flush()

        assert await self._run(db_session, org_id, date(2027, 1, 20)) == (0, [])


@pytest.mark.integration
class TestSummary:
    async def test_counts_what_waits_on_each_person(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, chief, _, _, member = await _department(db_session, org_id)
        await _configure(db_session, officer, requests_enabled=True)
        request = await _ask(db_session, member, "2027-03-01", "2027-03-31")

        async with _as(db_session, chief, []) as client:
            assert (await client.get("/users/leave-requests/summary")).json() == {
                "requests_enabled": True,
                "to_decide": 1,
                "waiting_on_me": 0,
            }
        await _post(
            db_session,
            chief,
            f"/users/leave-requests/{request['id']}/question",
            {"text": "Why?"},
        )
        async with _as(db_session, chief, []) as client:
            assert (await client.get("/users/leave-requests/summary")).json()[
                "to_decide"
            ] == 0
        async with _as(db_session, member, []) as client:
            assert (await client.get("/users/leave-requests/summary")).json()[
                "waiting_on_me"
            ] == 1

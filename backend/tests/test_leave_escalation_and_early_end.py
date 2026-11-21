"""A request left undecided is escalated; a member may end their own leave early.

Owner decisions of 2026-11-17:

- A request still undecided after the department's chosen number of days
  (default 21, 0 for never) is sent, once, to the Chief -- or, when no Chief
  can open it, to the officers who manage leave -- by email and in-app.
- A member whose department takes leave requests may end their own leave in
  progress by giving their first day back. It needs no vote; the officers
  who manage leave are told.
"""

from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.api.dependencies import get_current_active_user, get_current_user
from app.api.v1.endpoints import leave_requests
from app.core.database import get_db
from app.models.audit import AuditLog
from app.models.leave_request import LeaveNoticeSend, LeaveRequest
from app.models.notification import NotificationLog
from app.models.training import TrainingWaiver
from app.models.user import MemberLeaveOfAbsence, Organization
from app.services import leave_workflow_notices as notices
from app.services.member_leave_service import MemberLeaveService
from tests.test_leave_requests import _configure, _department

PRIVATE_REASON = "Recovering from knee surgery"


@asynccontextmanager
async def _as(db, user, queued: list, today: date = date(2027, 1, 10)):
    """A client signed in as ``user`` on ``today``; notices land in ``queued``."""

    def _recorder(name):
        async def _record(*args, **kwargs):
            queued.append((name, args, kwargs))

        return _record

    async def _today(*_a, **_kw):
        return today

    app = FastAPI()
    app.include_router(leave_requests.router, prefix="/users")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_current_active_user] = lambda: user
    with patch.object(
        leave_requests, "send_request_submitted", _recorder("submitted")
    ), patch.object(
        leave_requests, "send_request_event", _recorder("event")
    ), patch.object(
        leave_requests, "send_leave_ended_early", _recorder("ended_early")
    ), patch(
        "app.services.leave_request_service.resolve_org_today", _today
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://t"
        ) as client:
            yield client


async def _ask(db, member, start="2027-03-01", end="2027-03-31"):
    async with _as(db, member, []) as client:
        response = await client.post(
            "/users/leave-requests",
            json={"leave_type": "personal", "start_date": start, "end_date": end},
        )
    assert response.status_code == 201, response.text
    return response.json()


async def _made_on(db, request_id, day: date):
    stored = await db.get(LeaveRequest, request_id)
    stored.created_at = datetime(day.year, day.month, day.day, 12, tzinfo=timezone.utc)
    await db.flush()


async def _bells(db, recipient, category=notices.BELL_CATEGORY):
    return (
        (
            await db.execute(
                select(NotificationLog).where(
                    NotificationLog.category == category,
                    NotificationLog.recipient_id == recipient.id,
                )
            )
        )
        .scalars()
        .all()
    )


@pytest.mark.unit
class TestWaitingOn:
    def _request(self, **fields):
        request = LeaveRequest(id="r", organization_id="o", user_id="m")
        for key, value in fields.items():
            setattr(request, key, value)
        return request

    def _user(self, name):
        from app.models.user import User

        return User(id=name, username=name, first_name=name, last_name="")

    def test_names_the_approvers_yet_to_decide(self):
        people = [self._user(n) for n in ("Avery", "Blake", "Casey")]
        assert notices.waiting_on_sentence(self._request(), "Morgan", people) == (
            "It is waiting on Avery, Blake and Casey to decide."
        )
        assert notices.waiting_on_sentence(self._request(), "Morgan", people[:1]) == (
            "It is waiting on Avery to decide."
        )

    def test_names_the_member_when_the_request_waits_on_them(self):
        now = datetime.now(timezone.utc)
        assert notices.waiting_on_sentence(
            self._request(info_requested_at=now), "Morgan", []
        ) == ("It is waiting on Morgan to answer an approver's question.")
        assert "accept or decline changed dates" in notices.waiting_on_sentence(
            self._request(proposed_at=now), "Morgan", []
        )


@pytest.mark.integration
class TestEscalation:
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
            count = await notices.send_request_escalations(db, org)
        return count, [c.kwargs for c in send.call_args_list]

    async def test_defaults_to_three_weeks(self, db_session, setup_org_and_admin):
        org_id, _ = setup_org_and_admin
        officer, *_ = await _department(db_session, org_id)
        body = await _configure(db_session, officer)
        assert body["request_escalation_days"] == 21

    async def test_the_chief_is_told_once_after_the_limit(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, chief, _, _, member = await _department(db_session, org_id)
        await _configure(db_session, officer, requests_enabled=True)
        request = await _ask(db_session, member)
        await _made_on(db_session, request["id"], date(2027, 1, 4))

        assert await self._run(db_session, org_id, date(2027, 1, 24)) == (0, [])
        count, sent = await self._run(db_session, org_id, date(2027, 1, 25))

        assert count == 1
        assert [s["to_emails"] for s in sent] == [[chief.email]]
        body = " ".join(sent[0]["html_body"].split())
        assert "has waited 21 days without a decision" in body
        assert "It is waiting on Charlie Tester to decide." in body
        bells = await _bells(db_session, chief)
        assert [b.subject for b in bells] == ["Undecided for 21 days: Morgan Tester"]
        assert bells[0].action_url == "/members/leave-requests"
        # Once per request: a later run sends nothing.
        assert await self._run(db_session, org_id, date(2027, 2, 15)) == (0, [])
        claims = (
            (
                await db_session.execute(
                    select(LeaveNoticeSend.key).where(
                        LeaveNoticeSend.kind == notices.KIND_REQUEST_ESCALATION
                    )
                )
            )
            .scalars()
            .all()
        )
        assert claims == [request["id"]]

    async def test_a_chief_who_cannot_open_it_is_passed_over(
        self, db_session, setup_org_and_admin
    ):
        """With the board deciding, this Chief neither manages leave nor
        approves, so could not open the request: the officers are told."""
        org_id, _ = setup_org_and_admin
        officer, chief, board, _, member = await _department(
            db_session, org_id, board_size=2
        )
        await _configure(
            db_session,
            officer,
            requests_enabled=True,
            request_approver_position_ids=[board.id],
        )
        request = await _ask(db_session, member)
        await _made_on(db_session, request["id"], date(2027, 1, 4))

        count, sent = await self._run(db_session, org_id, date(2027, 1, 25))

        assert count == 1
        assert [s["to_emails"] for s in sent] == [[officer.email]]
        assert await _bells(db_session, chief) == []

    async def test_a_chief_asking_for_leave_is_not_told_about_it(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, chief, _, _, _ = await _department(db_session, org_id)
        await _configure(db_session, officer, requests_enabled=True)
        request = await _ask(db_session, chief)
        await _made_on(db_session, request["id"], date(2027, 1, 4))

        _, sent = await self._run(db_session, org_id, date(2027, 1, 25))

        assert [s["to_emails"] for s in sent] == [[officer.email]]

    async def test_zero_turns_it_off(self, db_session, setup_org_and_admin):
        org_id, _ = setup_org_and_admin
        officer, _, _, _, member = await _department(db_session, org_id)
        await _configure(
            db_session, officer, requests_enabled=True, request_escalation_days=0
        )
        request = await _ask(db_session, member)
        await _made_on(db_session, request["id"], date(2026, 6, 1))

        assert await self._run(db_session, org_id, date(2027, 1, 25)) == (0, [])

    async def test_the_daily_upkeep_escalates(self, db_session, setup_org_and_admin):
        org_id, _ = setup_org_and_admin
        officer, chief, _, _, member = await _department(db_session, org_id)
        await _configure(db_session, officer, requests_enabled=True)
        request = await _ask(db_session, member)
        await _made_on(db_session, request["id"], date(2027, 1, 4))

        async def _on(*_a, **_kw):
            return date(2027, 1, 25)

        org = await db_session.get(Organization, org_id)
        with patch.object(notices, "resolve_org_today", _on), patch(
            "app.services.email_service.EmailService.send_email",
            AsyncMock(return_value=(1, 0)),
        ):
            await notices.run_request_upkeep(db_session, org)

        # The reminder and the escalation are written in the same second, so
        # their order is not something to assert.
        assert sorted(b.subject for b in await _bells(db_session, chief)) == [
            "Undecided for 21 days: Morgan Tester",
            "Waiting on your decision: Morgan Tester",
        ]


@pytest.mark.integration
class TestEndingOwnLeaveEarly:
    async def _leave(self, db, org_id, member, officer, start, end):
        return await MemberLeaveService(db).create_leave(
            organization_id=org_id,
            user_id=member.id,
            start_date=start,
            end_date=end,
            reason=PRIVATE_REASON,
            granted_by=officer.id,
        )

    async def _end(self, db, member, leave_id, first_day_back, queued=None, **kw):
        async with _as(db, member, queued if queued is not None else [], **kw) as c:
            return await c.post(
                f"/users/leave-requests/my-leaves/{leave_id}/end-early",
                json={"first_day_back": first_day_back},
            )

    async def test_the_leave_ends_the_day_before_the_member_is_back(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, _, _, _, member = await _department(db_session, org_id)
        await _configure(db_session, officer, requests_enabled=True)
        leave = await self._leave(
            db_session, org_id, member, officer, date(2026, 12, 1), date(2027, 2, 28)
        )
        queued: list = []

        response = await self._end(db_session, member, leave.id, "2027-01-18", queued)

        assert response.status_code == 200, response.text
        assert response.json() == {
            "leave_id": leave.id,
            "start_date": "2026-12-01",
            "end_date": "2027-01-17",
            "previous_end_date": "2027-02-28",
            "first_day_back": "2027-01-18",
        }
        stored = await db_session.get(MemberLeaveOfAbsence, leave.id)
        assert stored.end_date == date(2027, 1, 17)
        waiver = await db_session.get(TrainingWaiver, stored.linked_training_waiver_id)
        assert waiver.end_date == date(2027, 1, 17)
        assert [(q[0], q[1][1:]) for q in queued] == [
            ("ended_early", (leave.id, date(2027, 2, 28)))
        ]
        audit = (
            (
                await db_session.execute(
                    select(AuditLog).where(
                        AuditLog.event_type == "leave_of_absence_ended_early"
                    )
                )
            )
            .scalars()
            .all()
        )
        assert [a.event_data["end_date"] for a in audit] == ["2027-01-17"]

    async def test_an_open_ended_leave_can_be_ended(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, _, _, _, member = await _department(db_session, org_id)
        await _configure(db_session, officer, requests_enabled=True)
        leave = await self._leave(
            db_session, org_id, member, officer, date(2026, 12, 1), None
        )

        response = await self._end(db_session, member, leave.id, "2027-01-11")

        assert response.status_code == 200, response.text
        assert response.json()["previous_end_date"] is None
        assert response.json()["end_date"] == "2027-01-10"

    async def test_refused_where_the_department_takes_no_requests(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, _, _, _, member = await _department(db_session, org_id)
        leave = await self._leave(
            db_session, org_id, member, officer, date(2026, 12, 1), date(2027, 2, 28)
        )

        response = await self._end(db_session, member, leave.id, "2027-01-18")

        assert response.status_code == 409
        assert "Ask an officer" in response.json()["detail"]
        stored = await db_session.get(MemberLeaveOfAbsence, leave.id)
        assert stored.end_date == date(2027, 2, 28)

    async def test_another_members_leave_is_not_found(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, chief, _, _, member = await _department(db_session, org_id)
        await _configure(db_session, officer, requests_enabled=True)
        leave = await self._leave(
            db_session, org_id, member, officer, date(2026, 12, 1), date(2027, 2, 28)
        )

        response = await self._end(db_session, chief, leave.id, "2027-01-18")

        assert response.status_code == 404

    @pytest.mark.parametrize(
        ("first_day_back", "detail"),
        [
            ("2027-03-01", "not earlier than your leave already ends"),
            ("2027-06-01", "not earlier than your leave already ends"),
            ("2026-12-01", "must be after your leave began"),
        ],
    )
    async def test_a_date_that_does_not_shorten_it_is_refused(
        self, db_session, setup_org_and_admin, first_day_back, detail
    ):
        org_id, _ = setup_org_and_admin
        officer, _, _, _, member = await _department(db_session, org_id)
        await _configure(db_session, officer, requests_enabled=True)
        leave = await self._leave(
            db_session, org_id, member, officer, date(2026, 12, 1), date(2027, 2, 28)
        )

        response = await self._end(db_session, member, leave.id, first_day_back)

        assert response.status_code == 400
        assert detail in response.json()["detail"]

    @pytest.mark.parametrize(
        ("today", "detail"),
        [
            (date(2026, 11, 20), "has not begun yet"),
            (date(2027, 3, 5), "has already ended"),
        ],
    )
    async def test_only_a_leave_in_progress_can_be_ended(
        self, db_session, setup_org_and_admin, today, detail
    ):
        org_id, _ = setup_org_and_admin
        officer, _, _, _, member = await _department(db_session, org_id)
        await _configure(db_session, officer, requests_enabled=True)
        leave = await self._leave(
            db_session, org_id, member, officer, date(2026, 12, 1), date(2027, 2, 28)
        )

        response = await self._end(
            db_session, member, leave.id, "2027-01-18", today=today
        )

        assert response.status_code == 409
        assert detail in response.json()["detail"]

    async def test_refused_while_a_request_to_extend_it_waits(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, _, _, _, member = await _department(db_session, org_id)
        await _configure(db_session, officer, requests_enabled=True)
        leave = await self._leave(
            db_session, org_id, member, officer, date(2026, 12, 1), date(2027, 2, 28)
        )
        request = await _ask(db_session, member, "2027-02-15", "2027-04-30")
        assert request["extends_leave"] is not None

        response = await self._end(db_session, member, leave.id, "2027-01-18")

        assert response.status_code == 409
        assert "Withdraw that request" in response.json()["detail"]

    async def test_the_officers_are_told_and_not_the_reason(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, chief, _, _, member = await _department(db_session, org_id)
        await _configure(db_session, officer, requests_enabled=True)
        leave = await self._leave(
            db_session, org_id, member, officer, date(2026, 12, 1), date(2027, 2, 28)
        )
        await self._end(db_session, member, leave.id, "2027-01-18")

        with patch(
            "app.services.email_service.EmailService.send_email",
            AsyncMock(return_value=(1, 0)),
        ) as send:
            count = await notices.notify_leave_ended_early(
                db_session, org_id, leave.id, date(2027, 2, 28)
            )

        assert count == 1
        sent = send.call_args_list[0].kwargs
        assert sent["to_emails"] == [officer.email]
        body = " ".join(sent["html_body"].split())
        assert "Their first day back is January 18, 2027." in body
        assert "February 28, 2027" in body
        assert "January 17, 2027" in body
        assert PRIVATE_REASON not in sent["html_body"]
        assert PRIVATE_REASON not in sent["text_body"]
        bells = await _bells(db_session, officer)
        assert [(b.subject, b.action_url) for b in bells] == [
            ("Morgan Tester ended their leave early", "/members/admin/waivers")
        ]
        assert await _bells(db_session, member) == []
        assert await _bells(db_session, chief) == []

    async def test_nothing_else_about_the_leave_changes(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, _, _, _, member = await _department(db_session, org_id)
        await _configure(db_session, officer, requests_enabled=True)
        leave = await self._leave(
            db_session, org_id, member, officer, date(2026, 12, 1), date(2027, 2, 28)
        )
        before = (leave.start_date, leave.leave_type, leave.reason, leave.granted_by)

        await self._end(db_session, member, leave.id, "2027-01-18")

        stored = await db_session.get(MemberLeaveOfAbsence, leave.id)
        assert (
            stored.start_date,
            stored.leave_type,
            stored.reason,
            stored.granted_by,
        ) == before
        assert stored.active is True

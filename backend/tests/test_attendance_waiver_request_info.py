"""A decider asks the member for more information (owner decision, 2026-11-13).

A decider may put a question to the member on a pending request; the request
stays pending, the deciders' prompts are put away and the member is told, by
the bell and by email, without the question itself. The member answers, the
deciders are asked again, and any number of rounds may follow, one open
question at a time. Deciding, withdrawing or voiding closes an open question.
The question and the answer are notes on the decision log, encrypted at rest,
and appear in no notice, email or audit row.
"""

from datetime import timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text

from app.api.dependencies import get_current_user, get_request_enabled_modules
from app.api.v1.api import api_router
from app.core.database import get_db
from app.core.security_middleware import verify_csrf_token
from app.models.attendance_waiver import (
    AttendanceWaiverAction,
    AttendanceWaiverRequestAction,
    AttendanceWaiverStatus,
    AttendanceWaiverWorkflow,
)
from app.models.audit import AuditLog
from app.models.notification import NotificationLog
from app.schemas.attendance_waiver import MAX_TEXT_LENGTH
from app.services import attendance_waiver_service as engine
from app.services.attendance_waiver_service import (
    MEMBER_UPDATE_CATEGORY,
    REVIEW_PROMPT_CATEGORY,
    AttendanceWaiverNotFound,
    AttendanceWaiverService,
    void_pending_for_events,
)
from tests.waiver_request_support import (
    assign,
    load,
    make_meeting_event,
    make_member,
    make_org,
    make_position,
    make_requirement,
    make_session,
    set_meeting_policy,
    set_policy,
    utc,
)

pytestmark = pytest.mark.integration

NOW = utc(2026, 11, 13, 15)
DRILL = utc(2026, 11, 20, 23)
QUESTION = "Which surgeon is treating the knee?"
ANSWER = "Dr. Hollis at St. Mary's orthopaedics"
TRAINING = "/api/v1/training/waivers/requests"
MEETINGS = "/api/v1/meetings/waiver-requests"


@pytest.fixture(autouse=True)
def _clock(monkeypatch):
    """A clock that moves a second on every read, so each log entry has its
    own time: a question and its answer share a place in the lifecycle's
    tie-break order, so entries stamped in the same second would not sort."""
    ticks = iter(range(10_000))
    monkeypatch.setattr(engine, "_now", lambda: NOW + timedelta(seconds=next(ticks)))


@pytest.fixture
def outbox(monkeypatch):
    """Every send_email call, instead of a mail server."""
    sent = []

    class FakeEmailService:
        def __init__(self, organization=None):
            self.organization = organization

        async def send_email(self, **kwargs):
            sent.append(SimpleNamespace(**kwargs))
            return True

    import app.services.email_service as email_service

    monkeypatch.setattr(email_service, "EmailService", FakeEmailService)
    return sent


@pytest.fixture
async def dept(db_session):
    org_id = await make_org(db_session)
    officer_pos = await make_position(db_session, org_id, "Training Officer")
    ids = {
        name: await make_member(db_session, org_id, name.title())
        for name in ("member", "officer", "deputy", "stranger")
    }
    await assign(db_session, ids["officer"], officer_pos)
    await assign(db_session, ids["deputy"], officer_pos)
    await set_policy(db_session, org_id, approver_position_ids=[officer_pos])
    requirement = await make_requirement(db_session, org_id)
    drill = await make_session(db_session, org_id, DRILL, link=[requirement])
    users = {name: await load(db_session, uid) for name, uid in ids.items()}
    return SimpleNamespace(org=org_id, drill=drill, **users)


def _svc(db) -> AttendanceWaiverService:
    return AttendanceWaiverService(db)


async def _submit(db, dept, reason="Knee surgery"):
    return await _svc(db).submit(dept.org, dept.member, dept.drill, None, reason)


async def _ask(db, dept, request, actor=None, question=QUESTION):
    return await _svc(db).request_info(
        dept.org, actor or dept.officer, request.id, question
    )


async def _bell(db, category, recipient):
    return list(
        (
            await db.execute(
                select(NotificationLog)
                .where(
                    NotificationLog.category == category,
                    NotificationLog.recipient_id == str(recipient),
                )
                .order_by(NotificationLog.created_at)
            )
        )
        .scalars()
        .all()
    )


async def _log(db, request):
    return list(
        (
            await db.execute(
                select(AttendanceWaiverRequestAction)
                .where(AttendanceWaiverRequestAction.request_id == str(request.id))
                .order_by(AttendanceWaiverRequestAction.created_at)
            )
        )
        .scalars()
        .all()
    )


async def _body(db, dept, viewer, request) -> dict:
    (body,) = await _svc(db).describe(dept.org, viewer, [request], with_actions=True)
    return body


# ---------------------------------------------------------------------------
# Asking
# ---------------------------------------------------------------------------


class TestAsking:
    async def test_asking_keeps_the_request_pending_and_logs_the_question(
        self, db_session, dept
    ):
        request = await _submit(db_session, dept)
        asked = await _ask(db_session, dept, request)
        assert asked.status == AttendanceWaiverStatus.PENDING
        assert asked.info_requested_at is not None
        entry = (await _log(db_session, request))[-1]
        assert entry.action == AttendanceWaiverAction.INFO_REQUESTED
        assert entry.actor_id == str(dept.officer.id)
        assert entry.note == QUESTION

    async def test_the_question_is_encrypted_at_rest(self, db_session, dept):
        request = await _submit(db_session, dept)
        await _ask(db_session, dept, request)
        raw = (
            await db_session.execute(
                text(
                    "SELECT note FROM attendance_waiver_request_actions "
                    "WHERE request_id = :r AND action = 'info_requested'"
                ),
                {"r": str(request.id)},
            )
        ).scalar_one()
        assert raw
        assert "surgeon" not in raw

    async def test_the_deciders_prompts_are_put_away(self, db_session, dept):
        request = await _submit(db_session, dept)
        await _ask(db_session, dept, request)
        for decider in (dept.officer, dept.deputy):
            (prompt,) = await _bell(db_session, REVIEW_PROMPT_CATEGORY, decider.id)
            await db_session.refresh(prompt)
            assert prompt.expires_at is not None

    async def test_the_member_is_told_without_the_question(
        self, db_session, dept, outbox
    ):
        request = await _submit(db_session, dept)
        outbox.clear()
        await _ask(db_session, dept, request)
        (notice,) = await _bell(db_session, MEMBER_UPDATE_CATEGORY, dept.member.id)
        assert "Officer Member asked for more information" in notice.message
        assert "Open it to answer" in notice.message
        assert "surgeon" not in notice.message
        assert "surgeon" not in (notice.subject or "")
        assert notice.action_url == "/training/my-training"
        (mail,) = outbox
        assert mail.to_emails == [dept.member.email]
        assert "asked for more information" in mail.text_body
        assert "surgeon" not in mail.text_body
        assert "surgeon" not in mail.html_body
        assert "/training/my-training" in mail.text_body

    async def test_the_audit_row_carries_ids_only(self, db_session, dept):
        request = await _submit(db_session, dept)
        await _ask(db_session, dept, request)
        (row,) = (
            (
                await db_session.execute(
                    select(AuditLog).where(
                        AuditLog.event_type
                        == "attendance_waiver_request_info_requested",
                        AuditLog.user_id == str(dept.officer.id),
                    )
                )
            )
            .scalars()
            .all()
        )
        assert row.event_data["request_id"] == str(request.id)
        assert "surgeon" not in str(row.event_data)

    async def test_the_member_cannot_ask_on_their_own_request(self, db_session, dept):
        request = await _submit(db_session, dept)
        with pytest.raises(PermissionError):
            await _ask(db_session, dept, request, actor=dept.member)

    async def test_someone_who_may_not_decide_is_not_shown_it(self, db_session, dept):
        request = await _submit(db_session, dept)
        with pytest.raises(AttendanceWaiverNotFound):
            await _ask(db_session, dept, request, actor=dept.stranger)

    async def test_only_one_question_is_open_at_a_time(self, db_session, dept):
        request = await _submit(db_session, dept)
        await _ask(db_session, dept, request)
        with pytest.raises(ValueError, match="already waiting"):
            await _ask(db_session, dept, request, actor=dept.deputy)

    async def test_a_decided_request_takes_no_question(self, db_session, dept):
        request = await _submit(db_session, dept)
        await _svc(db_session).approve(dept.org, dept.officer, request.id)
        with pytest.raises(ValueError, match="already been approved"):
            await _ask(db_session, dept, request, actor=dept.deputy)

    async def test_not_while_waiting_on_a_reconfirmation(self, db_session, dept):
        request = await _submit(db_session, dept)
        request.reconfirm_requested_at = engine._now()
        await db_session.commit()
        with pytest.raises(ValueError, match="confirm the new date"):
            await _ask(db_session, dept, request)

    @pytest.mark.parametrize("question", ["", "   "])
    async def test_the_question_is_required(self, db_session, dept, question):
        request = await _submit(db_session, dept)
        with pytest.raises(ValueError, match="Write the question"):
            await _ask(db_session, dept, request, question=question)

    async def test_the_question_has_a_length_limit(self, db_session, dept):
        request = await _submit(db_session, dept)
        with pytest.raises(ValueError, match=str(MAX_TEXT_LENGTH)):
            await _ask(db_session, dept, request, question="x" * (MAX_TEXT_LENGTH + 1))


# ---------------------------------------------------------------------------
# Answering
# ---------------------------------------------------------------------------


class TestAnswering:
    async def test_answering_closes_the_question_and_prompts_the_deciders(
        self, db_session, dept, outbox
    ):
        request = await _submit(db_session, dept)
        await _ask(db_session, dept, request)
        outbox.clear()
        answered = await _svc(db_session).respond(
            dept.org, dept.member, request.id, ANSWER
        )
        assert answered.status == AttendanceWaiverStatus.PENDING
        assert answered.info_requested_at is None
        entry = (await _log(db_session, request))[-1]
        assert entry.action == AttendanceWaiverAction.MEMBER_RESPONDED
        assert entry.actor_id == str(dept.member.id)
        assert entry.note == ANSWER

        prompts = await _bell(db_session, REVIEW_PROMPT_CATEGORY, dept.officer.id)
        fresh = [p for p in prompts if p.expires_at is None]
        (prompt,) = fresh
        assert "Member Member answered your question" in prompt.message
        assert "Hollis" not in prompt.message
        assert prompt.action_url == f"/attendance-waivers/{request.id}"

        (mail,) = outbox
        assert sorted(mail.to_emails) == sorted([dept.officer.email, dept.deputy.email])
        assert "answered your question" in mail.text_body
        assert "Hollis" not in mail.text_body
        assert "Hollis" not in mail.html_body

    async def test_only_the_member_may_answer(self, db_session, dept):
        request = await _submit(db_session, dept)
        await _ask(db_session, dept, request)
        with pytest.raises(PermissionError):
            await _svc(db_session).respond(dept.org, dept.officer, request.id, ANSWER)
        with pytest.raises(AttendanceWaiverNotFound):
            await _svc(db_session).respond(dept.org, dept.stranger, request.id, ANSWER)

    async def test_there_must_be_an_open_question(self, db_session, dept):
        request = await _submit(db_session, dept)
        with pytest.raises(ValueError, match="no question"):
            await _svc(db_session).respond(dept.org, dept.member, request.id, ANSWER)

    async def test_the_answer_is_required(self, db_session, dept):
        request = await _submit(db_session, dept)
        await _ask(db_session, dept, request)
        with pytest.raises(ValueError, match="Write your answer"):
            await _svc(db_session).respond(dept.org, dept.member, request.id, "  ")

    async def test_any_number_of_rounds(self, db_session, dept):
        request = await _submit(db_session, dept)
        for round_ in range(3):
            await _ask(db_session, dept, request, question=f"Question {round_}")
            await _svc(db_session).respond(
                dept.org, dept.member, request.id, f"Answer {round_}"
            )
        conversation = [
            (a.action, a.note)
            for a in await _log(db_session, request)
            if a.action
            in (
                AttendanceWaiverAction.INFO_REQUESTED,
                AttendanceWaiverAction.MEMBER_RESPONDED,
            )
        ]
        assert [note for _, note in conversation] == [
            "Question 0",
            "Answer 0",
            "Question 1",
            "Answer 1",
            "Question 2",
            "Answer 2",
        ]


# ---------------------------------------------------------------------------
# The other actions close an open question
# ---------------------------------------------------------------------------


class TestOtherActions:
    async def test_a_decider_may_still_decide_and_that_closes_it(
        self, db_session, dept
    ):
        request = await _submit(db_session, dept)
        await _ask(db_session, dept, request)
        denied = await _svc(db_session).deny(
            dept.org, dept.deputy, request.id, "Not enough notice"
        )
        assert denied.status == AttendanceWaiverStatus.DENIED
        assert denied.info_requested_at is None
        with pytest.raises(ValueError, match="already been denied"):
            await _svc(db_session).respond(dept.org, dept.member, request.id, ANSWER)

    async def test_withdrawing_closes_it(self, db_session, dept):
        request = await _submit(db_session, dept)
        await _ask(db_session, dept, request)
        withdrawn = await _svc(db_session).withdraw(dept.org, dept.member, request.id)
        assert withdrawn.info_requested_at is None

    async def test_voiding_closes_it(self, db_session, dept):
        request = await _submit(db_session, dept)
        await _ask(db_session, dept, request)
        await void_pending_for_events(db_session, dept.org, [dept.drill], "cancelled")
        await db_session.commit()
        await db_session.refresh(request)
        assert request.status == AttendanceWaiverStatus.VOIDED
        assert request.info_requested_at is None


# ---------------------------------------------------------------------------
# What the screens are told
# ---------------------------------------------------------------------------


class TestFlags:
    async def test_a_decider_may_ask_until_a_question_is_open(self, db_session, dept):
        request = await _submit(db_session, dept)
        before = await _body(db_session, dept, dept.officer, request)
        assert before["can_request_info"] is True
        assert before["info_requested_at"] is None
        await _ask(db_session, dept, request)
        after = await _body(db_session, dept, dept.officer, request)
        assert after["can_request_info"] is False
        assert after["can_decide"] is True
        assert after["info_requested_at"] is not None
        assert after["can_respond"] is False

    async def test_the_member_may_answer_only_an_open_question(self, db_session, dept):
        request = await _submit(db_session, dept)
        before = await _body(db_session, dept, dept.member, request)
        assert before["can_respond"] is False
        assert before["can_request_info"] is False
        await _ask(db_session, dept, request)
        after = await _body(db_session, dept, dept.member, request)
        assert after["can_respond"] is True
        assert after["actions"][-1]["note"] == QUESTION

    async def test_nobody_may_ask_or_answer_once_decided(self, db_session, dept):
        request = await _submit(db_session, dept)
        await _svc(db_session).approve(dept.org, dept.officer, request.id)
        for viewer in (dept.officer, dept.deputy, dept.member):
            body = await _body(db_session, dept, viewer, request)
            assert body["can_request_info"] is False
            assert body["can_respond"] is False


# ---------------------------------------------------------------------------
# Over HTTP, both routers
# ---------------------------------------------------------------------------


_CURRENT: dict = {}
_APP = FastAPI()
_APP.include_router(api_router, prefix="/api/v1")
_APP.dependency_overrides[get_current_user] = lambda: _CURRENT["user"]
_APP.dependency_overrides[get_db] = lambda: _CURRENT["db"]
_APP.dependency_overrides[verify_csrf_token] = lambda: None
_APP.dependency_overrides[get_request_enabled_modules] = lambda: None


@pytest.fixture
def as_user(db_session):
    _CURRENT["db"] = db_session

    def client(user) -> AsyncClient:
        _CURRENT["user"] = user
        return AsyncClient(transport=ASGITransport(app=_APP), base_url="http://test")

    yield client
    _CURRENT.clear()


class TestTrainingRoutes:
    async def test_ask_answer_and_read_from_the_members_list(
        self, as_user, db_session, dept
    ):
        request = await _submit(db_session, dept)
        path = f"{TRAINING}/{request.id}"
        async with as_user(dept.officer) as client:
            asked = await client.post(f"{path}/request-info", json={"note": QUESTION})
            again = await client.post(f"{path}/request-info", json={"note": "More?"})
        assert asked.status_code == 200, asked.text
        assert asked.json()["status"] == "pending"
        assert asked.json()["info_requested_at"] is not None
        assert again.status_code == 400
        assert "already waiting" in again.json()["detail"]

        async with as_user(dept.member) as client:
            mine = await client.get(f"{TRAINING}/mine")
            refused = await client.post(
                f"{path}/request-info", json={"note": "Can I ask?"}
            )
            answered = await client.post(f"{path}/respond", json={"note": ANSWER})
        (listed,) = mine.json()
        assert listed["can_respond"] is True
        assert listed["actions"][-1]["action"] == "info_requested"
        assert listed["actions"][-1]["note"] == QUESTION
        assert refused.status_code == 403
        assert answered.status_code == 200, answered.text
        assert answered.json()["info_requested_at"] is None
        assert answered.json()["actions"][-1]["action"] == "member_responded"

    async def test_the_answer_route_refusals(self, as_user, db_session, dept):
        request = await _submit(db_session, dept)
        path = f"{TRAINING}/{request.id}/respond"
        async with as_user(dept.member) as client:
            nothing_open = await client.post(path, json={"note": ANSWER})
            missing = await client.post(path, json={})
        async with as_user(dept.stranger) as client:
            hidden = await client.post(path, json={"note": ANSWER})
        assert nothing_open.status_code == 400
        assert missing.status_code == 422
        assert hidden.status_code == 404


class TestMeetingRoutes:
    async def test_ask_and_answer_a_meeting_request(self, as_user, db_session):
        org_id = await make_org(db_session)
        secretary_pos = await make_position(
            db_session, org_id, "Secretary", slug="secretary"
        )
        member_id = await make_member(db_session, org_id, "Member")
        secretary_id = await make_member(db_session, org_id, "Secretary")
        await assign(db_session, secretary_id, secretary_pos)
        await set_meeting_policy(db_session, org_id)
        meeting = await make_meeting_event(db_session, org_id, utc(2026, 11, 21))
        member = await load(db_session, member_id)
        secretary = await load(db_session, secretary_id)
        request = await AttendanceWaiverService(
            db_session, AttendanceWaiverWorkflow.BUSINESS_MEETING
        ).submit(org_id, member, meeting, None, "Working late")

        path = f"{MEETINGS}/{request.id}"
        async with as_user(secretary) as client:
            asked = await client.post(f"{path}/request-info", json={"note": QUESTION})
        async with as_user(member) as client:
            mine = await client.get(f"{MEETINGS}/mine")
            answered = await client.post(f"{path}/respond", json={"note": ANSWER})
        assert asked.status_code == 200, asked.text
        assert asked.json()["can_request_info"] is False
        assert mine.json()[0]["can_respond"] is True
        assert answered.status_code == 200, answered.text
        assert answered.json()["info_requested_at"] is None
        (notice,) = await _bell(db_session, MEMBER_UPDATE_CATEGORY, member_id)
        assert notice.action_url == f"/events/{meeting}"

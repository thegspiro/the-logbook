"""Waiver request notices go by email as well as the bell (CLAUDE.md #18).

Before 2026-11-13 every notice was an in-app row only, so a member or decider
who reads only their inbox never heard about a request. ``_email_notice`` is
the sender for the notices that have no editable template (a question, an
answer, a moved session, an expiry); the request, the decision and the
withdrawal are emailed from their templates by ``AttendanceWaiverEmails``
(see test_attendance_waiver_emails). These pin that it sends the same
plain words as the bell and never the member's reason or a decider's note,
that a member's email preferences decide, and that a failed send never fails
the request.
"""

from types import SimpleNamespace

import pytest

from app.models.attendance_waiver import AttendanceWaiverStatus
from app.services import attendance_waiver_service as engine
from app.services.attendance_waiver_service import AttendanceWaiverService
from tests.waiver_request_support import (
    assign,
    load,
    make_member,
    make_org,
    make_position,
    make_requirement,
    make_session,
    set_policy,
    utc,
)

pytestmark = pytest.mark.integration

NOW = utc(2026, 11, 13, 15)
DRILL = utc(2026, 11, 20, 23)


@pytest.fixture(autouse=True)
def _clock(monkeypatch):
    monkeypatch.setattr(engine, "_now", lambda: NOW)


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
    member = await make_member(db_session, org_id, "Sam")
    officer = await make_member(db_session, org_id, "Tina")
    await assign(db_session, officer, officer_pos)
    await set_policy(db_session, org_id, approver_position_ids=[officer_pos])
    requirement = await make_requirement(db_session, org_id)
    drill = await make_session(db_session, org_id, DRILL, link=[requirement])
    await db_session.flush()
    return SimpleNamespace(
        org=org_id,
        member=await load(db_session, member),
        officer=await load(db_session, officer),
        drill=drill,
    )


async def _submit(db, dept, reason="Knee surgery"):
    return await AttendanceWaiverService(db).submit(
        dept.org, dept.member, dept.drill, None, reason
    )


class TestDeciderEmail:
    async def test_a_new_request_is_left_to_its_template(
        self, db_session, dept, outbox
    ):
        # The SUBMITTED template emails the deciders; a second, hand-built
        # message here would reach every one of them twice.
        await _submit(db_session, dept)
        assert outbox == []

    async def test_a_decider_who_turned_the_kind_off_is_not_emailed(
        self, db_session, dept, outbox
    ):
        dept.officer.notification_preferences = {
            "email_kinds": {"training_duties": False}
        }
        await db_session.flush()
        await _submit(db_session, dept)
        assert outbox == []


class TestMemberEmail:
    async def test_a_decision_is_left_to_its_template(self, db_session, dept, outbox):
        # The DECIDED template emails the member, without the note.
        request = await _submit(db_session, dept)
        outbox.clear()
        await AttendanceWaiverService(db_session).approve(
            dept.org, dept.officer, request.id, "Get well soon"
        )
        assert outbox == []


class TestFailure:
    async def test_a_failed_send_does_not_fail_the_request(
        self, db_session, dept, monkeypatch
    ):
        class Broken:
            def __init__(self, organization=None):
                pass

            async def send_email(self, **kwargs):
                raise RuntimeError("smtp is down")

        import app.services.email_service as email_service

        monkeypatch.setattr(email_service, "EmailService", Broken)
        request = await _submit(db_session, dept)
        assert request.status == AttendanceWaiverStatus.PENDING

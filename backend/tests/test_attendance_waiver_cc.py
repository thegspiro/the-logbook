"""CC positions on waiver decisions (owner decision, 2026-11-13).

The policy's ``cc_position_ids`` name positions whose holders are told the
outcome of every final decision: approved, not approved, or approved by the
Chief on review. They are informed only, so the notice carries who, which
session, when and the outcome, and never the member's reason, category or the
decider's note, and it leads to the session rather than the request they
cannot open. A withdrawal, a void or an expiry is not a decision and is not
copied. Saving the policy checks every CC position is in the department, as
it does the approver positions.
"""

from types import SimpleNamespace

import pytest
from sqlalchemy import select, text

from app.models.attendance_waiver import (
    AttendanceWaiverRequest,
    AttendanceWaiverWorkflow,
)
from app.models.notification import NotificationLog
from app.schemas.attendance_waiver import AttendanceWaiverPolicy
from app.services import attendance_waiver_service as engine
from app.services.attendance_waiver_service import (
    CC_NOTICE_CATEGORY,
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
REASON = "Knee surgery"
NOTE = "Get well soon"
CATEGORY = "Medical"


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
    """A department whose policy copies decisions to Captain and Lieutenant.

    Lena holds both copied positions (one notice, not two). The officer who
    decides also holds Captain, and so does the member asking: neither is
    copied on their own decision or request.
    """
    org_id = await make_org(db_session)
    officer_pos = await make_position(db_session, org_id, "Training Officer")
    chief_pos = await make_position(db_session, org_id, "Chief", slug="fire_chief")
    captain_pos = await make_position(db_session, org_id, "Captain")
    lieutenant_pos = await make_position(db_session, org_id, "Lieutenant")
    member = await make_member(db_session, org_id, "Sam")
    officer = await make_member(db_session, org_id, "Tina")
    chief = await make_member(db_session, org_id, "Cal")
    lena = await make_member(db_session, org_id, "Lena")
    carl = await make_member(db_session, org_id, "Carl")
    await assign(db_session, officer, officer_pos)
    await assign(db_session, officer, captain_pos)
    await assign(db_session, chief, chief_pos)
    await assign(db_session, member, captain_pos)
    await assign(db_session, lena, captain_pos)
    await assign(db_session, lena, lieutenant_pos)
    await assign(db_session, carl, lieutenant_pos)
    await set_policy(
        db_session,
        org_id,
        approver_position_ids=[officer_pos],
        cc_position_ids=[captain_pos, lieutenant_pos],
        categories=[CATEGORY],
    )
    requirement = await make_requirement(db_session, org_id)
    drill = await make_session(db_session, org_id, DRILL, link=[requirement])
    await db_session.flush()
    return SimpleNamespace(
        org=org_id,
        member=await load(db_session, member),
        officer=await load(db_session, officer),
        chief=await load(db_session, chief),
        lena=await load(db_session, lena),
        carl=await load(db_session, carl),
        captain_pos=captain_pos,
        lieutenant_pos=lieutenant_pos,
        drill=drill,
    )


def _svc(db, workflow=AttendanceWaiverWorkflow.TRAINING_SESSION):
    return AttendanceWaiverService(db, workflow)


async def _submit(db, dept):
    return await _svc(db).submit(dept.org, dept.member, dept.drill, CATEGORY, REASON)


async def _copies(db, org_id):
    return list(
        (
            await db.execute(
                select(NotificationLog).where(
                    NotificationLog.organization_id == org_id,
                    NotificationLog.category == CC_NOTICE_CATEGORY,
                )
            )
        )
        .scalars()
        .all()
    )


def _assert_private(*texts):
    for value in texts:
        for secret in (REASON, NOTE, CATEGORY, "Knee", "Get well"):
            assert secret not in (value or "")


class TestWhoIsCopied:
    async def test_an_approval_copies_each_holder_once(self, db_session, dept, outbox):
        request = await _submit(db_session, dept)
        outbox.clear()
        await _svc(db_session).approve(dept.org, dept.officer, request.id, NOTE)

        copies = await _copies(db_session, dept.org)
        assert sorted(c.recipient_id for c in copies) == sorted(
            [str(dept.lena.id), str(dept.carl.id)]
        )
        for copy in copies:
            assert copy.action_url == f"/events/{dept.drill}"
            assert copy.message == (
                'Sam Member\'s request to be excused from "Company Drill" on '
                "November 20, 2026 was approved."
            )
            assert copy.notification_metadata["waiver_request_id"] == str(request.id)
            _assert_private(copy.subject, copy.message)

        cc_mail = [m for m in outbox if str(dept.lena.email) in m.to_emails]
        (mail,) = cc_mail
        assert sorted(mail.to_emails) == sorted([dept.lena.email, dept.carl.email])
        assert f"/events/{dept.drill}" in mail.text_body
        assert "/attendance-waivers/" not in mail.text_body
        assert "/attendance-waivers/" not in mail.html_body
        _assert_private(mail.subject, mail.text_body, mail.html_body)

    async def test_neither_the_member_nor_the_decider_is_copied(
        self, db_session, dept, outbox
    ):
        request = await _submit(db_session, dept)
        await _svc(db_session).deny(dept.org, dept.officer, request.id, NOTE)
        recipients = {c.recipient_id for c in await _copies(db_session, dept.org)}
        # Both hold Captain, which is copied; only the other holders hear.
        assert recipients == {str(dept.lena.id), str(dept.carl.id)}

    async def test_an_inactive_holder_is_not_copied(self, db_session, dept, outbox):
        await db_session.execute(
            text("UPDATE users SET status = 'retired' WHERE id = :id"),
            {"id": str(dept.carl.id)},
        )
        request = await _submit(db_session, dept)
        await _svc(db_session).approve(dept.org, dept.officer, request.id)
        recipients = {c.recipient_id for c in await _copies(db_session, dept.org)}
        assert recipients == {str(dept.lena.id)}

    async def test_no_cc_positions_copies_nobody(self, db_session, dept, outbox):
        await set_policy(
            db_session,
            dept.org,
            approver_position_ids=[],
            categories=[CATEGORY],
        )
        request = await _submit(db_session, dept)
        await _svc(db_session).approve(dept.org, dept.chief, request.id)
        assert await _copies(db_session, dept.org) == []

    async def test_the_email_follows_the_decider_kind(self, db_session, dept, outbox):
        dept.lena.notification_preferences = {"email_kinds": {"training_duties": False}}
        await db_session.flush()
        request = await _submit(db_session, dept)
        outbox.clear()
        await _svc(db_session).approve(dept.org, dept.officer, request.id)
        cc_mail = [m for m in outbox if str(dept.carl.email) in m.to_emails]
        (mail,) = cc_mail
        assert mail.to_emails == [dept.carl.email]
        # The bell still rings for Lena: the preference governs email only.
        recipients = {c.recipient_id for c in await _copies(db_session, dept.org)}
        assert str(dept.lena.id) in recipients


class TestOutcomes:
    async def test_a_denial_says_not_approved(self, db_session, dept, outbox):
        request = await _submit(db_session, dept)
        await _svc(db_session).deny(dept.org, dept.officer, request.id, NOTE)
        copies = await _copies(db_session, dept.org)
        assert copies
        for copy in copies:
            assert copy.message.endswith("was not approved.")
            assert copy.subject.startswith("Waiver request not approved")
            _assert_private(copy.subject, copy.message)

    async def test_a_chief_override_is_copied_again_as_approved(
        self, db_session, dept, outbox
    ):
        request = await _submit(db_session, dept)
        await _svc(db_session).deny(dept.org, dept.officer, request.id, NOTE)
        await _svc(db_session).chief_override(
            dept.org, dept.chief, request.id, "Family emergency"
        )
        messages = [c.message for c in await _copies(db_session, dept.org)]
        overrides = [m for m in messages if "by the Chief on review" in m]
        # Lena and Carl, and now the officer too: the Chief decided this time.
        assert len(overrides) == 3
        _assert_private(*messages)
        assert not any("Family" in m for m in messages)

    async def test_a_session_since_deleted_gets_no_link(self, db_session, dept, outbox):
        request = await _submit(db_session, dept)
        await _svc(db_session).deny(dept.org, dept.officer, request.id)
        # The row outlives the event (SET NULL), as a deletion leaves it.
        await db_session.execute(
            text(
                "UPDATE attendance_waiver_requests SET event_id = NULL WHERE id = :id"
            ),
            {"id": str(request.id)},
        )
        outbox.clear()
        await _svc(db_session).chief_override(
            dept.org, dept.chief, request.id, "Family emergency"
        )
        overrides = [
            c
            for c in await _copies(db_session, dept.org)
            if "by the Chief on review" in c.message
        ]
        assert overrides
        assert all(c.action_url is None for c in overrides)
        cc_mail = [m for m in outbox if str(dept.lena.email) in m.to_emails]
        (mail,) = cc_mail
        assert "/events/" not in mail.text_body
        assert 'class="button"' not in mail.html_body


class TestNotDecisions:
    async def test_a_withdrawal_is_not_copied(self, db_session, dept, outbox):
        request = await _submit(db_session, dept)
        await _svc(db_session).withdraw(dept.org, dept.member, request.id)
        assert await _copies(db_session, dept.org) == []

    async def test_a_void_is_not_copied(self, db_session, dept, outbox):
        request = await _submit(db_session, dept)
        await void_pending_for_events(db_session, dept.org, [dept.drill], "cancelled")
        await db_session.flush()
        stored = (
            await db_session.execute(
                select(AttendanceWaiverRequest).where(
                    AttendanceWaiverRequest.id == str(request.id)
                )
            )
        ).scalar_one()
        assert stored.status.value == "voided"
        assert await _copies(db_session, dept.org) == []


class TestMeetingWorkflow:
    async def test_a_meeting_decision_copies_under_event_duties(
        self, db_session, dept, outbox
    ):
        secretary_pos = await make_position(db_session, dept.org, "Secretary")
        await assign(db_session, str(dept.officer.id), secretary_pos)
        await set_meeting_policy(
            db_session,
            dept.org,
            approver_position_ids=[secretary_pos],
            cc_position_ids=[dept.lieutenant_pos],
        )
        meeting = await make_meeting_event(db_session, dept.org, DRILL)
        officer = await load(db_session, str(dept.officer.id))
        # Carl turned off event-duty email: the meeting copy honours it.
        dept.carl.notification_preferences = {"email_kinds": {"event_duties": False}}
        await db_session.flush()
        svc = _svc(db_session, AttendanceWaiverWorkflow.BUSINESS_MEETING)
        request = await svc.submit(dept.org, dept.member, meeting, None, REASON)
        outbox.clear()
        await svc.approve(dept.org, officer, request.id)
        recipients = {c.recipient_id for c in await _copies(db_session, dept.org)}
        assert recipients == {str(dept.lena.id), str(dept.carl.id)}
        cc_mail = [m for m in outbox if str(dept.lena.email) in m.to_emails]
        (mail,) = cc_mail
        assert mail.to_emails == [dept.lena.email]


class TestSavingThePolicy:
    async def test_a_position_from_another_department_is_refused(
        self, db_session, dept
    ):
        other_org = await make_org(db_session)
        foreign = await make_position(db_session, other_org, "Captain")
        with pytest.raises(ValueError, match="copy-to position"):
            await _svc(db_session).save_policy(
                dept.org,
                AttendanceWaiverPolicy(enabled=True, cc_position_ids=[foreign]),
                dept.officer,
            )

    async def test_the_departments_positions_are_saved(self, db_session, dept):
        await _svc(db_session).save_policy(
            dept.org,
            AttendanceWaiverPolicy(enabled=True, cc_position_ids=[dept.captain_pos]),
            dept.officer,
        )
        stored = await _svc(db_session).get_policy(dept.org)
        assert stored.cc_position_ids == [dept.captain_pos]

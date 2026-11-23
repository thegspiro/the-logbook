"""A training notice that changes how the member is graded is always emailed.

Email is the channel of record (CLAUDE.md pitfall #18), and the decision
email is already sent under the required "Changes to your training record"
kind because it changes how the member's attendance is graded. These notices
change it just as much, so they go under the same kind and a member who
switched "Training and certification reminders" off still receives them:

  * the expiry — the session now counts as missed;
  * a moved start — an approval is cleared and, unanswered, the request
    expires as a miss;
  * a decider's question — the request now waits on the member's answer,
    and expires as a miss without one.

A void stays under the optional kind: the session was cancelled or deleted,
so nothing is graded and the cap slot is freed. That is pinned here too, so
moving it is a visible decision.
"""

from datetime import timedelta
from types import SimpleNamespace

import pytest

from app.schemas.event import EventUpdate
from app.services import attendance_waiver_service as engine
from app.services.attendance_waiver_expiry import AttendanceWaiverExpiry
from app.services.attendance_waiver_service import (
    MEETING_SPEC,
    TRAINING_SPEC,
    AttendanceWaiverService,
    send_member_notices,
    void_pending_for_events,
)
from app.services.email_policy import EMAIL_POLICIES, EmailKind
from app.services.event_service import EventService
from tests.waiver_request_support import (
    assign,
    load,
    make_member,
    make_org,
    make_position,
    make_requirement,
    make_meeting_event,
    make_session,
    set_meeting_policy,
    set_policy,
    utc,
)

NOW = utc(2029, 12, 1, 15)
# 18:00 in New York on 10 January 2030: in the future by the real clock, which
# the event service reads when a start is moved.
DRILL = utc(2030, 1, 10, 23)

OPTED_OUT = {"training_reminders": False}


@pytest.fixture(autouse=True)
def _clock(monkeypatch):
    monkeypatch.setattr(engine, "_now", lambda: NOW)


@pytest.fixture
def outbox(monkeypatch):
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
    member_row = await load(db_session, member)
    member_row.notification_preferences = dict(OPTED_OUT)
    await db_session.flush()
    return SimpleNamespace(
        org=org_id,
        member=member_row,
        officer=await load(db_session, officer),
        drill=drill,
    )


async def _submit(db, dept):
    return await AttendanceWaiverService(db).submit(
        dept.org, dept.member, dept.drill, None, "Knee surgery"
    )


def _to_member(outbox, dept):
    return [m for m in outbox if m.to_emails == [dept.member.email]]


@pytest.mark.unit
class TestTheKinds:
    def test_training_record_changes_are_the_required_kind(self):
        assert TRAINING_SPEC.member_record_email_kind == (
            EmailKind.TRAINING_RECORD_CHANGES
        )
        assert EMAIL_POLICIES[EmailKind.TRAINING_RECORD_CHANGES].required

    # Owner decision 2026-11-23: the meeting notices that lead to a charged
    # absence are required too, under the same kind. The decision and void
    # notices keep the meeting workflow's optional kind.
    def test_meeting_record_notices_are_the_required_kind(self):
        assert MEETING_SPEC.member_record_email_kind == (
            EmailKind.TRAINING_RECORD_CHANGES
        )
        assert MEETING_SPEC.member_email_kind == EmailKind.EVENT_CHANGES

    def test_the_preferences_screen_names_the_meeting_notices(self):
        includes = " ".join(
            EMAIL_POLICIES[EmailKind.TRAINING_RECORD_CHANGES].includes
        ).lower()
        assert "business meeting" in includes

    def test_the_preferences_screen_names_them(self):
        includes = " ".join(
            EMAIL_POLICIES[EmailKind.TRAINING_RECORD_CHANGES].includes
        ).lower()
        assert "closed undecided" in includes
        assert "moved" in includes
        assert "question" in includes


@pytest.mark.integration
class TestAnOptedOutMemberIsStillTold:
    async def test_the_expiry(self, db_session, dept, outbox):
        await _submit(db_session, dept)
        await db_session.commit()
        outbox.clear()

        await AttendanceWaiverExpiry(db_session).sweep(
            now=DRILL + timedelta(days=9), organization_ids=[dept.org]
        )

        (mail,) = _to_member(outbox, dept)
        assert "missed" in mail.text_body

    async def test_a_moved_start(self, db_session, dept, outbox):
        request = await _submit(db_session, dept)
        await AttendanceWaiverService(db_session).approve(
            dept.org, dept.officer, request.id
        )
        outbox.clear()

        moved = DRILL + timedelta(days=7)
        await EventService(db_session).update_event(
            dept.drill,
            dept.org,
            EventUpdate(start_datetime=moved, end_datetime=moved + timedelta(hours=2)),
        )

        (mail,) = _to_member(outbox, dept)
        assert "January 17, 2030" in mail.text_body

    async def test_a_deciders_question(self, db_session, dept, outbox):
        request = await _submit(db_session, dept)
        outbox.clear()

        await AttendanceWaiverService(db_session).request_info(
            dept.org, dept.officer, request.id, "Do you have a return date?"
        )

        assert len(_to_member(outbox, dept)) == 1


@pytest.mark.integration
class TestAVoidFollowsThePreference:
    async def test_an_opted_out_member_is_not_emailed(self, db_session, dept, outbox):
        await _submit(db_session, dept)
        outbox.clear()

        notices = await void_pending_for_events(
            db_session, dept.org, [dept.drill], "cancelled"
        )
        await db_session.commit()
        await send_member_notices(db_session, dept.org, notices)

        assert len(notices) == 1
        assert _to_member(outbox, dept) == []


@pytest.fixture
async def meeting_dept(db_session):
    org_id = await make_org(db_session)
    clerk_pos = await make_position(db_session, org_id, "Clerk")
    member = await make_member(db_session, org_id, "Sam")
    clerk = await make_member(db_session, org_id, "Cleo")
    await assign(db_session, clerk, clerk_pos)
    await set_meeting_policy(db_session, org_id, approver_position_ids=[clerk_pos])
    meeting = await make_meeting_event(db_session, org_id, DRILL)
    member_row = await load(db_session, member)
    member_row.notification_preferences = {"email_kinds": {"event_changes": False}}
    await db_session.flush()
    return SimpleNamespace(
        org=org_id,
        member=member_row,
        clerk=await load(db_session, clerk),
        meeting=meeting,
    )


@pytest.mark.integration
class TestAMeetingMemberOptedOutOfEventChangesIsStillTold:
    async def test_a_deciders_question(self, db_session, meeting_dept, outbox):
        service = AttendanceWaiverService(db_session, MEETING_SPEC.workflow)
        request = await service.submit(
            meeting_dept.org, meeting_dept.member, meeting_dept.meeting, None, "Work"
        )
        outbox.clear()

        await service.request_info(
            meeting_dept.org, meeting_dept.clerk, request.id, "Which shift?"
        )

        assert len(_to_member(outbox, meeting_dept)) == 1

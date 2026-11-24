"""A cancelled or deleted session emails the members whose requests it closed.

Until 2026-11-14 ``void_pending_for_events`` told the member only in the app,
the one waiver notice with no email (CLAUDE.md pitfall #18: email is the
channel of record). It runs inside the event's own transaction, so, like a
reschedule, it returns the emails owed and ``EventService`` sends them after
its commit. Pinned:

* cancelling a session emails the member of each pending request it closes,
  with the same words as the in-app notice and never the member's reason;
* deleting one does too, for a business meeting as for training;
* cancelling a whole series emails each member once;
* nothing is sent before the commit, so a deferred batch sends only once it
  has committed (``complete_deferred_writes``);
* an approved request is voided too, giving the waiver back: it no longer
  counts toward the cap, a meeting waiver comes off the minutes, and the
  member is emailed (owner decision 2026-11-23); a denied one is kept.
"""

from datetime import timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.models.attendance_waiver import (
    AttendanceWaiverRequest,
    AttendanceWaiverStatus,
    AttendanceWaiverWorkflow,
)
from app.models.event import Event
from app.models.meeting import MeetingAttendee
from app.services import attendance_waiver_service as engine
from app.services.attendance_waiver_service import (
    AttendanceWaiverService,
    send_member_notices,
    void_pending_for_events,
)
from app.services.event_service import EventService
from tests.waiver_request_support import (
    assign,
    load,
    make_meeting_event,
    make_member,
    make_minutes_record,
    make_org,
    make_position,
    make_requirement,
    make_session,
    set_meeting_policy,
    set_policy,
    utc,
)

pytestmark = pytest.mark.integration

NOW = utc(2029, 12, 1, 15)
DRILL = utc(2030, 1, 10, 23)
MEETINGS = AttendanceWaiverWorkflow.BUSINESS_MEETING


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
    clerk_pos = await make_position(db_session, org_id, "Clerk")
    ids = {
        name: await make_member(db_session, org_id, name.title())
        for name in ("member", "other", "officer", "clerk")
    }
    await assign(db_session, ids["officer"], officer_pos)
    await assign(db_session, ids["clerk"], clerk_pos)
    await set_policy(db_session, org_id, approver_position_ids=[officer_pos])
    await set_meeting_policy(db_session, org_id, approver_position_ids=[clerk_pos])
    requirement = await make_requirement(db_session, org_id)
    drill = await make_session(db_session, org_id, DRILL, link=[requirement])
    meeting = await make_meeting_event(db_session, org_id, DRILL)
    users = {name: await load(db_session, i) for name, i in ids.items()}
    return SimpleNamespace(org=org_id, drill=drill, meeting=meeting, **users)


async def _submit(db, dept, who=None, workflow=None, event_id=None):
    service = (
        AttendanceWaiverService(db, workflow)
        if workflow
        else AttendanceWaiverService(db)
    )
    return await service.submit(
        dept.org, who or dept.member, event_id or dept.drill, None, "Knee surgery"
    )


def _closing(outbox):
    """The closing emails, leaving out the request and decision ones."""
    return [m for m in outbox if m.subject.startswith("Waiver request closed")]


async def _attendee(db, minutes, user_id) -> MeetingAttendee:
    row: MeetingAttendee = (
        await db.execute(
            select(MeetingAttendee)
            .where(
                MeetingAttendee.meeting_id == minutes,
                MeetingAttendee.user_id == user_id,
            )
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    return row


async def _status(db, request_id):
    row = await db.get(AttendanceWaiverRequest, request_id, populate_existing=True)
    return row.status


class TestCancelling:
    async def test_the_member_is_emailed_without_their_reason(
        self, db_session, dept, outbox
    ):
        request = await _submit(db_session, dept)
        outbox.clear()
        await EventService(db_session).cancel_event(dept.drill, dept.org, "Snow")

        (mail,) = _closing(outbox)
        assert mail.to_emails == [dept.member.email]
        assert "was closed: the training session was cancelled" in mail.text_body
        assert "Knee" not in mail.text_body
        assert "Knee" not in mail.html_body
        assert await _status(db_session, request.id) == AttendanceWaiverStatus.VOIDED

    async def test_a_series_cancellation_emails_each_member_once(
        self, db_session, dept, outbox
    ):
        occurrence = await make_meeting_event(
            db_session, dept.org, DRILL + timedelta(days=28)
        )
        row = await db_session.get(Event, occurrence)
        row.recurrence_parent_id = dept.meeting
        await db_session.flush()
        await _submit(db_session, dept, workflow=MEETINGS, event_id=dept.meeting)
        await _submit(
            db_session, dept, who=dept.other, workflow=MEETINGS, event_id=occurrence
        )
        outbox.clear()
        await EventService(db_session).cancel_series(dept.meeting, dept.org, "Moved")

        assert sorted(m.to_emails[0] for m in _closing(outbox)) == sorted(
            [dept.member.email, dept.other.email]
        )

    async def test_a_deferred_batch_emails_after_its_commit(
        self, db_session, dept, outbox
    ):
        await _submit(db_session, dept)
        outbox.clear()
        service = EventService(db_session)
        await service.cancel_event(dept.drill, dept.org, "Snow", defer_commit=True)
        assert _closing(outbox) == []
        await db_session.commit()
        await service.complete_deferred_writes(dept.org)
        assert [m.to_emails for m in _closing(outbox)] == [[dept.member.email]]

    # Owner decision 2026-11-23: cancelling the event gives the waiver back.
    async def test_an_approved_request_is_voided_and_its_member_emailed(
        self, db_session, dept, outbox
    ):
        request = await _submit(db_session, dept)
        await AttendanceWaiverService(db_session).approve(
            dept.org, dept.officer, request.id, None
        )
        outbox.clear()
        await EventService(db_session).cancel_event(dept.drill, dept.org, "Snow")

        row = await db_session.get(
            AttendanceWaiverRequest, request.id, populate_existing=True
        )
        assert row.status == AttendanceWaiverStatus.VOIDED
        assert row.live_key is None
        assert row.reconfirm_requested_at is None
        (mail,) = _closing(outbox)
        assert mail.to_emails == [dept.member.email]
        assert "no longer counts toward your limit" in mail.text_body
        assert "Knee" not in mail.text_body

    async def test_a_denied_request_is_left_alone(self, db_session, dept, outbox):
        request = await _submit(db_session, dept)
        await AttendanceWaiverService(db_session).deny(
            dept.org, dept.officer, request.id, None
        )
        outbox.clear()
        await EventService(db_session).cancel_event(dept.drill, dept.org, "Snow")
        assert _closing(outbox) == []
        assert await _status(db_session, request.id) == AttendanceWaiverStatus.DENIED


class TestTheWaiverIsGivenBack:
    async def test_it_stops_counting_toward_the_cap(self, db_session, dept, outbox):
        current = await AttendanceWaiverService(db_session).get_policy(dept.org)
        await set_policy(
            db_session,
            dept.org,
            cap=1,
            approver_position_ids=current.approver_position_ids,
        )
        requirement = await make_requirement(db_session, dept.org)
        second = await make_session(
            db_session, dept.org, DRILL + timedelta(days=7), link=[requirement]
        )
        service = AttendanceWaiverService(db_session)
        request = await _submit(db_session, dept)
        await service.approve(dept.org, dept.officer, request.id, None)
        before = await service.eligibility(dept.org, dept.member, second)
        assert before.cap_remaining == 0

        await EventService(db_session).cancel_event(dept.drill, dept.org, "Snow")

        after = await service.eligibility(dept.org, dept.member, second)
        assert after.cap_remaining == 1

    async def test_a_meeting_waiver_comes_off_the_minutes(
        self, db_session, dept, outbox
    ):
        minutes = await make_minutes_record(
            db_session, dept.org, str(dept.clerk.id), event_id=dept.meeting
        )
        service = AttendanceWaiverService(db_session, MEETINGS)
        request = await service.submit(dept.org, dept.member, dept.meeting, None, None)
        await service.approve(dept.org, dept.clerk, request.id, None)
        attendee = await _attendee(db_session, minutes, str(dept.member.id))
        assert attendee.waiver_request_id == request.id

        await EventService(db_session).cancel_event(dept.meeting, dept.org, "Moved")

        attendee = await _attendee(db_session, minutes, str(dept.member.id))
        assert attendee.waiver_request_id is None
        assert attendee.excused is False
        assert await _status(db_session, request.id) == AttendanceWaiverStatus.VOIDED

    async def test_a_second_run_owes_nothing(self, db_session, dept):
        request = await _submit(db_session, dept)
        await AttendanceWaiverService(db_session).approve(
            dept.org, dept.officer, request.id, None
        )
        first = await void_pending_for_events(
            db_session, dept.org, [dept.drill], "cancelled"
        )
        again = await void_pending_for_events(
            db_session, dept.org, [dept.drill], "cancelled"
        )
        assert len(first) == 1
        assert again == []


class TestDeleting:
    async def test_deleting_a_business_meeting_emails_the_member(
        self, db_session, dept, outbox
    ):
        request = await _submit(
            db_session, dept, workflow=MEETINGS, event_id=dept.meeting
        )
        outbox.clear()
        await EventService(db_session).delete_event(dept.meeting, dept.org)

        (mail,) = _closing(outbox)
        assert mail.to_emails == [dept.member.email]
        assert "was closed: the business meeting was deleted" in mail.text_body
        assert await _status(db_session, request.id) == AttendanceWaiverStatus.VOIDED


class TestNothingBeforeTheCommit:
    async def test_the_hook_returns_the_emails_and_sends_none(
        self, db_session, dept, outbox
    ):
        request = await _submit(db_session, dept)
        outbox.clear()
        notices = await void_pending_for_events(
            db_session, dept.org, [dept.drill], "cancelled"
        )
        assert outbox == []
        (notice,) = notices
        assert notice.request_id == str(request.id)
        assert notice.subject.startswith("Waiver request closed — ")
        assert notice.sentences[0].endswith("the training session was cancelled.")

    async def test_a_second_run_owes_nothing(self, db_session, dept):
        await _submit(db_session, dept)
        await void_pending_for_events(db_session, dept.org, [dept.drill], "cancelled")
        again = await void_pending_for_events(
            db_session, dept.org, [dept.drill], "cancelled"
        )
        assert again == []


class TestSendingTwice:
    """A retried send of the same notices emails once (pitfall #36): each
    send is claimed against the log row it reports and the member, which
    the database keeps unique, as the template emails already are."""

    async def test_the_same_notices_sent_twice_email_once(
        self, db_session, dept, outbox
    ):
        await _submit(db_session, dept)
        outbox.clear()
        notices = await void_pending_for_events(
            db_session, dept.org, [dept.drill], "cancelled"
        )
        await db_session.commit()

        await send_member_notices(db_session, dept.org, notices)
        await send_member_notices(db_session, dept.org, notices)

        assert len(_closing(outbox)) == 1

    async def test_a_failed_send_is_released_for_a_retry(
        self, db_session, dept, outbox, monkeypatch
    ):
        await _submit(db_session, dept)
        outbox.clear()
        notices = await void_pending_for_events(
            db_session, dept.org, [dept.drill], "cancelled"
        )
        await db_session.commit()
        import app.services.email_service as email_service

        working = email_service.EmailService

        class DownEmailService:
            def __init__(self, organization=None):
                self.organization = organization

            async def send_email(self, **kwargs):
                return False

        monkeypatch.setattr(email_service, "EmailService", DownEmailService)
        await send_member_notices(db_session, dept.org, notices)
        monkeypatch.setattr(email_service, "EmailService", working)
        await send_member_notices(db_session, dept.org, notices)

        assert len(_closing(outbox)) == 1

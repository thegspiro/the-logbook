"""A waiver request nobody decides closes seven days after the session.

Owner decision, 2026-11-13. ``expires_at_for`` is the one definition of when,
read by the sweep and by every response's ``expires_at``; the sweep is the
scheduled task's body. These pin the instant (the department's calendar, and
never before the latest submission deadline), what expiring does to the row,
the member and the deciders, that a second run changes nothing (pitfall #36),
and that an expired request is an absence everywhere it is read.
"""

from datetime import date, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select, text

from app.models.attendance_waiver import (
    AttendanceWaiverAction,
    AttendanceWaiverRequest,
    AttendanceWaiverRequestAction,
    AttendanceWaiverStatus,
    AttendanceWaiverWorkflow,
)
from app.models.event import Event
from app.models.meeting import MeetingAttendee
from app.models.notification import NotificationLog
from app.schemas.attendance_waiver import AttendanceWaiverRequestResponse
from app.services import attendance_waiver_service as engine
from app.services.attendance_waiver_expiry import AttendanceWaiverExpiry
from app.services.attendance_waiver_service import (
    MEMBER_UPDATE_CATEGORY,
    REVIEW_PROMPT_CATEGORY,
    AttendanceWaiverService,
    expires_at_for,
)
from app.services.evaluation_data_service import _waiver_summary, _WaiverRow
from app.services.training_waiver_service import fetch_user_waivers
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

NEW_YORK = ZoneInfo("America/New_York")
NOW = utc(2026, 11, 13, 15)
# 18:00 on 20 November in New York; a two-hour drill.
DRILL = utc(2026, 11, 20, 23)
# The end of 27 November in New York (EST, UTC-5).
CLOSES = utc(2026, 11, 28, 5)
MEETINGS = AttendanceWaiverWorkflow.BUSINESS_MEETING


def _event(start, hours=2):
    return Event(start_datetime=start, end_datetime=start + timedelta(hours=hours))


@pytest.mark.unit
class TestTheInstant:
    def test_the_end_of_the_seventh_local_day(self):
        assert expires_at_for(date(2026, 11, 20), NEW_YORK, None) == CLOSES

    def test_an_evening_session_still_closes_at_the_calendar_day(self):
        # Ends 01:00Z on the 21st; seven days after the end is 01:00Z on the
        # 28th, earlier than the end of the 27th in New York.
        assert expires_at_for(date(2026, 11, 20), NEW_YORK, _event(DRILL)) == CLOSES

    def test_never_before_the_latest_deadline_a_department_can_choose(self):
        # A session that runs three days: a 7d_after_end request is accepted
        # until 23:00Z on 30 November, so it cannot have expired before then.
        event = _event(DRILL, hours=72)
        assert expires_at_for(date(2026, 11, 20), NEW_YORK, event) == utc(
            2026, 11, 30, 23
        )

    def test_the_department_calendar_across_a_clock_change(self):
        # 1 November 2026 ends daylight saving in New York: the 7th day after
        # 28 October is 4 November, which ends at 05:00Z, not 04:00Z.
        assert expires_at_for(date(2026, 10, 28), NEW_YORK, None) == utc(2026, 11, 5, 5)

    def test_another_timezone(self):
        assert expires_at_for(
            date(2026, 11, 20), ZoneInfo("America/Los_Angeles"), None
        ) == utc(2026, 11, 28, 8)


@pytest.mark.unit
class TestTheAnnualReviewFigure:
    def test_expired_requests_are_their_own_count(self):
        rows = [
            _WaiverRow(
                id=str(i),
                session_date=date(2025, 3, i + 1),
                event_title="Drill",
                status=status,
                category=None,
                decided_by=None,
                chief_override=False,
            )
            for i, status in enumerate(
                [
                    AttendanceWaiverStatus.EXPIRED,
                    AttendanceWaiverStatus.EXPIRED,
                    AttendanceWaiverStatus.DENIED,
                ]
            )
        ]
        summary = _waiver_summary(rows)
        assert summary["expired"] == 2
        assert summary["denied"] == 1
        assert summary["approved"] == 0
        assert summary["breakdown"] == ("0 approved, 1 denied, 0 withdrawn, 2 expired")


@pytest.mark.unit
class TestTheScheduledTask:
    def test_it_is_registered_and_runs_hourly(self):
        from app.services import scheduled_tasks

        assert "attendance_waiver_expiry" in scheduled_tasks.SCHEDULE
        assert (
            scheduled_tasks.TASK_RUNNERS["attendance_waiver_expiry"]
            is scheduled_tasks.run_attendance_waiver_expiry
        )
        assert (
            scheduled_tasks.TASK_INTERVALS_SECONDS["attendance_waiver_expiry"] == 3600
        )


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


async def _sweep(db, dept, now):
    return await AttendanceWaiverExpiry(db).sweep(now=now, organization_ids=[dept.org])


async def _reload(db, request_id) -> AttendanceWaiverRequest:
    found: AttendanceWaiverRequest = (
        await db.execute(
            select(AttendanceWaiverRequest)
            .where(AttendanceWaiverRequest.id == request_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    return found


async def _notices(db, org_id, recipient, category):
    return list(
        (
            await db.execute(
                select(NotificationLog)
                .where(
                    NotificationLog.organization_id == org_id,
                    NotificationLog.recipient_id == recipient,
                    NotificationLog.category == category,
                )
                .execution_options(populate_existing=True)
            )
        )
        .scalars()
        .all()
    )


@pytest.mark.integration
class TestTheResponse:
    async def test_a_pending_request_says_when_it_closes(self, db_session, dept):
        request = await _submit(db_session, dept)
        (body,) = await AttendanceWaiverService(db_session).describe(
            dept.org, dept.member, [request]
        )
        assert body["expires_at"] == CLOSES
        assert AttendanceWaiverRequestResponse(**body).expires_at == CLOSES

    async def test_a_decided_request_does_not(self, db_session, dept):
        request = await _submit(db_session, dept)
        request = await AttendanceWaiverService(db_session).deny(
            dept.org, dept.officer, request.id, None
        )
        (body,) = await AttendanceWaiverService(db_session).describe(
            dept.org, dept.officer, [request]
        )
        assert body["expires_at"] is None


@pytest.mark.integration
class TestTheSweep:
    async def test_nothing_closes_before_the_instant(self, db_session, dept, outbox):
        request = await _submit(db_session, dept)
        result = await _sweep(db_session, dept, CLOSES - timedelta(seconds=1))
        assert result["requests_expired"] == 0
        assert (await _reload(db_session, request.id)).status == (
            AttendanceWaiverStatus.PENDING
        )

    async def test_an_undecided_request_closes(self, db_session, dept, outbox):
        request = await _submit(db_session, dept)
        # Waiting on a question and on a reconfirmation still counts as
        # undecided; both are cleared.
        request.info_requested_at = NOW
        request.reconfirm_requested_at = NOW
        await db_session.commit()
        outbox.clear()

        result = await _sweep(db_session, dept, CLOSES)

        assert result["requests_expired"] == 1
        closed = await _reload(db_session, request.id)
        assert closed.status == AttendanceWaiverStatus.EXPIRED
        assert closed.live_key is None
        assert closed.info_requested_at is None
        assert closed.reconfirm_requested_at is None
        assert closed.decided_at is None
        assert closed.decided_by is None
        actions = (
            (
                await db_session.execute(
                    select(AttendanceWaiverRequestAction).where(
                        AttendanceWaiverRequestAction.request_id == request.id,
                        AttendanceWaiverRequestAction.action
                        == AttendanceWaiverAction.EXPIRED,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert [(a.actor_id, a.note) for a in actions] == [(None, None)]

    async def test_the_member_is_told_and_the_deciders_prompt_goes(
        self, db_session, dept, outbox
    ):
        request = await _submit(db_session, dept)
        outbox.clear()
        await _sweep(db_session, dept, CLOSES)

        (notice,) = await _notices(
            db_session, dept.org, str(dept.member.id), MEMBER_UPDATE_CATEGORY
        )
        assert "not decided within seven days" in notice.message
        assert "counts as missed" in notice.message
        assert "Knee" not in notice.message + notice.subject
        (mail,) = outbox
        assert mail.to_emails == [dept.member.email]
        assert "not decided within seven days" in mail.text_body
        assert "Knee" not in mail.text_body + mail.html_body
        (prompt,) = await _notices(
            db_session, dept.org, str(dept.officer.id), REVIEW_PROMPT_CATEGORY
        )
        assert prompt.expires_at is not None
        assert prompt.read is True
        assert str(request.id) in str(prompt.notification_metadata)

    async def test_the_audit_carries_ids_only(self, db_session, dept, outbox):
        request = await _submit(db_session, dept)
        await _sweep(db_session, dept, CLOSES)
        (data,) = (
            await db_session.execute(
                text(
                    "SELECT event_data FROM audit_logs WHERE organization_id = :o "
                    "AND event_type = 'attendance_waiver_request_expired'"
                ),
                {"o": dept.org},
            )
        ).fetchall()
        assert str(request.id) in str(data[0])
        assert "Knee" not in str(data[0])

    async def test_a_second_run_changes_nothing(self, db_session, dept, outbox):
        request = await _submit(db_session, dept)
        outbox.clear()
        first = await _sweep(db_session, dept, CLOSES)
        second = await _sweep(db_session, dept, CLOSES + timedelta(hours=1))

        assert (first["requests_expired"], second["requests_expired"]) == (1, 0)
        assert len(outbox) == 1
        assert (
            len(
                await _notices(
                    db_session, dept.org, str(dept.member.id), MEMBER_UPDATE_CATEGORY
                )
            )
            == 1
        )
        count = (
            await db_session.execute(
                text(
                    "SELECT COUNT(*) FROM attendance_waiver_request_actions "
                    "WHERE request_id = :r AND action = 'expired'"
                ),
                {"r": request.id},
            )
        ).scalar_one()
        assert count == 1

    async def test_a_request_decided_after_the_list_was_read_is_left(
        self, db_session, dept, outbox
    ):
        request = await _submit(db_session, dept)
        expiry = AttendanceWaiverExpiry(db_session)
        due = await expiry._due(dept.org, NEW_YORK, CLOSES)
        assert due == [str(request.id)]
        await AttendanceWaiverService(db_session).deny(
            dept.org, dept.officer, request.id, None
        )
        assert await expiry._expire(dept.org, due[0], NEW_YORK, CLOSES) is None
        assert (await _reload(db_session, due[0])).status == (
            AttendanceWaiverStatus.DENIED
        )

    async def test_a_long_session_waits_for_its_deadline(
        self, db_session, dept, outbox
    ):
        requirement = await make_requirement(db_session, dept.org)
        camp = await make_session(
            db_session, dept.org, DRILL, link=[requirement], hours=72
        )
        request = await AttendanceWaiverService(db_session).submit(
            dept.org, dept.member, camp, None, "Away"
        )
        assert (await _sweep(db_session, dept, CLOSES))["requests_expired"] == 0
        result = await _sweep(db_session, dept, utc(2026, 11, 30, 23))
        assert result["requests_expired"] == 1
        assert (await _reload(db_session, request.id)).status == (
            AttendanceWaiverStatus.EXPIRED
        )

    async def test_only_the_named_department_is_swept(self, db_session, dept, outbox):
        request = await _submit(db_session, dept)
        other = await make_org(db_session)
        result = await AttendanceWaiverExpiry(db_session).sweep(
            now=CLOSES, organization_ids=[other]
        )
        assert result["requests_expired"] == 0
        assert (await _reload(db_session, request.id)).status == (
            AttendanceWaiverStatus.PENDING
        )


@pytest.mark.integration
class TestAnExpiredRequestIsAnAbsence:
    async def test_it_cannot_be_decided_or_withdrawn(self, db_session, dept, outbox):
        request = await _submit(db_session, dept)
        await _sweep(db_session, dept, CLOSES)
        service = AttendanceWaiverService(db_session)
        with pytest.raises(ValueError, match="not decided in time"):
            await service.approve(dept.org, dept.officer, request.id, None)
        with pytest.raises(ValueError, match="not decided in time"):
            await service.deny(dept.org, dept.officer, request.id, None)
        with pytest.raises(ValueError, match="not decided in time"):
            await service.withdraw(dept.org, dept.member, request.id)

    async def test_the_graders_do_not_excuse_it(self, db_session, dept, outbox):
        request = await _submit(db_session, dept)
        await _sweep(db_session, dept, CLOSES)
        waivers = await fetch_user_waivers(db_session, dept.org, str(dept.member.id))
        assert [w for w in waivers if w.event_id == dept.drill] == []
        assert (await _reload(db_session, request.id)).status == (
            AttendanceWaiverStatus.EXPIRED
        )

    async def test_it_lists_for_the_member_and_under_the_expired_filter(
        self, db_session, dept, outbox
    ):
        request = await _submit(db_session, dept)
        await _sweep(db_session, dept, CLOSES)
        service = AttendanceWaiverService(db_session)
        mine = await service.list_mine(dept.org, dept.member)
        assert [(r.id, r.status) for r in mine] == [
            (request.id, AttendanceWaiverStatus.EXPIRED)
        ]
        rows, total = await service.list_for_decider(
            dept.org, dept.officer, status=AttendanceWaiverStatus.EXPIRED
        )
        assert ([r.id for r in rows], total) == ([request.id], 1)
        pending, _ = await service.list_for_decider(
            dept.org, dept.officer, status=AttendanceWaiverStatus.PENDING
        )
        assert pending == []
        (body,) = await service.describe(dept.org, dept.officer, rows)
        assert body["status"] == "expired"
        assert body["can_decide"] is False
        assert body["expires_at"] is None


@pytest.mark.integration
class TestABusinessMeetingRequest:
    async def test_it_expires_and_writes_no_waiver(self, db_session, outbox):
        org_id = await make_org(db_session)
        clerk_pos = await make_position(db_session, org_id, "Clerk")
        member = await load(db_session, await make_member(db_session, org_id, "Mo"))
        clerk = await make_member(db_session, org_id, "Cy")
        await assign(db_session, clerk, clerk_pos)
        await set_meeting_policy(db_session, org_id, approver_position_ids=[clerk_pos])
        meeting = await make_meeting_event(db_session, org_id, DRILL)
        minutes = await make_minutes_record(
            db_session, org_id, clerk, event_id=meeting, day=date(2026, 11, 20)
        )
        request = await AttendanceWaiverService(db_session, MEETINGS).submit(
            org_id, member, meeting, None, None
        )
        outbox.clear()

        result = await AttendanceWaiverExpiry(db_session).sweep(
            now=CLOSES, organization_ids=[org_id]
        )

        assert result["requests_expired"] == 1
        assert (await _reload(db_session, request.id)).status == (
            AttendanceWaiverStatus.EXPIRED
        )
        attendee = (
            await db_session.execute(
                select(MeetingAttendee).where(
                    MeetingAttendee.meeting_id == minutes,
                    MeetingAttendee.user_id == str(member.id),
                )
            )
        ).scalar_one_or_none()
        assert attendee is None or not attendee.waiver_reason
        (mail,) = outbox
        assert mail.to_emails == [member.email]

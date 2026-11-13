"""A rescheduled session goes back to the member (owner decision, 2026-11-13).

When a session with live waiver requests moves to a different start, each
pending or approved request goes back to its member to confirm the new date
still needs a waiver, and once confirmed it goes back to the deciders. These
pin, against a real database:

  * every path that moves an event's start runs the hook: the single edit,
    a series edit, a postponement, and a batch edit that defers its commit;
  * a change that leaves the start alone (title, end) does nothing, and a
    second run for the same move writes nothing (CLAUDE.md pitfall #36);
  * a moved request takes the new title, start and date, goes back to
    PENDING with its decision cleared, logs RESCHEDULED naming both dates,
    archives the deciders' prompts and tells the member in-app and, after
    the commit, by email;
  * an approved meeting request's waiver comes off the minutes record,
    ``present`` left alone; a denied request is not touched;
  * no decision while the member has not confirmed; confirming re-checks the
    new date, and prompts the deciders again; withdrawing still works.
"""

from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.api.dependencies import get_current_user, get_request_enabled_modules
from app.api.v1.api import api_router
from app.core.database import get_db
from app.core.security_middleware import verify_csrf_token
from app.models.attendance_waiver import (
    AttendanceWaiverAction,
    AttendanceWaiverRequest,
    AttendanceWaiverRequestAction,
    AttendanceWaiverStatus,
    AttendanceWaiverWorkflow,
)
from app.models.event import Event, EventRSVP, RSVPStatus
from app.models.meeting import MeetingAttendee
from app.models.notification import NotificationLog
from app.models.user import MemberLeaveOfAbsence
from app.schemas.event import EventUpdate
from app.services import attendance_waiver_service as engine
from app.services.attendance_waiver_service import (
    MEMBER_UPDATE_CATEGORY,
    REVIEW_PROMPT_CATEGORY,
    AttendanceWaiverService,
    reconfirm_for_rescheduled_events,
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
    uid,
    utc,
)

pytestmark = pytest.mark.integration

NOW = utc(2029, 12, 1, 15)
# 18:00 in New York on 10 January 2030; a postponement must be in the future
# by the real clock, which the event service reads.
DRILL = utc(2030, 1, 10, 23)
MOVED = DRILL + timedelta(days=7)

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
    secretary_pos = await make_position(
        db_session, org_id, "Secretary", slug="secretary"
    )
    ids = {
        name: await make_member(db_session, org_id, name.title())
        for name in ("member", "other", "officer", "clerk", "secretary")
    }
    await assign(db_session, ids["officer"], officer_pos)
    await assign(db_session, ids["clerk"], clerk_pos)
    await assign(db_session, ids["secretary"], secretary_pos)
    await set_policy(db_session, org_id, approver_position_ids=[officer_pos])
    await set_meeting_policy(db_session, org_id, approver_position_ids=[clerk_pos])
    requirement = await make_requirement(db_session, org_id)
    drill = await make_session(db_session, org_id, DRILL, link=[requirement])
    meeting = await make_meeting_event(db_session, org_id, DRILL)
    users = {name: await load(db_session, i) for name, i in ids.items()}
    return SimpleNamespace(org=org_id, ids=ids, drill=drill, meeting=meeting, **users)


def _training(db) -> AttendanceWaiverService:
    return AttendanceWaiverService(db)


def _meetings(db) -> AttendanceWaiverService:
    return AttendanceWaiverService(db, MEETINGS)


async def _row(db, request_id) -> AttendanceWaiverRequest:
    row: AttendanceWaiverRequest = await db.get(
        AttendanceWaiverRequest, request_id, populate_existing=True
    )
    return row


async def _actions(db, request_id):
    rows = await db.execute(
        select(AttendanceWaiverRequestAction).where(
            AttendanceWaiverRequestAction.request_id == request_id
        )
    )
    return list(rows.scalars().all())


async def _notices(db, request_id, category):
    rows = await db.execute(
        select(NotificationLog).where(
            NotificationLog.category == category,
            NotificationLog.notification_metadata["waiver_request_id"].as_string()
            == request_id,
        )
    )
    return list(rows.scalars().all())


async def _move(db, dept, event_id, start=MOVED, **fields):
    return await EventService(db).update_event(
        event_id,
        dept.org,
        EventUpdate(
            start_datetime=start, end_datetime=start + timedelta(hours=2), **fields
        ),
    )


async def _submit(db, dept, who=None):
    return await _training(db).submit(
        dept.org, who or dept.member, dept.drill, None, "Knee surgery"
    )


class TestTheMove:
    async def test_a_pending_request_goes_back_to_the_member(
        self, db_session, dept, outbox
    ):
        request = await _submit(db_session, dept)
        outbox.clear()
        await _move(db_session, dept, dept.drill, title="Moved Drill")

        row = await _row(db_session, request.id)
        assert row.status == AttendanceWaiverStatus.PENDING
        assert row.reconfirm_requested_at is not None
        assert row.session_date == date(2030, 1, 17)
        assert engine._utc(row.event_start_snapshot) == MOVED
        assert row.event_title_snapshot == "Moved Drill"
        (logged,) = [
            a
            for a in await _actions(db_session, request.id)
            if a.action == AttendanceWaiverAction.RESCHEDULED
        ]
        assert logged.actor_id is None
        assert "January 10, 2030 at 6:00 PM" in logged.note
        assert "January 17, 2030 at 6:00 PM" in logged.note

        (notice,) = await _notices(db_session, request.id, MEMBER_UPDATE_CATEGORY)
        assert notice.recipient_id == dept.ids["member"]
        assert "January 17, 2030" in notice.message
        assert "Knee" not in notice.message
        prompts = await _notices(db_session, request.id, REVIEW_PROMPT_CATEGORY)
        assert prompts
        assert all(p.read for p in prompts)

        (mail,) = outbox
        assert mail.to_emails == [dept.member.email]
        assert "January 17, 2030" in mail.text_body
        assert "Knee" not in mail.text_body

    async def test_an_approved_request_loses_its_decision(self, db_session, dept):
        request = await _submit(db_session, dept)
        await _training(db_session).approve(dept.org, dept.officer, request.id)
        await _move(db_session, dept, dept.drill)

        row = await _row(db_session, request.id)
        assert row.status == AttendanceWaiverStatus.PENDING
        assert row.decided_at is None
        assert row.decided_by is None
        assert row.reconfirm_requested_at is not None
        # The log keeps the approval beside the move.
        kinds = [a.action for a in await _actions(db_session, request.id)]
        assert AttendanceWaiverAction.APPROVED in kinds
        assert AttendanceWaiverAction.RESCHEDULED in kinds

    async def test_a_denied_request_is_left_alone(self, db_session, dept):
        request = await _submit(db_session, dept)
        await _training(db_session).deny(dept.org, dept.officer, request.id)
        await _move(db_session, dept, dept.drill)

        row = await _row(db_session, request.id)
        assert row.status == AttendanceWaiverStatus.DENIED
        assert row.reconfirm_requested_at is None
        assert row.session_date == date(2030, 1, 10)
        kinds = [a.action for a in await _actions(db_session, request.id)]
        assert AttendanceWaiverAction.RESCHEDULED not in kinds

    async def test_a_title_only_edit_does_nothing(self, db_session, dept, outbox):
        request = await _submit(db_session, dept)
        outbox.clear()
        await EventService(db_session).update_event(
            dept.drill, dept.org, EventUpdate(title="Renamed Drill")
        )
        row = await _row(db_session, request.id)
        assert row.reconfirm_requested_at is None
        assert row.event_title_snapshot == "Company Drill"
        assert await _notices(db_session, request.id, MEMBER_UPDATE_CATEGORY) == []
        assert outbox == []

    async def test_the_start_resent_unchanged_does_nothing(self, db_session, dept):
        # The edit form resends the times with every save; only the end moves.
        request = await _submit(db_session, dept)
        await EventService(db_session).update_event(
            dept.drill,
            dept.org,
            EventUpdate(start_datetime=DRILL, end_datetime=DRILL + timedelta(hours=3)),
        )
        row = await _row(db_session, request.id)
        assert row.reconfirm_requested_at is None

    async def test_a_second_run_writes_nothing(self, db_session, dept):
        request = await _submit(db_session, dept)
        await _move(db_session, dept, dept.drill)
        again = await reconfirm_for_rescheduled_events(
            db_session, dept.org, [dept.drill]
        )
        assert again == []
        kinds = [a.action for a in await _actions(db_session, request.id)]
        assert kinds.count(AttendanceWaiverAction.RESCHEDULED) == 1

    async def test_no_decision_while_waiting(self, db_session, dept):
        request = await _submit(db_session, dept)
        await _move(db_session, dept, dept.drill)
        service = _training(db_session)
        with pytest.raises(ValueError, match="not yet confirmed"):
            await service.approve(dept.org, dept.officer, request.id)
        with pytest.raises(ValueError, match="not yet confirmed"):
            await service.deny(dept.org, dept.officer, request.id)

        row = await _row(db_session, request.id)
        (decider_view,) = await service.describe(dept.org, dept.officer, [row])
        assert decider_view["can_decide"] is False
        assert decider_view["can_confirm"] is False
        assert decider_view["reconfirm_requested_at"] is not None
        (member_view,) = await service.describe(dept.org, dept.member, [row])
        assert member_view["can_confirm"] is True
        assert member_view["can_withdraw"] is True


class TestEveryPathThatMovesTheStart:
    async def test_a_series_edit(self, db_session, dept):
        request = await _submit(db_session, dept)
        await EventService(db_session).update_future_events(
            dept.drill,
            dept.org,
            EventUpdate(start_datetime=MOVED, end_datetime=MOVED + timedelta(hours=2)),
        )
        row = await _row(db_session, request.id)
        assert row.reconfirm_requested_at is not None
        assert row.session_date == date(2030, 1, 17)

    async def test_a_postponement(self, db_session, dept, outbox):
        request = await _submit(db_session, dept)
        outbox.clear()
        await EventService(db_session).postpone_event(
            dept.drill,
            dept.org,
            MOVED,
            MOVED + timedelta(hours=2),
            "Snow",
            send_notifications=False,
        )
        row = await _row(db_session, request.id)
        assert row.reconfirm_requested_at is not None
        assert [m.to_emails for m in outbox] == [[dept.member.email]]

    async def test_a_deferred_batch_emails_after_its_commit(
        self, db_session, dept, outbox
    ):
        request = await _submit(db_session, dept)
        outbox.clear()
        service = EventService(db_session)
        await service.update_event(
            dept.drill,
            dept.org,
            EventUpdate(start_datetime=MOVED, end_datetime=MOVED + timedelta(hours=2)),
            defer_commit=True,
        )
        assert outbox == []
        await db_session.commit()
        await service.complete_deferred_writes(dept.org)
        assert [m.to_emails for m in outbox] == [[dept.member.email]]
        assert (await _row(db_session, request.id)).reconfirm_requested_at


class TestConfirm:
    async def test_confirming_sends_it_back_to_the_deciders(
        self, db_session, dept, outbox
    ):
        request = await _submit(db_session, dept)
        await _move(db_session, dept, dept.drill)
        outbox.clear()
        service = _training(db_session)
        confirmed = await service.confirm(dept.org, dept.member, request.id)

        assert confirmed.reconfirm_requested_at is None
        assert confirmed.status == AttendanceWaiverStatus.PENDING
        kinds = [a.action for a in await _actions(db_session, request.id)]
        assert AttendanceWaiverAction.MEMBER_CONFIRMED in kinds
        fresh = [
            p
            for p in await _notices(db_session, request.id, REVIEW_PROMPT_CATEGORY)
            if not p.read
        ]
        assert [p.recipient_id for p in fresh] == [dept.ids["officer"]]
        assert "confirmed" in fresh[0].message
        assert "Knee" not in fresh[0].message
        (mail,) = outbox
        assert mail.to_emails == [dept.officer.email]
        assert "Knee" not in mail.text_body

        approved = await service.approve(dept.org, dept.officer, request.id)
        assert approved.status == AttendanceWaiverStatus.APPROVED

    async def test_only_while_waiting(self, db_session, dept):
        request = await _submit(db_session, dept)
        with pytest.raises(ValueError, match="not waiting"):
            await _training(db_session).confirm(dept.org, dept.member, request.id)

    async def test_only_the_member(self, db_session, dept):
        request = await _submit(db_session, dept)
        await _move(db_session, dept, dept.drill)
        with pytest.raises(PermissionError):
            await _training(db_session).confirm(dept.org, dept.officer, request.id)
        with pytest.raises(engine.AttendanceWaiverNotFound):
            await _training(db_session).confirm(dept.org, dept.other, request.id)

    async def test_a_check_in_at_the_new_time_refuses(self, db_session, dept):
        request = await _submit(db_session, dept)
        await _move(db_session, dept, dept.drill)
        db_session.add(
            EventRSVP(
                id=uid(),
                organization_id=dept.org,
                event_id=dept.drill,
                user_id=dept.ids["member"],
                status=RSVPStatus.GOING,
                checked_in=True,
            )
        )
        await db_session.flush()
        with pytest.raises(ValueError, match="checked in.*Withdraw"):
            await _training(db_session).confirm(dept.org, dept.member, request.id)
        assert (await _row(db_session, request.id)).reconfirm_requested_at

    async def test_withdrawing_declines_it(self, db_session, dept):
        request = await _submit(db_session, dept)
        await _move(db_session, dept, dept.drill)
        withdrawn = await _training(db_session).withdraw(
            dept.org, dept.member, request.id
        )
        assert withdrawn.status == AttendanceWaiverStatus.WITHDRAWN
        assert withdrawn.reconfirm_requested_at is None
        assert withdrawn.live_key is None


class TestMeetings:
    async def _approved(self, db, dept):
        minutes = await make_minutes_record(
            db, dept.org, dept.ids["secretary"], event_id=dept.meeting
        )
        request = await _meetings(db).submit(
            dept.org, dept.member, dept.meeting, None, None
        )
        await _meetings(db).approve(dept.org, dept.clerk, request.id)
        return minutes, request

    async def _attendee(self, db, minutes, user_id) -> MeetingAttendee:
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

    async def test_the_waiver_comes_off_the_minutes_record(self, db_session, dept):
        minutes, request = await self._approved(db_session, dept)
        attendee = await self._attendee(db_session, minutes, dept.ids["member"])
        assert attendee.waiver_request_id == request.id
        attendee.present = True
        await db_session.flush()

        await _move(db_session, dept, dept.meeting)

        attendee = await self._attendee(db_session, minutes, dept.ids["member"])
        assert attendee.waiver_reason is None
        assert attendee.waiver_request_id is None
        assert attendee.waiver_granted_by is None
        assert attendee.waiver_granted_at is None
        assert attendee.excused is False
        assert attendee.present is True
        row = await _row(db_session, request.id)
        assert row.status == AttendanceWaiverStatus.PENDING
        assert row.reconfirm_requested_at is not None

    async def test_the_secretarys_own_waiver_stays(self, db_session, dept):
        minutes, _ = await self._approved(db_session, dept)
        db_session.add(
            MeetingAttendee(
                organization_id=dept.org,
                meeting_id=minutes,
                user_id=dept.ids["other"],
                present=False,
                excused=True,
                waiver_reason="Out of state",
                waiver_granted_by=dept.ids["secretary"],
            )
        )
        await db_session.flush()
        await _move(db_session, dept, dept.meeting)
        theirs = await self._attendee(db_session, minutes, dept.ids["other"])
        assert theirs.waiver_reason == "Out of state"
        assert theirs.excused is True

    async def test_a_leave_covering_the_new_date_refuses(self, db_session, dept):
        _, request = await self._approved(db_session, dept)
        await _move(db_session, dept, dept.meeting)
        db_session.add(
            MemberLeaveOfAbsence(
                id=uid(),
                organization_id=dept.org,
                user_id=dept.ids["member"],
                start_date=date(2030, 1, 15),
                end_date=date(2030, 1, 31),
                active=True,
            )
        )
        await db_session.flush()
        with pytest.raises(ValueError, match="leave of absence"):
            await _meetings(db_session).confirm(dept.org, dept.member, request.id)

    async def test_another_department_is_untouched(self, db_session, dept):
        _, request = await self._approved(db_session, dept)
        event = await db_session.get(Event, dept.meeting)
        assert event is not None
        event.start_datetime = MOVED
        event.end_datetime = MOVED + timedelta(hours=2)
        await db_session.flush()
        other_org = await make_org(db_session)
        assert (
            await reconfirm_for_rescheduled_events(
                db_session, other_org, [dept.meeting]
            )
            == []
        )
        assert (await _row(db_session, request.id)).status == (
            AttendanceWaiverStatus.APPROVED
        )
        notices = await reconfirm_for_rescheduled_events(
            db_session, dept.org, [dept.meeting]
        )
        assert [n.request_id for n in notices] == [request.id]


# The confirm route on both routers, over HTTP through the real API router.
# Built once: including the whole API router is the slow part.
_CURRENT: dict = {}
_APP = FastAPI()
_APP.include_router(api_router, prefix="/api/v1")
_APP.dependency_overrides[get_current_user] = lambda: _CURRENT["user"]
_APP.dependency_overrides[get_db] = lambda: _CURRENT["db"]
_APP.dependency_overrides[verify_csrf_token] = lambda: None
_APP.dependency_overrides[get_request_enabled_modules] = lambda: None


@pytest.fixture
def as_user(db_session):
    """``as_user(member)`` -> a client signed in as that member."""
    _CURRENT["db"] = db_session

    def client(user) -> AsyncClient:
        _CURRENT["user"] = user
        return AsyncClient(transport=ASGITransport(app=_APP), base_url="http://test")

    yield client
    _CURRENT.clear()


class TestTheRoutes:
    @pytest.mark.parametrize(
        ("base", "which"),
        [
            ("/api/v1/training/waivers/requests", "drill"),
            ("/api/v1/meetings/waiver-requests", "meeting"),
        ],
    )
    async def test_confirm(self, db_session, dept, as_user, base, which):
        event_id = getattr(dept, which)
        async with as_user(dept.member) as client:
            submitted = await client.post(base, json={"event_id": event_id})
        assert submitted.status_code == 201, submitted.text
        request_id = submitted.json()["id"]
        await _move(db_session, dept, event_id)

        async with as_user(dept.member) as client:
            mine = await client.get(f"{base}/mine")
        (body,) = mine.json()
        assert body["can_confirm"] is True
        assert body["reconfirm_requested_at"] is not None

        decider = dept.officer if which == "drill" else dept.clerk
        async with as_user(decider) as client:
            refused = await client.post(f"{base}/{request_id}/approve", json={})
            not_theirs = await client.post(f"{base}/{request_id}/confirm")
        assert refused.status_code == 400
        assert not_theirs.status_code == 403
        async with as_user(dept.other) as client:
            hidden = await client.post(f"{base}/{request_id}/confirm")
        assert hidden.status_code == 404

        async with as_user(dept.member) as client:
            confirmed = await client.post(f"{base}/{request_id}/confirm")
            again = await client.post(f"{base}/{request_id}/confirm")
        assert confirmed.status_code == 200, confirmed.text
        assert confirmed.json()["can_confirm"] is False
        assert confirmed.json()["reconfirm_requested_at"] is None
        assert again.status_code == 400

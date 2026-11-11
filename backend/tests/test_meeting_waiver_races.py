"""Meeting waiver writes at the same moment give exactly one effect.

CLAUDE.md pitfalls #27 and #36, on real connections each in its own
transaction, the first held open past the moment the second reads:

  * two deciders approving one meeting request: one approval, one waiver row;
  * a member submitting twice for one meeting: one request;
  * an approval and the minutes record being built from the event, in either
    order: the waiver reaches the record (the approval holds the event shared
    and ``create_from_event`` holds it exclusively, and reads the approvals
    with a locking read);
  * an approval and the Secretary's own grant for the same member: one
    attendee row, never a duplicate-key error.

The hold wraps a step after every check and before the commit, patched once
outside the concurrent section (pitfall #22).
"""

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.core.database import database_manager
from app.models.attendance_waiver import AttendanceWaiverWorkflow
from app.services import attendance_waiver_service as engine_module
from app.services.attendance_dashboard_service import AttendanceDashboardService
from app.services.attendance_waiver_service import AttendanceWaiverService
from app.services.meetings_service import MeetingsService
from tests.audit_cleanup import discard_committed_audit_rows
from tests.waiver_request_support import (
    assign,
    load,
    make_meeting_event,
    make_member,
    make_minutes_record,
    make_org,
    make_position,
    set_meeting_policy,
)

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("_initialize_database")]

_HOLD_SECONDS = 0.4
MEETINGS = AttendanceWaiverWorkflow.BUSINESS_MEETING


def _engine() -> AsyncEngine:
    engine = database_manager.engine
    assert engine is not None, "the database is not connected"
    return engine


async def _seed(*, minutes: bool) -> SimpleNamespace:
    start = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=10)
    async with _engine().connect() as conn:
        db = AsyncSession(bind=conn, expire_on_commit=False)
        org = await make_org(db)
        clerk_pos = await make_position(db, org, "Clerk")
        secretary_pos = await make_position(
            db, org, "Secretary", slug="secretary", permissions=["meetings.manage"]
        )
        chief_pos = await make_position(db, org, "Chief", slug="fire_chief")
        member = await make_member(db, org, "Sam")
        clerk = await make_member(db, org, "Cleo")
        secretary = await make_member(db, org, "Sid")
        chief = await make_member(db, org, "Cal")
        await assign(db, clerk, clerk_pos)
        await assign(db, secretary, secretary_pos)
        await assign(db, chief, chief_pos)
        await set_meeting_policy(db, org, approver_position_ids=[clerk_pos])
        event = await make_meeting_event(db, org, start)
        meeting = (
            await make_minutes_record(db, org, secretary, event_id=event)
            if minutes
            else None
        )
        await db.commit()
        await db.close()
    return SimpleNamespace(
        org=org,
        member=member,
        clerk=clerk,
        secretary=secretary,
        chief=chief,
        event=event,
        meeting=meeting,
    )


async def _cleanup(dept) -> None:
    await discard_committed_audit_rows("organization_id = :o", {"o": dept.org})
    async with _engine().connect() as conn:
        async with conn.begin():
            for statement in (
                "DELETE FROM notification_logs WHERE organization_id = :o",
                "DELETE FROM meeting_attendees WHERE organization_id = :o",
                "DELETE FROM meetings WHERE organization_id = :o",
                "DELETE FROM attendance_waiver_request_actions WHERE organization_id = :o",
                "DELETE FROM attendance_waiver_requests WHERE organization_id = :o",
                "DELETE FROM event_rsvps WHERE organization_id = :o",
                "DELETE FROM events WHERE organization_id = :o",
                "DELETE FROM user_positions WHERE position_id IN "
                "(SELECT id FROM positions WHERE organization_id = :o)",
                "DELETE FROM positions WHERE organization_id = :o",
                "DELETE FROM users WHERE organization_id = :o",
                "DELETE FROM organizations WHERE id = :o",
            ):
                await conn.execute(text(statement), {"o": dept.org})


async def _count(sql: str, **params) -> int:
    async with _engine().connect() as conn:
        return int((await conn.execute(text(sql), params)).scalar() or 0)


async def _scalar(sql: str, **params):
    async with _engine().connect() as conn:
        return (await conn.execute(text(sql), params)).scalar()


@pytest.fixture
def hold(monkeypatch):
    """Arm a hold on ``owner.name``: the first caller to return from it keeps
    its transaction open; the event says when it got there."""

    def arm(owner, name: str) -> asyncio.Event:
        reached = asyncio.Event()
        original = getattr(owner, name)

        async def held(*args, **kwargs):
            result = await original(*args, **kwargs)
            if not reached.is_set():
                reached.set()
                await asyncio.sleep(_HOLD_SECONDS)
            return result

        monkeypatch.setattr(owner, name, held)
        return reached

    return arm


async def _in_session(user_id: str, action, after=None):
    """Run ``action(db, user)`` in its own transaction; a status or refusal."""
    if after is not None:
        await after.wait()
    async with _engine().connect() as conn:
        db = AsyncSession(bind=conn, expire_on_commit=False)
        try:
            user = await load(db, user_id)
            return await action(db, user)
        except (ValueError, PermissionError) as e:
            await db.rollback()
            return f"refused: {e}"
        finally:
            await db.close()


async def _pending(dept) -> str:
    async with _engine().connect() as conn:
        db = AsyncSession(bind=conn, expire_on_commit=False)
        member = await load(db, dept.member)
        request = await AttendanceWaiverService(db, MEETINGS).submit(
            dept.org, member, dept.event, None, None
        )
        await db.close()
    return str(request.id)


def _approve(dept, request_id):
    async def approve(db, user):
        request = await AttendanceWaiverService(db, MEETINGS).approve(
            dept.org, user, request_id
        )
        return request.status.value

    return approve


async def _attendee_rows(dept, meeting_id=None) -> int:
    return await _count(
        "SELECT COUNT(*) FROM meeting_attendees a JOIN meetings m "
        "ON m.id = a.meeting_id WHERE m.event_id = :e AND a.user_id = :u",
        e=dept.event,
        u=dept.member,
    )


async def test_two_deciders_at_once_decide_once(hold):
    dept = await _seed(minutes=True)
    try:
        request_id = await _pending(dept)
        reached = hold(AttendanceWaiverService, "_audit")
        results = await asyncio.gather(
            _in_session(dept.clerk, _approve(dept, request_id)),
            _in_session(dept.chief, _approve(dept, request_id), after=reached),
        )
        approvals = await _count(
            "SELECT COUNT(*) FROM attendance_waiver_request_actions "
            "WHERE request_id = :r AND action = 'approved'",
            r=request_id,
        )
        rows = await _attendee_rows(dept)
    finally:
        await _cleanup(dept)

    assert results[0] == "approved"
    assert results[1] == "refused: This request has already been approved.", results
    assert approvals == 1
    assert rows == 1


async def test_two_submissions_at_once_make_one_request(hold):
    dept = await _seed(minutes=False)

    async def submit(db, user):
        request = await AttendanceWaiverService(db, MEETINGS).submit(
            dept.org, user, dept.event, None, None
        )
        return request.status.value

    try:
        reached = hold(AttendanceWaiverService, "_audit")
        results = await asyncio.gather(
            _in_session(dept.member, submit),
            _in_session(dept.member, submit, after=reached),
        )
        rows = await _count(
            "SELECT COUNT(*) FROM attendance_waiver_requests WHERE user_id = :u",
            u=dept.member,
        )
    finally:
        await _cleanup(dept)

    assert results[0] == "pending"
    assert results[1].startswith("refused: You have already asked"), results
    assert rows == 1


def _create_from_event(dept):
    async def create(db, user):
        meeting, error = await MeetingsService(db).create_from_event(
            dept.event, dept.org, user.id
        )
        return error or "created"

    return create


async def test_an_approval_held_open_reaches_the_record_built_meanwhile(hold):
    """The approval finds no record and holds the event shared; the build
    waits for it, then carries the approval over."""
    dept = await _seed(minutes=False)
    try:
        request_id = await _pending(dept)
        reached = hold(AttendanceWaiverService, "_audit")
        results = await asyncio.gather(
            _in_session(dept.clerk, _approve(dept, request_id)),
            _in_session(dept.secretary, _create_from_event(dept), after=reached),
        )
        rows = await _attendee_rows(dept)
        linked = await _scalar(
            "SELECT a.waiver_request_id FROM meeting_attendees a JOIN meetings m "
            "ON m.id = a.meeting_id WHERE m.event_id = :e AND a.user_id = :u",
            e=dept.event,
            u=dept.member,
        )
    finally:
        await _cleanup(dept)

    assert results == ["approved", "created"], results
    assert rows == 1
    assert linked == request_id


async def test_a_record_being_built_is_found_by_the_approval(hold):
    """The build holds the event exclusively; the approval waits for it, then
    finds the new record and writes the waiver there."""
    dept = await _seed(minutes=False)
    try:
        request_id = await _pending(dept)
        reached = hold(engine_module, "carry_over_meeting_waivers")
        results = await asyncio.gather(
            _in_session(dept.secretary, _create_from_event(dept)),
            _in_session(dept.clerk, _approve(dept, request_id), after=reached),
        )
        rows = await _attendee_rows(dept)
        linked = await _scalar(
            "SELECT a.waiver_request_id FROM meeting_attendees a JOIN meetings m "
            "ON m.id = a.meeting_id WHERE m.event_id = :e AND a.user_id = :u",
            e=dept.event,
            u=dept.member,
        )
    finally:
        await _cleanup(dept)

    assert results == ["created", "approved"], results
    assert rows == 1
    assert linked == request_id


async def test_an_approval_and_the_secretarys_grant_make_one_row(hold):
    dept = await _seed(minutes=True)
    try:
        request_id = await _pending(dept)

        async def grant(db, user):
            await AttendanceDashboardService(db).grant_waiver(
                meeting_id=dept.meeting,
                user_id=dept.member,
                organization_id=dept.org,
                granted_by=user.id,
                reason="Granted at the door",
            )
            return "granted"

        reached = hold(AttendanceWaiverService, "_audit")
        results = await asyncio.gather(
            _in_session(dept.clerk, _approve(dept, request_id)),
            _in_session(dept.secretary, grant, after=reached),
        )
        rows = await _attendee_rows(dept)
        reason = await _scalar(
            "SELECT waiver_reason FROM meeting_attendees WHERE meeting_id = :m",
            m=dept.meeting,
        )
    finally:
        await _cleanup(dept)

    assert results == ["approved", "granted"], results
    assert rows == 1
    # The grant came second and its words stand.
    assert reason == "Granted at the door"

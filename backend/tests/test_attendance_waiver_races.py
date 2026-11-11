"""Two requests at once give exactly one effect (CLAUDE.md pitfalls #27, #36).

On real connections, each in its own transaction: the first holds its locks
open past the moment the second reads, which is the interleaving a rolled-back
single-session test can never produce.

  * two deciders approving the same request: one approval, one refusal;
  * a member submitting twice for one session: one request;
  * two approvals racing for a member's last waiver: one approved.

The hold is a wrapper around the service's audit step, which runs after every
check and before the commit, patched once on the class outside the concurrent
section (pitfall #22).

Two DIFFERENT members are not serialized by anything (each write locks only
its own member's row), so those races must each succeed on their own:

  * two members submitting at once, for one session or two, with and without
    a cap: two requests;
  * two members' requests approved at once under a cap: two approvals.

These meet at a barrier placed after every read a write makes and before its
first insert or update, so each has taken whatever locks its reads take before
either writes. A gap lock on a range both members share is exactly what turns
that interleaving into a 1213 deadlock and a 500.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.core.database import database_manager
from app.services.attendance_waiver_service import AttendanceWaiverService
from tests.audit_cleanup import discard_committed_audit_rows
from tests.waiver_request_support import (
    assign,
    load,
    make_member,
    make_org,
    make_position,
    make_requirement,
    make_session,
    set_policy,
)

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("_initialize_database")]

_HOLD_SECONDS = 0.4


def _engine() -> AsyncEngine:
    engine = database_manager.engine
    assert engine is not None, "the database is not connected"
    return engine


async def _seed(cap=None) -> SimpleNamespace:
    start = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=10)
    async with _engine().connect() as conn:
        db = AsyncSession(bind=conn, expire_on_commit=False)
        org = await make_org(db)
        officer_pos = await make_position(db, org, "Training Officer")
        chief_pos = await make_position(db, org, "Chief", slug="fire_chief")
        member = await make_member(db, org, "Sam")
        other = await make_member(db, org, "Sue")
        officer = await make_member(db, org, "Tina")
        chief = await make_member(db, org, "Cal")
        await assign(db, officer, officer_pos)
        await assign(db, chief, chief_pos)
        await set_policy(db, org, approver_position_ids=[officer_pos], cap=cap)
        requirement = await make_requirement(db, org)
        first = await make_session(db, org, start, link=[requirement])
        second = await make_session(
            db, org, start + timedelta(days=1), link=[requirement]
        )
        await db.commit()
        await db.close()
    return SimpleNamespace(
        org=org,
        member=member,
        other=other,
        officer=officer,
        chief=chief,
        first=first,
        second=second,
        users=[member, other, officer, chief],
        positions=[officer_pos, chief_pos],
    )


async def _cleanup(dept) -> None:
    await discard_committed_audit_rows("organization_id = :o", {"o": dept.org})
    async with _engine().connect() as conn:
        async with conn.begin():
            for statement in (
                "DELETE FROM notification_logs WHERE organization_id = :o",
                "DELETE FROM attendance_waiver_request_actions WHERE organization_id = :o",
                "DELETE FROM attendance_waiver_requests WHERE organization_id = :o",
                "DELETE FROM training_session_requirements WHERE organization_id = :o",
                "DELETE FROM training_sessions WHERE organization_id = :o",
                "DELETE FROM training_requirements WHERE organization_id = :o",
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


@pytest.fixture
def hold(monkeypatch):
    """Arm a hold: the first caller to reach the audit step afterwards keeps
    its transaction open; the event says when it got there."""

    def arm() -> asyncio.Event:
        reached = asyncio.Event()
        original = AttendanceWaiverService._audit

        async def held_audit(self, *args, **kwargs):
            await original(self, *args, **kwargs)
            if not reached.is_set():
                reached.set()
                await asyncio.sleep(_HOLD_SECONDS)

        monkeypatch.setattr(AttendanceWaiverService, "_audit", held_audit)
        return reached

    return arm


async def _act(user_id: str, action, after=None):
    """Run ``action(service, user)`` in its own transaction; its result or refusal."""
    if after is not None:
        await after.wait()
    async with _engine().connect() as conn:
        db = AsyncSession(bind=conn, expire_on_commit=False)
        try:
            user = await load(db, user_id)
            result = await action(AttendanceWaiverService(db), user)
            return result.status.value
        except (ValueError, PermissionError) as e:
            await db.rollback()
            return f"refused: {e}"
        finally:
            await db.close()


def _submit(dept, event_id):
    async def submit(service, user):
        return await service.submit(dept.org, user, event_id, None, None)

    return submit


@pytest.fixture
def meet(monkeypatch):
    """Make two callers of ``method`` wait for each other, before running it
    or, with ``after``, once it has returned.

    Patched once on the class, outside the concurrent section (pitfall #22).
    The wait is bounded, so a caller that never arrives (it failed earlier)
    cannot hang the other.
    """

    def arm(method: str, *, after: bool = False) -> None:
        barrier = asyncio.Barrier(2)
        original = getattr(AttendanceWaiverService, method)

        async def wait() -> None:
            try:
                await asyncio.wait_for(barrier.wait(), timeout=5)
            except (TimeoutError, asyncio.BrokenBarrierError):
                pass

        async def met(self, *args, **kwargs):
            if not after:
                await wait()
            result = await original(self, *args, **kwargs)
            if after:
                await wait()
            return result

        monkeypatch.setattr(AttendanceWaiverService, method, met)

    return arm


async def _pending(dept, event_id, member_id=None) -> str:
    async with _engine().connect() as conn:
        db = AsyncSession(bind=conn, expire_on_commit=False)
        member = await load(db, member_id or dept.member)
        request = await AttendanceWaiverService(db).submit(
            dept.org, member, event_id, None, None
        )
        await db.close()
    return str(request.id)


async def test_two_deciders_at_once_decide_once(hold):
    dept = await _seed()
    try:
        request_id = await _pending(dept, dept.first)

        async def approve(service, user):
            return await service.approve(dept.org, user, request_id)

        reached = hold()
        results = await asyncio.gather(
            _act(dept.officer, approve), _act(dept.chief, approve, after=reached)
        )
        approvals = await _count(
            "SELECT COUNT(*) FROM attendance_waiver_request_actions "
            "WHERE request_id = :r AND action = 'approved'",
            r=request_id,
        )
    finally:
        await _cleanup(dept)

    assert results[0] == "approved"
    assert results[1] == "refused: This request has already been approved.", results
    assert approvals == 1


async def test_two_submissions_at_once_make_one_request(hold):
    """One effect, whichever guard produces it. The second submitter's
    snapshot predates the first's commit, so its plain read misses the first
    request and it is the unique ``live_key`` that refuses the insert; the
    service test of that collision pins the path itself."""
    dept = await _seed()
    try:
        submit = _submit(dept, dept.first)
        reached = hold()
        results = await asyncio.gather(
            _act(dept.member, submit), _act(dept.member, submit, after=reached)
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


async def test_two_approvals_for_the_last_waiver_approve_one(hold):
    dept = await _seed(cap=1)
    try:
        first = await _pending(dept, dept.first)
        second = await _pending(dept, dept.second)

        def approve(request_id):
            async def run(service, user):
                return await service.approve(dept.org, user, request_id)

            return run

        reached = hold()
        results = await asyncio.gather(
            _act(dept.officer, approve(first)),
            _act(dept.chief, approve(second), after=reached),
        )
        approved = await _count(
            "SELECT COUNT(*) FROM attendance_waiver_requests "
            "WHERE user_id = :u AND status = 'approved'",
            u=dept.member,
        )
    finally:
        await _cleanup(dept)

    assert results[0] == "approved"
    assert results[1].startswith("refused: Approving this would exceed"), results
    assert approved == 1


@pytest.mark.parametrize("cap", [None, 3], ids=["no-cap", "cap"])
@pytest.mark.parametrize("same_session", [True, False], ids=["one-session", "two"])
async def test_two_members_submitting_at_once_both_get_a_request(
    meet, cap, same_session
):
    dept = await _seed(cap=cap)
    try:
        # _assess makes every read submit relies on; the insert follows it.
        meet("_assess", after=True)
        other_event = dept.first if same_session else dept.second
        results = await asyncio.gather(
            _act(dept.member, _submit(dept, dept.first)),
            _act(dept.other, _submit(dept, other_event)),
            return_exceptions=True,
        )
        rows = await _count(
            "SELECT COUNT(*) FROM attendance_waiver_requests "
            "WHERE organization_id = :o AND status = 'pending'",
            o=dept.org,
        )
    finally:
        await _cleanup(dept)

    assert results == ["pending", "pending"], results
    assert rows == 2


async def test_two_members_approved_at_once_under_a_cap(meet):
    dept = await _seed(cap=3)
    try:
        first = await _pending(dept, dept.first)
        second = await _pending(dept, dept.first, member_id=dept.other)

        def approve(request_id):
            async def run(service, user):
                return await service.approve(dept.org, user, request_id)

            return run

        # _decide runs after the cap count and before the status update.
        meet("_decide")
        results = await asyncio.gather(
            _act(dept.officer, approve(first)),
            _act(dept.chief, approve(second)),
            return_exceptions=True,
        )
        approved = await _count(
            "SELECT COUNT(*) FROM attendance_waiver_requests "
            "WHERE organization_id = :o AND status = 'approved'",
            o=dept.org,
        )
    finally:
        await _cleanup(dept)

    assert results == ["approved", "approved"], results
    assert approved == 2

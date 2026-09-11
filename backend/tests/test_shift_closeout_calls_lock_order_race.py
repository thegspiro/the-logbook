"""AP-13 finding 4 (Codex, on top of finding 3): ``save_closeout_calls``
locked ``OrgCall``/``OrgCallResponse`` rows first (via the DELETE/UPDATE
inside ``record_shift_calls``) and only locked the ``Shift`` row at commit
(``shift.closeout_step = ...`` then ``self.db.commit()``). ``finalize_shift``
(finding 3's own fix) now locks the shift row *first* and only reconciles
those same call rows through ``record_shift_calls`` afterward. Two methods
taking the same two locks in opposite orders is the same textbook InnoDB
deadlock finding 3 fixed, just with a different second method: an officer
saving the closeout-calls step while another officer finalizes the same
shift could have either transaction aborted.

The fix makes ``save_closeout_calls`` lock the shift row first too
(``get_shift_by_id(..., for_update=True)``), matching ``finalize_shift``'s
order. As with finding 3, this test proves the actual fix mechanism --
``save_closeout_calls`` now blocks on the same shift-row lock a concurrent
check-in or finalize holds -- rather than attempting a fragile live
cross-table deadlock reproduction.

This test uses two REAL, independently-committing sessions (not the
savepoint-based ``db_session`` fixture, which never truly commits and so can
never demonstrate cross-transaction visibility) to force the exact
interleaving.
"""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.core.database import database_manager
from app.models.training import Shift, ShiftAttendance
from app.models.user import Organization, User, UserStatus
from app.services.scheduling_service import SchedulingService

pytestmark = pytest.mark.integration


@pytest.fixture
async def two_sessions(_initialize_database):
    """Two independent AsyncSessions, each its own real connection and
    transaction -- required to demonstrate cross-transaction visibility.
    """
    factory = database_manager.session_factory
    sessions = [factory(), factory()]
    try:
        yield sessions
    finally:
        for session in sessions:
            await session.rollback()
            await session.close()


async def _make_org_user_shift(session, slug):
    # Count-only tracking, because ``save_closeout_calls`` is that mode's step
    # and refuses outright anywhere else. The org used to be left on the
    # ``detailed`` default and the lock-ordering assertion under test still
    # held, which only meant the step was reachable from a mode that never
    # reads what it writes.
    org = Organization(
        name="Race Test VFD",
        slug=slug,
        settings={"scheduling": {"call_tracking": {"mode": "count_only"}}},
    )
    session.add(org)
    await session.flush()
    user = User(
        organization_id=org.id,
        username=f"ff-{slug}",
        email=f"{slug}@example.test",
        first_name="Jane",
        last_name="Doe",
        status=UserStatus.ACTIVE,
    )
    session.add(user)
    await session.flush()
    now = datetime.now(timezone.utc)
    shift = Shift(
        organization_id=org.id,
        shift_date=now.date(),
        start_time=now - timedelta(hours=8),
        end_time=now,
        open_to_all_members=True,
    )
    session.add(shift)
    await session.commit()
    return org.id, user.id, shift.id


async def _teardown(org_id, shift_id, user_id):
    factory = database_manager.session_factory
    cleanup = factory()
    try:
        await cleanup.execute(
            ShiftAttendance.__table__.delete().where(
                ShiftAttendance.shift_id == shift_id
            )
        )
        await cleanup.execute(Shift.__table__.delete().where(Shift.id == shift_id))
        await cleanup.execute(User.__table__.delete().where(User.id == user_id))
        await cleanup.execute(
            Organization.__table__.delete().where(Organization.id == org_id)
        )
        await cleanup.commit()
    finally:
        await cleanup.close()


class TestSaveCloseoutCallsLocksTheShiftRowFirst:
    async def test_save_closeout_calls_blocks_on_a_concurrent_check_ins_shift_lock(
        self, two_sessions
    ):
        session_a, session_b = two_sessions
        slug = f"ap-closeout-race-{uuid.uuid4().hex[:12]}"
        org_id, user_id, shift_id = await _make_org_user_shift(session_a, slug)
        b_task = None
        try:
            service_a = SchedulingService(session_a)
            service_b = SchedulingService(session_b)

            # Session A: a check-in mid-transaction, holding the shift lock
            # exactly as member_check_in's own first step does, simulating
            # "a member tapped in a moment ago and this transaction hasn't
            # committed yet."
            shift_a = await service_a.get_shift_by_id(
                shift_id, uuid.UUID(org_id), for_update=True
            )
            assert shift_a is not None

            # Session B: an officer saving the closeout-calls step
            # concurrently -- the real, unmodified save_closeout_calls,
            # instrumented only to signal an asyncio.Event the moment it
            # reaches its own locking shift-fetch. Pre-fix, get_shift_by_id
            # is called inside save_closeout_calls without for_update at
            # all, so it would never block on A's lock and this whole test
            # would time out waiting for the tracking Event -- itself a
            # valid failure signal for a test whose entire premise is that
            # parameter being passed.
            lock_attempted = asyncio.Event()
            original_get = service_b.get_shift_by_id

            async def _tracking_get(*args, **kwargs):
                if kwargs.get("for_update"):
                    lock_attempted.set()
                return await original_get(*args, **kwargs)

            service_b.get_shift_by_id = _tracking_get

            b_task = asyncio.create_task(
                service_b.save_closeout_calls(
                    shift_id=shift_id,
                    organization_id=uuid.UUID(org_id),
                    reported_call_count=1,
                    count_provided=True,
                    recorded_by=user_id,
                )
            )
            await asyncio.wait_for(lock_attempted.wait(), timeout=10)
            await asyncio.sleep(0.2)
            assert not b_task.done(), (
                "save_closeout_calls should still be blocked on A's "
                "already-locked shift row -- if it isn't, save_closeout_calls "
                "and finalize_shift/member_check_in are back to taking the "
                "shift and call-record locks in opposite orders"
            )

            # Session A releases the lock without committing any change --
            # this test is only exercising lock *order*, not a specific
            # outcome.
            await session_a.rollback()

            # B unblocks and saves normally.
            closeout_state, error_b = await asyncio.wait_for(b_task, timeout=10)
            b_task = None
            assert error_b is None
            assert closeout_state is not None
        finally:
            if b_task is not None and not b_task.done():
                b_task.cancel()
            for session in (session_a, session_b):
                await session.rollback()
            await _teardown(org_id, shift_id, user_id)

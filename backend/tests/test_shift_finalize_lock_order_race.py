"""AP-13 finding 3 (Codex, on top of AP-13 finding 2): ``finalize_shift`` read
its shift row with a plain (non-locking) ``get_shift_by_id`` call, while
``member_check_in`` (finding 2's own fix) now locks the shift row first and
only locks ``ShiftAttendance`` second. ``finalize_shift`` does the opposite in
practice: it auto-closes open ``ShiftAttendance`` rows (an UPDATE, which takes
an implicit row lock at flush time) *before* it ever updates the ``Shift``
row itself (at commit, just before ``shift.is_finalized = True`` is flushed).
Two transactions taking the same two locks in opposite orders is a textbook
InnoDB deadlock: a check-in landing while an officer finalizes the same shift
could have either transaction aborted.

The fix makes ``finalize_shift`` lock the shift row first too
(``get_shift_by_id(..., for_update=True)``), matching ``member_check_in``'s
order. Reproducing an actual cross-table InnoDB deadlock reliably (exact
timing on both sides, dependent on index/gap-lock specifics) is fragile
compared to what this fix actually needs demonstrated: that ``finalize_shift``
now blocks on the same shift-row lock ``member_check_in`` takes, exactly the
way a second ``member_check_in`` call already does (see
``test_shift_check_in_race.py``). If both methods always queue on the shift
lock first, neither can be holding an attendance lock while waiting on a
shift lock the other already holds -- the reversed order is structurally
eliminated, not merely made less likely.

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


async def _make_org_user_ended_shift(session, slug):
    org = Organization(name="Race Test VFD", slug=slug)
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
    # Ended, not just started: finalize_shift refuses a shift that hasn't
    # ended yet, unlike member_check_in's own fixture.
    shift = Shift(
        organization_id=org.id,
        shift_date=(now - timedelta(hours=9)).date(),
        start_time=now - timedelta(hours=9),
        end_time=now - timedelta(hours=1),
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


class TestFinalizeShiftLocksTheShiftRowFirst:
    async def test_finalize_shift_blocks_on_a_concurrent_check_ins_shift_lock(
        self, two_sessions
    ):
        session_a, session_b = two_sessions
        slug = f"ap-finalize-race-{uuid.uuid4().hex[:12]}"
        org_id, user_id, shift_id = await _make_org_user_ended_shift(session_a, slug)
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

            # Session B: an officer finalizing the same shift concurrently --
            # the real, unmodified finalize_shift, instrumented only to
            # signal an asyncio.Event the moment it reaches its own locking
            # shift-fetch. Pre-fix, get_shift_by_id is called inside
            # finalize_shift without for_update at all, so it would never
            # block on A's lock and this whole test would time out waiting
            # for the tracking Event -- itself a valid failure signal for a
            # test whose entire premise is that parameter being passed.
            lock_attempted = asyncio.Event()
            original_get = service_b.get_shift_by_id

            async def _tracking_get(*args, **kwargs):
                if kwargs.get("for_update"):
                    lock_attempted.set()
                return await original_get(*args, **kwargs)

            service_b.get_shift_by_id = _tracking_get

            b_task = asyncio.create_task(
                service_b.finalize_shift(
                    shift_id=shift_id,
                    organization_id=uuid.UUID(org_id),
                    finalized_by_user_id=user_id,
                )
            )
            await asyncio.wait_for(lock_attempted.wait(), timeout=10)
            await asyncio.sleep(0.2)
            assert not b_task.done(), (
                "finalize_shift should still be blocked on A's "
                "already-locked shift row -- if it isn't, finalize_shift "
                "and member_check_in are back to taking the shift and "
                "attendance locks in opposite orders"
            )

            # Session A releases the lock without committing any change --
            # this test is only exercising lock *order*, not a specific
            # check-in outcome.
            await session_a.rollback()

            # B unblocks and finalizes normally.
            finalized_shift, error_b = await asyncio.wait_for(b_task, timeout=10)
            b_task = None
            assert error_b is None
            assert finalized_shift is not None
            assert finalized_shift.is_finalized is True
        finally:
            if b_task is not None and not b_task.done():
                b_task.cancel()
            for session in (session_a, session_b):
                await session.rollback()
            await _teardown(org_id, shift_id, user_id)

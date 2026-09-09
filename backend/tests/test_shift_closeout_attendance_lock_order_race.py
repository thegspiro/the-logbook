"""AP-13 finding 7 (Codex, on top of finding 4): ``save_closeout_attendance``
has the same reversed-lock-order shape as ``save_closeout_calls`` (finding 4)
and ``finalize_shift`` (finding 3), just reached through a different implicit
flush. It read the shift with a plain, non-locking ``get_shift_by_id``, then
looped over the submitted entries: an entry for a member who already has a
``ShiftAttendance`` row mutates that row's ``checked_in_at``/
``checked_out_at`` in place; an entry for a member with no row yet calls
``_user_in_org`` first, which issues a ``SELECT`` and therefore triggers
SQLAlchemy's autoflush -- flushing the *already-mutated* existing attendance
row (an implicit UPDATE, and therefore an implicit row lock) before the shift
row is ever touched. ``shift.closeout_step`` is only assigned, and the shift
row only locked, at commit -- the reverse of ``finalize_shift``'s now-fixed
shift-then-attendance order. A closeout-attendance save that updates one
existing member and adds one new member, racing a finalize on the same
shift, could deadlock, aborting one of two otherwise unrelated, ordinary
requests.

The fix makes ``save_closeout_attendance`` lock the shift row first too
(``get_shift_by_id(..., for_update=True)``), matching ``finalize_shift`` and
``save_closeout_calls``. As with those two, this test proves the actual fix
mechanism -- ``save_closeout_attendance`` now blocks on the same shift-row
lock a concurrent check-in or finalize holds -- rather than attempting a
fragile live cross-table deadlock reproduction.

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


async def _make_org_two_users_shift_with_existing_attendance(session, slug):
    org = Organization(name="Race Test VFD", slug=slug)
    session.add(org)
    await session.flush()
    user1 = User(
        organization_id=org.id,
        username=f"ff1-{slug}",
        email=f"ff1-{slug}@example.test",
        first_name="Jane",
        last_name="Doe",
        status=UserStatus.ACTIVE,
    )
    user2 = User(
        organization_id=org.id,
        username=f"ff2-{slug}",
        email=f"ff2-{slug}@example.test",
        first_name="John",
        last_name="Roe",
        status=UserStatus.ACTIVE,
    )
    session.add_all([user1, user2])
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
    await session.flush()
    # user1 already has an attendance row -- the entry that gets mutated
    # in place before the new-member (_user_in_org) autoflush trigger.
    existing_attendance = ShiftAttendance(
        shift_id=shift.id,
        user_id=user1.id,
        checked_in_at=now - timedelta(hours=8),
    )
    session.add(existing_attendance)
    await session.commit()
    return org.id, user1.id, user2.id, shift.id


async def _teardown(org_id, shift_id, user1_id, user2_id):
    factory = database_manager.session_factory
    cleanup = factory()
    try:
        await cleanup.execute(
            ShiftAttendance.__table__.delete().where(
                ShiftAttendance.shift_id == shift_id
            )
        )
        await cleanup.execute(Shift.__table__.delete().where(Shift.id == shift_id))
        await cleanup.execute(
            User.__table__.delete().where(User.id.in_([user1_id, user2_id]))
        )
        await cleanup.execute(
            Organization.__table__.delete().where(Organization.id == org_id)
        )
        await cleanup.commit()
    finally:
        await cleanup.close()


class TestSaveCloseoutAttendanceLocksTheShiftRowFirst:
    async def test_save_closeout_attendance_blocks_on_a_concurrent_check_ins_shift_lock(
        self, two_sessions
    ):
        session_a, session_b = two_sessions
        slug = f"ap-closeout-att-race-{uuid.uuid4().hex[:12]}"
        (
            org_id,
            user1_id,
            user2_id,
            shift_id,
        ) = await _make_org_two_users_shift_with_existing_attendance(session_a, slug)
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

            # Session B: an officer saving the closeout-attendance step
            # concurrently -- the real, unmodified save_closeout_attendance,
            # instrumented only to signal an asyncio.Event the moment it
            # reaches its own locking shift-fetch. Pre-fix, get_shift_by_id
            # is called inside save_closeout_attendance without for_update
            # at all, so it would never block on A's lock and this whole
            # test would time out waiting for the tracking Event -- itself a
            # valid failure signal for a test whose entire premise is that
            # parameter being passed.
            lock_attempted = asyncio.Event()
            original_get = service_b.get_shift_by_id

            async def _tracking_get(*args, **kwargs):
                if kwargs.get("for_update"):
                    lock_attempted.set()
                return await original_get(*args, **kwargs)

            service_b.get_shift_by_id = _tracking_get

            now = datetime.now(timezone.utc)
            entries = [
                # Existing member first -- mutates the already-loaded
                # ShiftAttendance row in place.
                {
                    "user_id": user1_id,
                    "checked_in_at": now - timedelta(hours=8),
                    "checked_out_at": now,
                },
                # New member second -- its _user_in_org lookup is what
                # triggers autoflush of the mutation above, pre-fix locking
                # the attendance row before the shift row is ever touched.
                {
                    "user_id": user2_id,
                    "checked_in_at": now - timedelta(hours=7),
                    "checked_out_at": now,
                },
            ]

            b_task = asyncio.create_task(
                service_b.save_closeout_attendance(
                    shift_id=shift_id,
                    organization_id=uuid.UUID(org_id),
                    entries=entries,
                )
            )
            await asyncio.wait_for(lock_attempted.wait(), timeout=10)
            await asyncio.sleep(0.2)
            assert not b_task.done(), (
                "save_closeout_attendance should still be blocked on A's "
                "already-locked shift row -- if it isn't, "
                "save_closeout_attendance and finalize_shift/member_check_in "
                "are back to taking the shift and attendance locks in "
                "opposite orders"
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
            await _teardown(org_id, shift_id, user1_id, user2_id)

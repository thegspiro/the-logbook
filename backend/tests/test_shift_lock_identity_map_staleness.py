"""AP-13 finding 5 (Codex, on top of finding 4): several endpoints
(``finalize_shift``, ``save_closeout_calls``) authorize the caller through
``_authorize_shift_management``, which loads the ``Shift`` with a plain,
non-locking ``get_shift_by_id`` call *before* the service method makes its
own locking call (``for_update=True``) on the same session.

SQLAlchemy's identity map means that second call is not what it looks like.
The ``SELECT ... FOR UPDATE`` genuinely reaches the database, genuinely
blocks on a lock another transaction holds, and genuinely reads the latest
*committed* row once it unblocks -- all of that is correct. What is not
correct: because the ``Shift`` row for this id is already present in the
session's identity map (from the earlier, non-locking load),
SQLAlchemy's default behavior is to return that *same Python object*,
unchanged, rather than repopulating its attributes from the freshly-fetched
row. The lock is real; the object handed back to the caller is stale. A
caller that then reads ``shift.is_finalized`` off that "locked" shift sees
whatever it was at the *first* read, not the current, just-committed truth
the lock exists to guarantee.

The fix adds ``execution_options(populate_existing=True)`` to
``get_shift_by_id``'s query whenever ``for_update=True``, so a locking read
always refreshes the object it returns, identity-map hit or not.

This test uses two REAL, independently-committing sessions (not the
savepoint-based ``db_session`` fixture, which never truly commits and so can
never demonstrate cross-transaction visibility) to force the exact
interleaving, and deliberately mimics ``_authorize_shift_management``'s own
shape: a plain read into the identity map, followed later by the service's
own locking read on the same session.
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
    shift = Shift(
        organization_id=org.id,
        shift_date=now.date(),
        start_time=now - timedelta(hours=1),
        end_time=now + timedelta(hours=7),
        open_to_all_members=True,
        is_finalized=False,
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


class TestLockingReadRefreshesAnAlreadyLoadedShift:
    async def test_for_update_read_sees_a_concurrent_commit_despite_an_earlier_plain_read(
        self, two_sessions
    ):
        session_a, session_b = two_sessions
        slug = f"ap-idmap-race-{uuid.uuid4().hex[:12]}"
        org_id, user_id, shift_id = await _make_org_user_shift(session_a, slug)
        b_task = None
        try:
            service_a = SchedulingService(session_a)
            service_b = SchedulingService(session_b)

            # Session B: the plain, non-locking read _authorize_shift_management
            # does before any service method runs. This populates B's
            # identity map with is_finalized=False *and* -- independently --
            # establishes B's own REPEATABLE READ snapshot.
            shift_b_preload = await service_b.get_shift_by_id(
                shift_id, uuid.UUID(org_id)
            )
            assert shift_b_preload is not None
            assert shift_b_preload.is_finalized is False

            # Session A: locks the shift row exactly as finalize_shift's own
            # first step now does, simulating "an officer is mid-finalize,
            # holding the lock, hasn't committed is_finalized=True yet."
            shift_a = await service_a.get_shift_by_id(
                shift_id, uuid.UUID(org_id), for_update=True
            )
            assert shift_a is not None

            # Session B: the service's own locking read on the *same*
            # session that already preloaded this shift -- started while A's
            # transaction is still open. Tracked so the test can prove B is
            # genuinely blocked at the database level, not just slow.
            lock_attempted = asyncio.Event()
            b_result: dict = {}

            async def _run_b_locking_read():
                lock_attempted.set()
                b_result["shift"] = await service_b.get_shift_by_id(
                    shift_id, uuid.UUID(org_id), for_update=True
                )

            b_task = asyncio.create_task(_run_b_locking_read())
            await asyncio.wait_for(lock_attempted.wait(), timeout=10)
            await asyncio.sleep(0.2)
            assert not b_task.done(), (
                "B's locking re-read should still be blocked on A's "
                "already-locked shift row"
            )

            # Session A finalizes and commits, releasing the lock B is
            # waiting on.
            shift_a.is_finalized = True
            await session_a.commit()

            # B unblocks. The row it reads is now committed as finalized --
            # the question this test exists to answer is whether the Python
            # object B gets back actually says so, or whether it silently
            # returns B's own stale preload from before A ever committed.
            await asyncio.wait_for(b_task, timeout=10)
            b_task = None
            shift_b_locked = b_result["shift"]
            assert shift_b_locked is not None
            assert shift_b_locked.is_finalized is True, (
                "get_shift_by_id(for_update=True) returned a stale "
                "identity-map object instead of refreshing it from the "
                "freshly-locked, just-committed row -- the lock was real "
                "but the value read off it was not"
            )
            # Also confirm it is in fact the *same* Python object refreshed
            # in place, not a coincidentally-correct second instance --
            # that is the identity-map behavior this fix relies on.
            assert shift_b_locked is shift_b_preload
        finally:
            if b_task is not None and not b_task.done():
                b_task.cancel()
            for session in (session_a, session_b):
                await session.rollback()
            await _teardown(org_id, shift_id, user_id)

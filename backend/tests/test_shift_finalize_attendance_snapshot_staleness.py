"""AP-13 finding 8 (Codex, on top of finding 7): locking the ``Shift`` row
first (findings 3/5) closes the lock-*ordering* deadlock and the
identity-map staleness on the shift object itself, but it does not by
itself refresh this transaction's REPEATABLE READ *snapshot* for a
different table. ``_authorize_shift_management`` runs a plain, non-locking
shift query first -- the earliest read in the REST transaction -- and under
InnoDB's default REPEATABLE READ, that first consistent (non-locking) read
is what fixes the transaction's snapshot for every later plain read,
regardless of what locking reads happen afterward on other rows. A locking
read (``SELECT ... FOR UPDATE``) always sees the latest committed data and
ignores the snapshot; a plain ``SELECT`` does not.

``finalize_shift``'s two ``ShiftAttendance`` reads after the shift lock --
the ``manual_hours`` existing-user check and the auto-close-open-attendance
query -- were both plain ``SELECT``s. So a member who checks in (or is
checked in) while an officer's finalize request is waiting on the shift
lock a concurrent check-in briefly held: the finalize's own attendance
reads still answer from the *pre-check-in* snapshot fixed at
``_authorize_shift_management``'s query, missing the newly committed
attendance row entirely. The auto-close step never sees it, so it is left
open (``checked_out_at IS NULL``) even though the shift the row belongs to
is now finalized -- exactly Pitfall #27's second half ("the count itself
must be a locking read"), just on ``finalize_shift``'s own attendance
reconciliation rather than a capacity check.

The fix adds ``.with_for_update()`` to both queries, so they bypass the
stale snapshot and see the latest committed attendance rows once the shift
lock resolves.

This test uses two REAL, independently-committing sessions (not the
savepoint-based ``db_session`` fixture, which never truly commits and so
can never demonstrate cross-transaction visibility): session B establishes
its snapshot with a plain, non-locking preload (mimicking
``_authorize_shift_management``) *before* session A commits a fresh,
still-open attendance row; session B then runs the real, unmodified
``finalize_shift`` and the test asserts the row was seen and closed.
"""

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


class TestFinalizeShiftSeesAConcurrentlyCommittedAttendanceRow:
    async def test_finalize_shift_closes_a_check_in_committed_after_its_snapshot(
        self, two_sessions
    ):
        session_a, session_b = two_sessions
        slug = f"ap-finalize-snapshot-{uuid.uuid4().hex[:12]}"
        org_id, user_id, shift_id = await _make_org_user_ended_shift(session_b, slug)
        try:
            service_b = SchedulingService(session_b)

            # Session B: the plain, non-locking read _authorize_shift_management
            # does first. This is B's transaction's *first* consistent read,
            # which fixes its REPEATABLE READ snapshot right here -- before
            # session A's attendance row below is even created.
            preloaded = await service_b.get_shift_by_id(shift_id, uuid.UUID(org_id))
            assert preloaded is not None

            # Session A: a member checks in and the row is committed --
            # after B's snapshot was already fixed above.
            open_attendance = ShiftAttendance(
                shift_id=shift_id,
                user_id=user_id,
                checked_in_at=datetime.now(timezone.utc) - timedelta(hours=2),
            )
            session_a.add(open_attendance)
            await session_a.commit()

            # Session B: the real, unmodified finalize_shift. Its own shift
            # lock resolves immediately (A already committed and holds no
            # lock), but its ShiftAttendance reads are the ones under test --
            # do they see A's row, or B's now-stale pre-check-in snapshot?
            finalized_shift, error = await service_b.finalize_shift(
                shift_id=shift_id,
                organization_id=uuid.UUID(org_id),
                finalized_by_user_id=user_id,
            )
            assert error is None
            assert finalized_shift is not None
            assert finalized_shift.is_finalized is True

            # Verify against the database directly, not B's identity map --
            # the row this test cares about was created by A, not preloaded
            # by B, so there's no cached-object shortcut to accidentally
            # pass on.
            verify = database_manager.session_factory()
            try:
                refreshed = await verify.get(ShiftAttendance, open_attendance.id)
                assert refreshed is not None
                assert refreshed.checked_out_at is not None, (
                    "finalize_shift's auto-close step never saw the "
                    "concurrently-committed attendance row -- it used a "
                    "REPEATABLE READ snapshot fixed before the check-in "
                    "committed instead of a current, locking read"
                )
            finally:
                await verify.close()
        finally:
            await session_a.rollback()
            await session_b.rollback()
            await _teardown(org_id, shift_id, user_id)

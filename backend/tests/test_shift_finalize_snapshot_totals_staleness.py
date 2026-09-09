"""AP-13 finding 9 (Codex, on top of finding 8): finding 8 fixed the
auto-close-open-attendance query in ``finalize_shift`` to be a locking
read, but two more ``ShiftAttendance`` reads later in the same method --
the ``total_hours`` ``SUM`` snapshot and the "every attendance row on this
shift" query that stamps per-member ``call_count`` -- were still plain
``SELECT``s, answering from the same stale REPEATABLE READ snapshot
``_authorize_shift_management``'s earlier plain shift query fixed.

The open-attendance query's own fix does not cover this: a
``save_closeout_attendance`` save (or any attendance write) that commits an
already-checked-out row -- ``checked_in_at`` and ``checked_out_at`` both
set -- while finalize is waiting on the shift lock never matches the
open-attendance predicate (``checked_out_at IS NULL``) in the first place.
It is invisible to *that* query by design, but it must still be visible to
the totals/per-member snapshot queries that run afterward, or a finalized
shift's ``total_hours`` silently undercounts a member's real time on scene
and that member's attendance row is left with ``call_count`` never set at
all.

The fix adds ``.with_for_update()`` to both queries.

This test uses two REAL, independently-committing sessions (not the
savepoint-based ``db_session`` fixture, which never truly commits and so
can never demonstrate cross-transaction visibility): session B establishes
its snapshot with a plain, non-locking shift preload (mimicking
``_authorize_shift_management``) *before* session A commits a fresh,
already-checked-out attendance row (the shape a closeout-attendance save
produces, not a check-in); session B then runs the real, unmodified
``finalize_shift`` and the test asserts the row's minutes were counted and
its ``call_count`` was set, by reading the table fresh from a third
session.
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


async def _make_org_two_users_ended_shift(session, slug):
    org = Organization(name="Race Test VFD", slug=slug)
    session.add(org)
    await session.flush()
    finalizer = User(
        organization_id=org.id,
        username=f"officer-{slug}",
        email=f"officer-{slug}@example.test",
        first_name="Jane",
        last_name="Doe",
        status=UserStatus.ACTIVE,
    )
    member = User(
        organization_id=org.id,
        username=f"ff-{slug}",
        email=f"ff-{slug}@example.test",
        first_name="John",
        last_name="Roe",
        status=UserStatus.ACTIVE,
    )
    session.add_all([finalizer, member])
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
    return org.id, finalizer.id, member.id, shift.id


async def _teardown(org_id, shift_id, finalizer_id, member_id):
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
            User.__table__.delete().where(User.id.in_([finalizer_id, member_id]))
        )
        await cleanup.execute(
            Organization.__table__.delete().where(Organization.id == org_id)
        )
        await cleanup.commit()
    finally:
        await cleanup.close()


class TestFinalizeShiftCountsAConcurrentlyCommittedCompletedAttendanceRow:
    async def test_finalize_shift_includes_a_closed_attendance_row_committed_after_its_snapshot(
        self, two_sessions
    ):
        session_a, session_b = two_sessions
        slug = f"ap-finalize-totals-{uuid.uuid4().hex[:12]}"
        org_id, finalizer_id, member_id, shift_id = (
            await _make_org_two_users_ended_shift(session_b, slug)
        )
        try:
            service_b = SchedulingService(session_b)

            # Session B: the plain, non-locking read _authorize_shift_management
            # does first. This is B's transaction's *first* consistent read,
            # which fixes its REPEATABLE READ snapshot right here -- before
            # session A's attendance row below is even created.
            preloaded = await service_b.get_shift_by_id(shift_id, uuid.UUID(org_id))
            assert preloaded is not None

            # Session A: a closeout-attendance-shaped write -- an
            # ALREADY-CHECKED-OUT row, not an open one, so it can never match
            # finding 8's open-attendance fix's predicate. Committed after
            # B's snapshot was already fixed above.
            checked_in = datetime.now(timezone.utc) - timedelta(hours=3)
            checked_out = checked_in + timedelta(hours=1)
            completed_attendance = ShiftAttendance(
                shift_id=shift_id,
                user_id=member_id,
                checked_in_at=checked_in,
                checked_out_at=checked_out,
                duration_minutes=60,
            )
            session_a.add(completed_attendance)
            await session_a.commit()

            # Session B: the real, unmodified finalize_shift. Its own shift
            # lock resolves immediately (A already committed and holds no
            # lock), but the totals/per-member queries are the ones under
            # test -- do they see A's row, or B's now-stale snapshot from
            # before A committed?
            finalized_shift, error = await service_b.finalize_shift(
                shift_id=shift_id,
                organization_id=uuid.UUID(org_id),
                finalized_by_user_id=finalizer_id,
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
                refreshed_shift = await verify.get(Shift, shift_id)
                assert refreshed_shift is not None
                assert refreshed_shift.total_hours == pytest.approx(1.0), (
                    "finalize_shift's total_hours snapshot missed a "
                    "concurrently-committed, already-checked-out attendance "
                    "row -- it used a REPEATABLE READ snapshot fixed before "
                    "the row committed instead of a current, locking read"
                )

                refreshed_attendance = await verify.get(
                    ShiftAttendance, completed_attendance.id
                )
                assert refreshed_attendance is not None
                assert refreshed_attendance.call_count is not None, (
                    "finalize_shift's per-member call_count snapshot never "
                    "touched this attendance row -- the all-attendance read "
                    "used a stale snapshot and skipped it entirely"
                )
            finally:
                await verify.close()
        finally:
            await session_a.rollback()
            await session_b.rollback()
            await _teardown(org_id, shift_id, finalizer_id, member_id)

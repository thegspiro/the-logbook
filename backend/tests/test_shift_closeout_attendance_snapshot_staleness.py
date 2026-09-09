"""AP-13 finding 8 (Codex, on top of finding 7) -- the sibling instance in
``save_closeout_attendance``, same shape as the ``finalize_shift`` case in
``test_shift_finalize_attendance_snapshot_staleness.py``: locking the shift
row (finding 7) does not refresh this transaction's REPEATABLE READ
snapshot for the ``ShiftAttendance`` table, which ``_authorize_shift_management``
fixed with its earlier plain shift query.

``save_closeout_attendance`` builds an ``existing`` dict of this shift's
attendance rows, keyed by user id, via a plain ``SELECT`` -- then, for any
submitted entry whose user id is *not* in that dict, inserts a brand new
``ShiftAttendance`` row (``shift_attendance`` carries no unique constraint
on ``(shift_id, user_id)`` to fall back on, per AP-13 finding 2). If a
member checks in (or is checked in) while a closeout-attendance save is
waiting on the shift lock a concurrent request briefly held, and that same
member is also in the closeout payload, the stale-snapshot ``existing``
read misses their just-committed row: ``existing.get(uid)`` returns
``None``, and the save inserts a *second* attendance row for a member who
already had one -- recreating the exact duplicate-row failure AP-13
finding 2 fixed, just reached through a stale read instead of a missing
lock.

The fix adds ``.with_for_update()`` to the ``existing`` query, so it
bypasses the stale snapshot and sees the latest committed attendance rows
once the shift lock resolves.

This test uses two REAL, independently-committing sessions (not the
savepoint-based ``db_session`` fixture, which never truly commits and so
can never demonstrate cross-transaction visibility): session B establishes
its snapshot with a plain, non-locking preload (mimicking
``_authorize_shift_management``) *before* session A commits a fresh
attendance row for a member also named in B's closeout payload; session B
then runs the real, unmodified ``save_closeout_attendance`` and the test
asserts no duplicate row was created.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

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


class TestSaveCloseoutAttendanceSeesAConcurrentlyCommittedAttendanceRow:
    async def test_save_closeout_attendance_does_not_duplicate_a_concurrent_check_in(
        self, two_sessions
    ):
        session_a, session_b = two_sessions
        slug = f"ap-closeout-att-snapshot-{uuid.uuid4().hex[:12]}"
        org_id, user_id, shift_id = await _make_org_user_shift(session_b, slug)
        try:
            service_b = SchedulingService(session_b)

            # Session B: the plain, non-locking read _authorize_shift_management
            # does first. This is B's transaction's *first* consistent read,
            # which fixes its REPEATABLE READ snapshot right here -- before
            # session A's attendance row below is even created.
            preloaded = await service_b.get_shift_by_id(shift_id, uuid.UUID(org_id))
            assert preloaded is not None

            # Session A: the member checks in and the row is committed --
            # after B's snapshot was already fixed above.
            now = datetime.now(timezone.utc)
            checked_in = ShiftAttendance(
                shift_id=shift_id,
                user_id=user_id,
                checked_in_at=now - timedelta(hours=1),
            )
            session_a.add(checked_in)
            await session_a.commit()

            # Session B: the real, unmodified save_closeout_attendance,
            # submitting an entry for the SAME member A just checked in --
            # exactly the scenario Codex named. If B's existing-rows read
            # misses A's row, this creates a second one instead of updating
            # the first.
            closeout_state, error = await service_b.save_closeout_attendance(
                shift_id=shift_id,
                organization_id=uuid.UUID(org_id),
                entries=[
                    {
                        "user_id": user_id,
                        "checked_in_at": now - timedelta(hours=1),
                        "checked_out_at": now,
                    }
                ],
            )
            assert error is None
            assert closeout_state is not None

            # Verify against the database directly: exactly one attendance
            # row for this member on this shift, not two.
            verify = database_manager.session_factory()
            try:
                rows = (
                    (
                        await verify.execute(
                            select(ShiftAttendance).where(
                                ShiftAttendance.shift_id == shift_id,
                                ShiftAttendance.user_id == user_id,
                            )
                        )
                    )
                    .scalars()
                    .all()
                )
                assert len(rows) == 1, (
                    "save_closeout_attendance created a duplicate attendance "
                    f"row ({len(rows)} found) -- its existing-rows read used "
                    "a REPEATABLE READ snapshot fixed before the concurrent "
                    "check-in committed instead of a current, locking read"
                )
                assert rows[0].checked_out_at is not None
            finally:
                await verify.close()
        finally:
            await session_a.rollback()
            await session_b.rollback()
            await _teardown(org_id, shift_id, user_id)

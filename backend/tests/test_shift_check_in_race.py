"""AP-13: ``SchedulingService.member_check_in`` is a read-then-write -- look
for an existing ``ShiftAttendance`` row, then insert one if there isn't --
and ``ShiftAttendance`` carries no unique constraint on
``(shift_id, user_id)``. Two check-ins landing at once (a bounced NFC tap at
a check-in station -- the exact station ``nfc_tag_service.py``'s
``_check_in_shift`` drives -- or the station racing the member's own phone)
could both read "no attendance yet" and both insert a row: the duplicate then
makes ``member_check_out``/``get_my_attendance``'s ``scalar_one_or_none()``
raise ``MultipleResultsFound`` the moment either is called next, taking a
routine check-out request down with an unhandled 500 rather than a domain
error.

Under InnoDB's default REPEATABLE READ, a plain SELECT answers from the
snapshot taken at the transaction's first read, and taking a row lock does
not refresh it (CLAUDE.md Pitfall #27). The fix locks the shift row
(``get_shift_by_id(..., for_update=True)`` -- the same parameter this file
already uses for the seat-capacity checks in ``request_to_join_shift``, per
its own docstring) *and* makes the ``ShiftAttendance`` existence check
itself a locking read, so a check-in that queues behind the shift lock
re-reads the latest committed attendance row instead of the stale one from
before it blocked.

This test uses two REAL, independently-committing sessions (not the
savepoint-based ``db_session`` fixture, which never truly commits and so can
never demonstrate cross-transaction visibility) to force the exact
interleaving.
"""

import asyncio
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
        start_time=now - timedelta(minutes=30),
        end_time=now + timedelta(hours=8),
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


class TestMemberCheckInIsALockingReadThenWrite:
    async def test_concurrent_check_ins_cannot_create_a_duplicate_attendance_row(
        self, two_sessions
    ):
        session_a, session_b = two_sessions
        slug = f"ap-checkin-race-{uuid.uuid4().hex[:12]}"
        org_id, user_id, shift_id = await _make_org_user_shift(session_a, slug)
        b_task = None
        try:
            service_a = SchedulingService(session_a)
            service_b = SchedulingService(session_b)

            # Session A: lock the shift row exactly as member_check_in's own
            # first step now does, simulating "the first tap is mid
            # check-in, has locked the shift, has not committed its
            # attendance insert yet."
            shift_a = await service_a.get_shift_by_id(
                shift_id, uuid.UUID(org_id), for_update=True
            )
            assert shift_a is not None

            # Session B: the second, bounced tap -- started while A's
            # transaction is still open. Post-fix, B's own locking read of
            # the shift must block on A's still-held row lock. Pre-fix,
            # get_shift_by_id is called without for_update inside
            # member_check_in and this whole test times out instead of
            # ever exercising the race -- itself a valid failure signal for
            # a test whose entire premise is that parameter being passed.
            lock_attempted = asyncio.Event()
            original_get = service_b.get_shift_by_id

            async def _tracking_get(*args, **kwargs):
                if kwargs.get("for_update"):
                    lock_attempted.set()
                return await original_get(*args, **kwargs)

            service_b.get_shift_by_id = _tracking_get

            b_task = asyncio.create_task(
                service_b.member_check_in(shift_id, user_id, uuid.UUID(org_id))
            )
            await asyncio.wait_for(lock_attempted.wait(), timeout=10)
            await asyncio.sleep(0.2)
            assert not b_task.done(), (
                "member_check_in should still be blocked on A's "
                "already-locked shift row"
            )

            # Session A completes what the first tap would have done --
            # insert the attendance row -- and commits, releasing the lock
            # B is waiting on.
            attendance_a = ShiftAttendance(
                shift_id=shift_id,
                user_id=user_id,
                checked_in_at=datetime.now(timezone.utc),
            )
            session_a.add(attendance_a)
            await session_a.commit()

            # B unblocks, re-reads the now-current attendance state via its
            # own locking read, and must recognise the row A just committed
            # as "already checked in" rather than inserting a second one --
            # a stale (pre-commit) snapshot is the only way B could miss it.
            record_b, error_b = await asyncio.wait_for(b_task, timeout=10)
            b_task = None
            assert record_b is None
            assert error_b == "Already checked in"

            # Read back with a third, fresh session so this assertion
            # cannot itself answer from either session's own snapshot.
            factory = database_manager.session_factory
            verifier = factory()
            try:
                rows = (
                    (
                        await verifier.execute(
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
                    "member_check_in created a duplicate ShiftAttendance row "
                    f"under a concurrent check-in -- found {len(rows)}"
                )
            finally:
                await verifier.close()
        finally:
            if b_task is not None and not b_task.done():
                b_task.cancel()
            for session in (session_a, session_b):
                await session.rollback()
            await _teardown(org_id, shift_id, user_id)

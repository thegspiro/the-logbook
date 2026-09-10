"""AP-13 finding 9 (Codex, on top of finding 8) -- the identity-map sibling
of finding 5, on ``ShiftAttendance`` rather than ``Shift``.
``NfcTagService._check_in_shift`` preloads the caller's attendance row with
a plain, non-locking ``get_my_attendance`` call *before* delegating to
``member_check_in`` on the same session -- exactly the
``_authorize_shift_management`` shape findings 5/6/8 already had to fix for
the ``Shift`` row itself. ``member_check_in``'s own locking read of that
same ``ShiftAttendance`` row (``with_for_update()``, added for finding 2)
genuinely blocks and genuinely reads the latest committed row at the
database level once it unblocks -- but without
``execution_options(populate_existing=True)``, SQLAlchemy's identity map
returns the earlier, already-loaded Python object unchanged rather than
repopulating its attributes from the freshly-locked row.

So a second NFC tap that queued behind a first tap's shift lock, and whose
session had already preloaded the same (at that point not-yet-checked-in)
attendance row via ``get_my_attendance``, would have its locking re-read
hand back the stale, still-``checked_in_at=None`` object even after the
first tap committed a real check-in time. The "Already checked in" guard
reads that stale ``None`` and passes, so the second tap overwrites the
first tap's timestamp and reports another successful check-in instead of
being rejected.

The fix adds ``.execution_options(populate_existing=True)`` to
``member_check_in``'s locking attendance read, mirroring finding 5's fix to
``get_shift_by_id``.

This test uses two REAL, independently-committing sessions (not the
savepoint-based ``db_session`` fixture, which never truly commits and so
can never demonstrate cross-transaction visibility): session B preloads the
attendance row plainly (mimicking ``_check_in_shift``'s own preload), then
session A performs and commits a real check-in for the same member/shift,
then session B runs the real, unmodified ``member_check_in`` and the test
asserts the second tap is rejected rather than silently overwriting the
first tap's check-in time.
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


async def _make_org_user_shift_with_placeholder_attendance(session, slug):
    """A pre-existing ShiftAttendance row with checked_in_at=None -- the
    shape a roster assignment or a checkout-only flow can leave behind, and
    the shape Codex's finding specifically named ("a pre-existing
    attendance row whose checked_in_at is still null"). Without this row
    already existing, member_check_in's own locking read is a first *load*
    of that primary key, not a *refresh* of an already-identity-mapped
    object -- the identity-map staleness this test exists to catch cannot
    occur at all in that shape.
    """
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
    await session.flush()
    placeholder = ShiftAttendance(
        shift_id=shift.id,
        user_id=user.id,
        checked_in_at=None,
    )
    session.add(placeholder)
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


class TestSecondCheckInSeesTheFirstCheckInDespiteAnEarlierPlainPreload:
    async def test_member_check_in_rejects_a_second_tap_after_a_stale_preload(
        self, two_sessions
    ):
        session_a, session_b = two_sessions
        slug = f"ap-checkin-idmap-{uuid.uuid4().hex[:12]}"
        org_id, user_id, shift_id = (
            await _make_org_user_shift_with_placeholder_attendance(session_b, slug)
        )
        try:
            service_a = SchedulingService(session_a)
            service_b = SchedulingService(session_b)

            # Session B: the plain, non-locking preload
            # NfcTagService._check_in_shift does via get_my_attendance,
            # before it ever delegates to member_check_in. The placeholder
            # row already exists (checked_in_at=None), so this caches that
            # real object in B's identity map -- this is B's transaction's
            # first consistent read, fixing its snapshot too.
            preloaded = await service_b.get_my_attendance(
                shift_id, user_id, uuid.UUID(org_id)
            )
            assert preloaded is not None
            assert preloaded.checked_in_at is None

            # Session A: the first NFC tap, a real, unmodified
            # member_check_in that locks the shift, creates the attendance
            # row, and commits.
            first_tap, first_error = await service_a.member_check_in(
                shift_id, user_id, uuid.UUID(org_id)
            )
            assert first_error is None
            assert first_tap is not None
            assert first_tap.checked_in_at is not None
            first_checked_in_at = first_tap.checked_in_at

            # Session B: the second NFC tap -- the real, unmodified
            # member_check_in, on the same session that preloaded "no
            # attendance yet" above. If it doesn't refresh that row on its
            # own locking read, it will see the stale checked_in_at=None
            # and report a second successful check-in.
            second_tap, second_error = await service_b.member_check_in(
                shift_id, user_id, uuid.UUID(org_id)
            )

            assert second_error == "Already checked in", (
                "member_check_in's locking attendance read returned a "
                "stale identity-map object instead of the freshly-locked, "
                "just-committed row -- the second tap silently overwrote "
                "the first tap's check-in instead of being rejected "
                f"(error={second_error!r}, result={second_tap!r})"
            )
            assert second_tap is None

            # Verify against the database directly: exactly one attendance
            # row, still checked in (not overwritten to some later time by
            # the rejected second tap).
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
                assert len(rows) == 1
                assert rows[0].checked_in_at is not None
                assert rows[0].checked_in_at <= first_checked_in_at + timedelta(
                    seconds=1
                )
            finally:
                await verify.close()
        finally:
            await session_a.rollback()
            await session_b.rollback()
            await _teardown(org_id, shift_id, user_id)

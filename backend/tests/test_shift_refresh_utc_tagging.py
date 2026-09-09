"""AP-13 finding 6 (Codex, on top of finding 5): the ``populate_existing=True``
fix in ``get_shift_by_id`` (finding 5) refreshes an already-identity-mapped
``Shift`` on a locking read -- correct, and necessary so the caller does not
read a stale ``is_finalized``. But refreshing an already-loaded object fires
SQLAlchemy's ``"refresh"`` event, not ``"load"``, and ``core/database.py``'s
UTC-tagging listener (``_on_load_stamp_utc``, now ``_stamp_utc`` shared by
both) was registered only on ``"load"``.

For the real REST path, ``_authorize_shift_management`` always loads the
shift with a plain, non-locking ``get_shift_by_id`` *first*, on the exact
same session the service method (``finalize_shift``, ``save_closeout_calls``)
then uses for its own ``for_update=True`` call. That first, plain load is
what stamps ``shift.end_time`` as UTC-aware in the first place (MySQL
``DATETIME`` has no tzinfo of its own). Without a matching ``"refresh"``
listener, the *second* read -- the locking one -- silently strips that
tzinfo back off, because ``set_committed_value`` from the first load is what
supplied it and nothing repeats that stamping on refresh.

The failure is not confined to the race scenario finding 5's own test
covers: it hits *every ordinary* ``finalize_shift`` call with a real
``end_time``, since the authorize-then-lock double read happens
unconditionally on the REST path. ``finalize_shift`` immediately compares
``shift.end_time > datetime.now(timezone.utc)`` -- a naive-vs-aware
comparison raises ``TypeError`` there, surfacing to the caller as a 500
instead of a normal finalize.

This test reproduces the exact shape of ``_authorize_shift_management`` +
``finalize_shift`` on one session -- no concurrency needed, since the bug
fires on a single ordinary request, not only under a race -- and asserts
both that ``end_time`` survives the refresh with tzinfo intact and that
``finalize_shift`` completes without raising.
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
async def one_session(_initialize_database):
    factory = database_manager.session_factory
    session = factory()
    try:
        yield session
    finally:
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


class TestLockingRefreshPreservesUtcTagging:
    async def test_locking_reread_keeps_end_time_tz_aware(self, one_session):
        """The narrow reproduction: preload (as _authorize_shift_management
        does), then re-read the same object with for_update=True (as the
        service method's own first line does), and confirm end_time is
        still tz-aware -- not just still equal in value."""
        slug = f"ap-refresh-utc-{uuid.uuid4().hex[:12]}"
        org_id, user_id, shift_id = await _make_org_user_ended_shift(one_session, slug)
        try:
            service = SchedulingService(one_session)

            preloaded = await service.get_shift_by_id(shift_id, uuid.UUID(org_id))
            assert preloaded is not None
            assert preloaded.end_time.tzinfo is not None, (
                "sanity check: the plain load's own UTC-tagging must have "
                "worked, or this test proves nothing about refresh"
            )

            relocked = await service.get_shift_by_id(
                shift_id, uuid.UUID(org_id), for_update=True
            )
            assert relocked is preloaded, (
                "expected the identity map to hand back the same object "
                "(populate_existing refreshing it in place), not a fresh "
                "instance -- otherwise this isn't exercising the refresh "
                "path at all"
            )
            assert relocked.end_time.tzinfo is not None, (
                "a locking re-read of an already-identity-mapped Shift "
                "stripped tzinfo off end_time -- the 'refresh' event fired "
                "without a UTC-tagging listener to catch it"
            )
        finally:
            await one_session.rollback()
            await _teardown(org_id, shift_id, user_id)

    async def test_finalize_shift_does_not_raise_after_authorize_preload(
        self, one_session
    ):
        """The end-to-end reproduction: mimic the real REST path's exact
        two-read shape on one session (authorize's plain load, then
        finalize_shift's own for_update=True read) and confirm finalize_shift
        completes normally instead of raising TypeError comparing a
        gone-naive end_time against datetime.now(timezone.utc)."""
        slug = f"ap-refresh-finalize-{uuid.uuid4().hex[:12]}"
        org_id, user_id, shift_id = await _make_org_user_ended_shift(one_session, slug)
        try:
            service = SchedulingService(one_session)

            # Mirrors _authorize_shift_management: a plain, non-locking load
            # on the same session finalize_shift will use.
            authorized = await service.get_shift_by_id(shift_id, uuid.UUID(org_id))
            assert authorized is not None

            finalized_shift, error = await service.finalize_shift(
                shift_id=shift_id,
                organization_id=uuid.UUID(org_id),
                finalized_by_user_id=user_id,
            )

            assert error is None
            assert finalized_shift is not None
            assert finalized_shift.is_finalized is True
        finally:
            await one_session.rollback()
            await _teardown(org_id, shift_id, user_id)

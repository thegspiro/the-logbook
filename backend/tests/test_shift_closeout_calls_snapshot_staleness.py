"""AP-13 finding 10 (Codex, on top of finding 8's deferred item): the
snapshot-staleness shape findings 8/9 fixed for ``ShiftAttendance`` had the
same gap in ``CallTrackingService._partition_existing``, which
``record_shift_calls`` uses to inventory a shift's existing
``OrgCall``/``OrgCallResponse`` rows before deciding how many new ones to
create. Its existence-check query was a plain ``SELECT`` on the same
transaction snapshot ``_authorize_shift_management``'s earlier plain shift
query fixes -- the shift lock `save_closeout_calls`/`finalize_shift` take
before calling in does not by itself refresh it.

So two closeout-calls saves racing on the same shift -- the second queued
behind the first's shift lock -- would have the second's `_partition_existing`
read still answer "no calls recorded yet" even after the first committed a
real one, doubling the shift's persisted call responses (and the
department's call-volume count) instead of reconciling to the same total.

The fix adds ``.with_for_update()`` to the existence-check query. (The
aggregate responder-count query later in the same method is left as a
narrower, documented follow-up: it classifies owned-vs-shared and does not
itself decide whether a *new* row gets created, so it does not produce the
doubling bug this test guards.)

This test uses two REAL, independently-committing sessions (not the
savepoint-based ``db_session`` fixture, which never truly commits and so
can never demonstrate cross-transaction visibility): session B preloads the
shift plainly first (mimicking ``_authorize_shift_management``), session A
runs a real ``save_closeout_calls`` reporting one call and commits, then
session B runs the same real, unmodified call and the test asserts the
shift still has exactly one ``OrgCall`` row, not two.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.core.database import database_manager
from app.models.call_tracking import OrgCall, OrgCallResponse
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
    # ``detailed`` default and the race under test still ran, which only meant
    # the endpoint was reachable from a mode that never reads what it writes.
    org = Organization(
        name="Race Test VFD",
        slug=slug,
        settings={"scheduling": {"call_tracking": {"mode": "count_only"}}},
    )
    session.add(org)
    await session.flush()
    user = User(
        organization_id=org.id,
        username=f"officer-{slug}",
        email=f"officer-{slug}@example.test",
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
        call_ids = (
            (
                await cleanup.execute(
                    select(OrgCallResponse.call_id).where(
                        OrgCallResponse.shift_id == shift_id
                    )
                )
            )
            .scalars()
            .all()
        )
        await cleanup.execute(
            OrgCallResponse.__table__.delete().where(
                OrgCallResponse.shift_id == shift_id
            )
        )
        if call_ids:
            await cleanup.execute(
                OrgCall.__table__.delete().where(OrgCall.id.in_(call_ids))
            )
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


class TestSaveCloseoutCallsSeesAConcurrentlyCommittedCallResponse:
    async def test_a_second_save_reconciles_instead_of_doubling_call_rows(
        self, two_sessions
    ):
        session_a, session_b = two_sessions
        slug = f"ap-closeout-calls-snapshot-{uuid.uuid4().hex[:12]}"
        org_id, user_id, shift_id = await _make_org_user_shift(session_b, slug)
        try:
            service_b = SchedulingService(session_b)

            # Session B: the plain, non-locking read _authorize_shift_management
            # does first. This is B's transaction's *first* consistent read,
            # which fixes its REPEATABLE READ snapshot right here -- before
            # session A's call rows below are even created.
            preloaded = await service_b.get_shift_by_id(shift_id, uuid.UUID(org_id))
            assert preloaded is not None

            # Session A: the first officer saves the closeout-calls step,
            # reporting one call. Real, unmodified save_closeout_calls, and
            # it commits.
            service_a = SchedulingService(session_a)
            state_a, error_a = await service_a.save_closeout_calls(
                shift_id=shift_id,
                organization_id=uuid.UUID(org_id),
                reported_call_count=1,
                count_provided=True,
                recorded_by=user_id,
            )
            assert error_a is None
            assert state_a is not None

            # Session B: the second officer re-saves the same step with the
            # same count -- the real, unmodified save_closeout_calls, on the
            # session that preloaded the shift before A's commit. If its
            # existing-calls read is stale, it will not see A's row and will
            # insert a second one instead of reconciling to the same total.
            state_b, error_b = await service_b.save_closeout_calls(
                shift_id=shift_id,
                organization_id=uuid.UUID(org_id),
                reported_call_count=1,
                count_provided=True,
                recorded_by=user_id,
            )
            assert error_b is None
            assert state_b is not None

            # Verify against the database directly, not either service's
            # identity map: exactly one OrgCall for this shift, not two.
            verify = database_manager.session_factory()
            try:
                call_ids = (
                    (
                        await verify.execute(
                            select(OrgCallResponse.call_id).where(
                                OrgCallResponse.shift_id == shift_id
                            )
                        )
                    )
                    .scalars()
                    .all()
                )
                assert len(set(call_ids)) == 1, (
                    "save_closeout_calls doubled the shift's call rows "
                    f"({len(set(call_ids))} distinct OrgCall found) -- "
                    "_partition_existing used a REPEATABLE READ snapshot "
                    "fixed before the first save committed instead of a "
                    "current, locking read"
                )
            finally:
                await verify.close()
        finally:
            await session_a.rollback()
            await session_b.rollback()
            await _teardown(org_id, shift_id, user_id)

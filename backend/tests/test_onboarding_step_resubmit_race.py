"""A wizard step submitted twice at once must not stack its own rows.

`/session/stations` and `/session/apparatus` write real rows and promise (their
docstrings say so) that re-submitting the step *replaces* what the previous pass
created rather than stacking duplicates. The promise is kept by reading the
previous pass's ids from `session.data` and deleting them first. That read is a
check-then-write on the onboarding session row (CLAUDE.md pitfall #27): two
submissions of the step -- a double-tap on "Next", or a client retry of a POST
that timed out after it was processed (pitfall #36) -- both read the same
`previous_ids`, both insert, and the session records only the last writer's ids.
The first writer's rows are then stacked next to the second's and are in nobody's
list to be replaced, so no later pass can remove them.

The fix serializes the two on the onboarding status row (the same parent the
organization and owner steps lock) and re-reads the session row with a locking
read, so the second submission sees the first one's ids.

The race needs two independently-committing connections, so this uses
`database_manager.engine.connect()` directly rather than the savepoint-wrapped
`db_session` fixture -- the arrangement of `test_onboarding_organization_race.py`.
"""

import asyncio
import inspect
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.api.v1 import onboarding as onboarding_api
from app.core.database import database_manager
from app.services.onboarding import OnboardingService


def _request(session_id: str, csrf: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/",
            "headers": [
                (b"x-session-id", session_id.encode()),
                (b"x-csrf-token", csrf.encode()),
            ],
            "client": ("127.0.0.1", 1),
        }
    )


@pytest.mark.unit
class TestTheLockIsDeclared:
    """A source-level guard, so the fix cannot be quietly reverted even where
    the DB-backed test below is not run."""

    @pytest.mark.parametrize(
        "handler",
        [onboarding_api.save_session_stations, onboarding_api.save_session_apparatus],
    )
    def test_the_step_locks_before_it_reads_the_previous_ids(self, handler):
        source = inspect.getsource(handler)
        assert "_lock_session_for_step(" in source
        assert source.index("_lock_session_for_step(") < source.index("previous_ids")

    def test_the_lock_is_a_locking_read_of_the_session_row(self):
        source = inspect.getsource(onboarding_api._lock_session_for_step)
        assert "OnboardingStatus" in source
        assert "with_for_update" in source
        assert "refresh(" in source


@pytest.mark.integration
@pytest.mark.asyncio
class TestConcurrentApparatusResubmission:
    async def test_two_simultaneous_submissions_leave_one_set_of_rows(self, db_session):
        # `db_session` is taken only for its `_initialize_database` dependency;
        # the race needs two independently-committing connections.
        marker = uuid.uuid4().hex[:8]
        org_id = str(uuid.uuid4())
        session_id = f"resubmit-{marker}"
        csrf = f"csrf-{marker}"

        async with database_manager.engine.connect() as setup_conn:
            async with setup_conn.begin():
                await setup_conn.execute(text("DELETE FROM onboarding_status"))
                await setup_conn.execute(
                    text(
                        "INSERT INTO onboarding_status "
                        "(id, singleton, current_step, steps_completed, "
                        "is_completed) VALUES (:id, 1, 1, '{}', 0)"
                    ),
                    {"id": str(uuid.uuid4())},
                )
                await setup_conn.execute(
                    text(
                        "INSERT INTO organizations (id, name, slug, active) "
                        "VALUES (:id, :name, :slug, 1)"
                    ),
                    {
                        "id": org_id,
                        "name": f"Resubmit {marker}",
                        "slug": f"resubmit-{marker}",
                    },
                )
                await setup_conn.execute(
                    text(
                        "INSERT INTO onboarding_sessions "
                        "(id, session_id, data, ip_address, expires_at) "
                        "VALUES (:id, :sid, :data, '127.0.0.1', :exp)"
                    ),
                    {
                        "id": str(uuid.uuid4()),
                        "sid": session_id,
                        "data": (
                            '{"csrf_token": "%s", "department": '
                            '{"organization_id": "%s"}}' % (csrf, org_id)
                        ),
                        "exp": datetime.now(timezone.utc) + timedelta(minutes=30),
                    },
                )

        arrivals = 0
        both_arrived = asyncio.Event()
        real = OnboardingService.replace_onboarding_apparatus

        async def meet_then_replace(self, *args, **kwargs):
            # Hold the first caller at the write long enough for a second one to
            # reach it. Without the lock both arrive; with it the second is
            # still waiting on the lock, so the first moves on after the wait.
            nonlocal arrivals
            arrivals += 1
            if arrivals >= 2:
                both_arrived.set()
            try:
                await asyncio.wait_for(both_arrived.wait(), timeout=1.0)
            except asyncio.TimeoutError:
                pass
            return await real(self, *args, **kwargs)

        body = onboarding_api.ApparatusListRequest(
            apparatus=[
                onboarding_api.ApparatusRequest(unit_number="E1", name="Engine 1")
            ]
        )

        async def attempt():
            async with database_manager.engine.connect() as conn:
                session = AsyncSession(bind=conn, expire_on_commit=False)
                try:
                    return await onboarding_api.save_session_apparatus(
                        _request(session_id, csrf), body, session
                    )
                finally:
                    await session.close()

        try:
            with patch.object(
                OnboardingService,
                "replace_onboarding_apparatus",
                meet_then_replace,
            ):
                await asyncio.gather(attempt(), attempt())

            async with database_manager.engine.connect() as check_conn:
                rows = (
                    await check_conn.execute(
                        text(
                            "SELECT id FROM basic_apparatus "
                            "WHERE organization_id = :org"
                        ),
                        {"org": org_id},
                    )
                ).fetchall()
                recorded = (
                    await check_conn.execute(
                        text(
                            "SELECT data FROM onboarding_sessions "
                            "WHERE session_id = :sid"
                        ),
                        {"sid": session_id},
                    )
                ).scalar()
            assert len(rows) == 1, (
                f"{len(rows)} apparatus rows exist after two simultaneous "
                "submissions of the same step, not 1 -- both read the same "
                "previous ids, so neither removed the other's rows"
            )
            assert str(rows[0][0]) in str(recorded), (
                "the surviving row is not the one the session records, so a "
                "later re-submission could not replace it"
            )
        finally:
            async with database_manager.engine.connect() as cleanup_conn:
                async with cleanup_conn.begin():
                    await cleanup_conn.execute(
                        text("DELETE FROM basic_apparatus WHERE organization_id = :o"),
                        {"o": org_id},
                    )
                    await cleanup_conn.execute(
                        text("DELETE FROM onboarding_sessions WHERE session_id = :s"),
                        {"s": session_id},
                    )
                    await cleanup_conn.execute(
                        text("DELETE FROM organizations WHERE id = :o"), {"o": org_id}
                    )
                    await cleanup_conn.execute(text("DELETE FROM onboarding_status"))

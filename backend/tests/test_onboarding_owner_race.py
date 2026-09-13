"""Two concurrent /system-owner calls must not both mint a wildcard owner.

`OnboardingService.create_system_owner` refused a *second* owner by reading
"does any user exist" and then creating one -- a read-then-write with nothing
serializing it, the same shape ONBOARD-7 fixed for `onboarding_status`
(CLAUDE.md pitfall #27).

The window to exploit it widened with the onboarding resumability fix
(`_require_owner_authority`, `docs/security-review/ONB3-30-onboarding.md`
pass 4 / `get_or_create_session`): before the System Owner exists, minting an
onboarding session is unauthenticated **by design** -- that is the documented
trade-off that makes a lapsed session resumable without database access. So an
unrelated caller can mint their own session any time between organization
creation (step 1) and System Owner creation (step 2) and race the real
operator's own `/system-owner` call. Two concurrent calls both used to read
"no user exists" and both created a full-access "*" account -- reproduced
against a real database (not mocked): 2/2 succeeded, two rows in `users`.

Fixed by locking the `onboarding_status` singleton row (the parent to lock,
per pitfall #27 -- there is no user row to lock yet, the same problem
ONBOARD-7 hit) and making the existence check itself a locking read, since
InnoDB's REPEATABLE READ answers a plain SELECT from this transaction's own
snapshot even once the lock is granted.

The race needs two independently-committing connections, so this uses
`database_manager.engine.connect()` directly rather than the shared,
savepoint-wrapped `db_session` fixture -- same arrangement as
`test_auth_lockout_race.py` and the AUTH-9/AUTH-13 tests next to it.
"""

import asyncio
import inspect
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import database_manager
from app.services.onboarding import OnboardingService

_PASSWORD = "Sup3rSecret!2026"


class TestTheLockIsDeclared:
    """A source-level guard, so the fix cannot be quietly reverted even if the
    DB-backed test below is skipped in an environment without MySQL."""

    def test_create_system_owner_locks_the_onboarding_status_row(self):
        source = inspect.getsource(OnboardingService.create_system_owner)
        reason = (
            "create_system_owner must lock the onboarding_status singleton "
            "row before checking whether a user already exists -- there is "
            "no user row to lock yet, so the parent row is the only thing "
            "that can serialize two concurrent callers."
        )
        assert "OnboardingStatus" in source, reason
        assert "with_for_update()" in source, reason

    def test_the_existence_check_is_itself_a_locking_read(self):
        source = inspect.getsource(OnboardingService.create_system_owner)
        # Not just *a* with_for_update() anywhere (the onboarding_status lock
        # above already satisfies that) -- the User.id existence check itself
        # must be a locking read. Otherwise the loser, having already taken
        # its own REPEATABLE READ snapshot, still sees zero users after
        # winning the onboarding_status lock and creates a second owner
        # anyway.
        assert "select(User.id).limit(1).with_for_update()" in source, (
            "the existing-user check must be a .with_for_update() locking "
            "read, not a plain SELECT -- otherwise the loser, having already "
            "taken its own snapshot, still sees zero users after winning "
            "the lock and creates a second owner anyway"
        )


@pytest.mark.integration
@pytest.mark.asyncio
class TestConcurrentSystemOwnerCreation:
    async def test_two_concurrent_callers_produce_exactly_one_owner(self, db_session):
        # `db_session` is taken only for its `_initialize_database`
        # dependency (connects `database_manager.engine`); the session
        # itself is unused, because losing this race needs two genuinely
        # independent, independently-committing connections and that
        # fixture's shared outer transaction would hide the commits from
        # each other. Same arrangement as test_auth_lockout_race.py.
        org_id = str(uuid.uuid4())

        async with database_manager.engine.connect() as setup_conn:
            async with setup_conn.begin():
                await setup_conn.execute(
                    text(
                        "INSERT INTO organizations "
                        "(id, name, organization_type, slug, timezone, active) "
                        "VALUES (:id, :name, :otype, :slug, :tz, 1)"
                    ),
                    {
                        "id": org_id,
                        "name": "Owner Race Test Dept",
                        "otype": "fire_department",
                        "slug": f"owner-race-{org_id[:8]}",
                        "tz": "UTC",
                    },
                )
                # `onboarding_status` is a real singleton (ONBOARD-7) -- clear
                # any row a prior run/test left behind before seeding this
                # test's own, rather than colliding with the unique index.
                await setup_conn.execute(text("DELETE FROM onboarding_status"))
                await setup_conn.execute(
                    text(
                        "INSERT INTO onboarding_status "
                        "(id, singleton, current_step, steps_completed, "
                        "organization_name, is_completed) "
                        "VALUES (:id, 1, 2, :steps, :org_name, 0)"
                    ),
                    {
                        "id": str(uuid.uuid4()),
                        "steps": '{"organization": {"step_number": 1}}',
                        "org_name": "Owner Race Test Dept",
                    },
                )

        try:

            async def attempt(label: str):
                async with database_manager.engine.connect() as conn:
                    session = AsyncSession(bind=conn, expire_on_commit=False)
                    service = OnboardingService(session)
                    try:
                        user = await service.create_system_owner(
                            organization_id=org_id,
                            username=f"racer-{label}",
                            email=f"{label}@race.test",
                            password=_PASSWORD,
                            first_name="Race",
                            last_name=label,
                        )
                        await session.commit()
                        return user
                    except ValueError:
                        await session.rollback()
                        return None
                    finally:
                        await session.close()

            results = await asyncio.gather(attempt("attacker"), attempt("legitimate"))
            successes = [r for r in results if r is not None]

            assert len(successes) == 1, (
                f"{len(successes)} concurrent /system-owner calls succeeded, "
                "not 1 -- two callers both read 'no user exists' and both "
                "created a wildcard-permission owner account. This is the "
                "exact race a first-run bootstrap route must never allow: "
                "an unauthenticated caller who wins it gets full admin "
                "access to the real, freshly-provisioned organization."
            )

            async with database_manager.engine.connect() as check_conn:
                count = (
                    await check_conn.execute(
                        text("SELECT COUNT(*) FROM users WHERE organization_id = :org"),
                        {"org": org_id},
                    )
                ).scalar()
            assert count == 1, (
                f"{count} users exist for the organization, not 1 -- a "
                "duplicate owner row was persisted even though only one "
                "caller reported success."
            )
        finally:
            async with database_manager.engine.connect() as cleanup_conn:
                async with cleanup_conn.begin():
                    # create_system_owner logs an audit event on success (the
                    # winner's, real and committed) -- clean it up too, or it
                    # outlives this test as an orphaned row once `organizations`
                    # is gone.
                    await cleanup_conn.execute(
                        text("DELETE FROM audit_logs WHERE organization_id = :org"),
                        {"org": org_id},
                    )
                    await cleanup_conn.execute(
                        text("DELETE FROM users WHERE organization_id = :org"),
                        {"org": org_id},
                    )
                    await cleanup_conn.execute(
                        text("DELETE FROM onboarding_status"),
                    )
                    await cleanup_conn.execute(
                        text("DELETE FROM organizations WHERE id = :org"),
                        {"org": org_id},
                    )

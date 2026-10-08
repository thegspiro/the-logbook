"""Two concurrent /organization calls must not both mint an organization.

`OnboardingService.create_organization` refused a *second* organization by
reading "does any organization exist" and then creating one -- the same
read-then-write shape ONB3-30-3 found and fixed one call below, in
`create_system_owner` (CLAUDE.md pitfall #27: "a capacity check is a
read-then-write and needs the row locked"), and the same shape ONBOARD-7 fixed
for `onboarding_status` itself.

The onboarding wizard's first step (`POST /organization` / `POST
/session/organization`) is unauthenticated by design -- that is true for
every caller before a System Owner exists, not merely the operator who
happens to be filling out the form. Two concurrent callers both used to read
"no organization exists" and both created one -- reproduced against a real
database (not mocked): 2/2 succeeded, two rows in `organizations`.

This is not merely a wasted row: `create_system_owner`'s own organization
lookup is "first active org, by `created_at`" (`onboarding.py`'s
`/system-owner` handler), so an attacker-created organization that wins this
race and happens to sort first can receive the *real* operator's own
System Owner account -- the operator fills out their own Organization and
System Owner forms, submits, and ends up an administrator of an organization
they never created, while the organization they described exists as an
orphaned second row nobody completes setup against.

Fixed the same way ONB3-30-3 was: lock the `onboarding_status` singleton row
(the parent to lock, per pitfall #27 -- there is no Organization row to lock
yet) and make the existence check itself a locking read, since InnoDB's
REPEATABLE READ answers a plain SELECT from this transaction's own snapshot
even once the lock is granted.

The race needs two independently-committing connections, so this uses
`database_manager.engine.connect()` directly rather than the shared,
savepoint-wrapped `db_session` fixture -- same arrangement as
`test_onboarding_owner_race.py` and `test_auth_lockout_race.py`.
"""

import asyncio
import inspect
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import database_manager
from app.services.onboarding import OnboardingService


class TestTheLockIsDeclared:
    """A source-level guard, so the fix cannot be quietly reverted even if the
    DB-backed test below is skipped in an environment without MySQL."""

    def test_create_organization_locks_the_onboarding_status_row(self):
        source = inspect.getsource(OnboardingService.create_organization)
        reason = (
            "create_organization must lock the onboarding_status singleton "
            "row before checking whether an organization already exists -- "
            "there is no organization row to lock yet, so the parent row is "
            "the only thing that can serialize two concurrent callers."
        )
        assert "OnboardingStatus" in source, reason
        assert "with_for_update()" in source, reason

    def test_the_existence_check_is_itself_a_locking_read(self):
        source = inspect.getsource(OnboardingService.create_organization)
        # Not just *a* with_for_update() anywhere (the onboarding_status lock
        # above already satisfies that) -- the Organization.id existence
        # check itself must be a locking read. Otherwise the loser, having
        # already taken its own REPEATABLE READ snapshot, still sees zero
        # organizations after winning the onboarding_status lock and creates
        # a second one anyway.
        assert "select(Organization.id).limit(1).with_for_update()" in source, (
            "the existing-organization check must be a .with_for_update() "
            "locking read, not a plain SELECT -- otherwise the loser, "
            "having already taken its own snapshot, still sees zero "
            "organizations after winning the lock and creates a second "
            "one anyway"
        )


@pytest.mark.integration
@pytest.mark.asyncio
class TestConcurrentOrganizationCreation:
    async def test_two_concurrent_callers_produce_exactly_one_organization(
        self, db_session
    ):
        # `db_session` is taken only for its `_initialize_database`
        # dependency (connects `database_manager.engine`); the session
        # itself is unused, because losing this race needs two genuinely
        # independent, independently-committing connections and that
        # fixture's shared outer transaction would hide the commits from
        # each other. Same arrangement as test_onboarding_owner_race.py.
        marker = uuid.uuid4().hex[:8]

        async with database_manager.engine.connect() as setup_conn:
            async with setup_conn.begin():
                # onboarding_status is a real singleton (ONBOARD-7) -- clear
                # any row a prior run/test left behind before seeding this
                # test's own, rather than colliding with the unique index.
                await setup_conn.execute(text("DELETE FROM onboarding_status"))
                await setup_conn.execute(
                    text(
                        "INSERT INTO onboarding_status "
                        "(id, singleton, current_step, steps_completed, "
                        "is_completed) "
                        "VALUES (:id, 1, 1, '{}', 0)"
                    ),
                    {"id": str(uuid.uuid4())},
                )

        try:

            async def attempt(label: str):
                async with database_manager.engine.connect() as conn:
                    session = AsyncSession(bind=conn, expire_on_commit=False)
                    service = OnboardingService(session)
                    try:
                        org = await service.create_organization(
                            name=f"Org Race Dept {label}",
                            slug=f"org-race-{marker}-{label}",
                        )
                        await session.commit()
                        return org.id
                    except ValueError:
                        await session.rollback()
                        return None
                    finally:
                        await session.close()

            results = await asyncio.gather(attempt("attacker"), attempt("legit"))
            successes = [r for r in results if r is not None]

            assert len(successes) == 1, (
                f"{len(successes)} concurrent /organization calls succeeded, "
                "not 1 -- two callers both read 'no organization exists' and "
                "both created one. This is the exact race a first-run "
                "bootstrap route must never allow: the loser's own System "
                "Owner creation could land on the winner's organization."
            )

            async with database_manager.engine.connect() as check_conn:
                count = (
                    await check_conn.execute(
                        text(
                            "SELECT COUNT(*) FROM organizations "
                            "WHERE slug LIKE :pattern"
                        ),
                        {"pattern": f"org-race-{marker}-%"},
                    )
                ).scalar()
            assert count == 1, (
                f"{count} organizations exist matching this test's slugs, "
                "not 1 -- a duplicate organization row was persisted even "
                "though only one caller reported success."
            )
        finally:
            async with database_manager.engine.connect() as cleanup_conn:
                async with cleanup_conn.begin():
                    await cleanup_conn.execute(
                        text("DELETE FROM organizations WHERE slug LIKE :pattern"),
                        {"pattern": f"org-race-{marker}-%"},
                    )
                    await cleanup_conn.execute(text("DELETE FROM onboarding_status"))

"""The account-lockout counter survives concurrent wrong-password attempts.

`AuthService.authenticate_user` counts a failed sign-in by reading
`failed_login_attempts` off the `user` object the unlocked `candidates` query
loaded, adding one, and committing. That is a read-modify-write on the field the
lockout threshold is measured against, and it was unlocked: N simultaneous wrong
passwords all read the same committed value, all write value+1, and the account
absorbs N guesses for the price of one increment.

Per-IP rate limiting does not cover this. Account lockout exists for the
*distributed* case — many sources, one account — where each source stays under
its own per-IP limit and only the per-account tally can see the total. Diluting
that tally is what makes the layer worth attacking.

This is the same shape as AUTH-9 (`_verify_and_consume_totp`) and AUTH-13
(`_verify_and_consume_recovery_code`), one layer up on the password step, and it
is fixed the same way: a `.with_for_update().execution_options(
populate_existing=True)` re-read inside the failure branch, taken *after* the
Argon2 verify so no user row is held for the ~100-300ms of a hash.

The race is reproduced with two real, independently-committing sessions against
a real row, matching the rigor of the AUTH-9/AUTH-13 tests in
`test_auth_mfa_endpoints.py` — a mocked session cannot show a lost update,
because there is no second connection to lose it to.
"""

import asyncio
import inspect
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import database_manager
from app.core.security import hash_password
from app.services.auth_service import AuthService

# Argon2 is deliberately slow, and that is what makes the unfixed race
# deterministic rather than lucky: both requests resolve the account and read
# the counter, then both spend ~100-300ms hashing before either writes. The
# overlap is not a narrow window to hit — it is the whole verify.
_PASSWORD = "CorrectHorseBatteryStaple1!"
_WRONG = "not-the-password-at-all-9!"


class TestTheLockIsDeclared:
    """A source-level guard, so the fix cannot be quietly reverted even if the
    DB-backed test below is skipped in an environment without MySQL."""

    def test_the_failure_branch_takes_a_locking_read(self):
        source = inspect.getsource(AuthService.authenticate_user)
        assert "with_for_update()" in source, (
            "authenticate_user must re-read the user row with a locking read "
            "before incrementing failed_login_attempts; without it two "
            "concurrent wrong passwords both write 1 and the lockout "
            "threshold is never reached."
        )
        assert "populate_existing=True" in source, (
            "The lock alone is not enough: expire_on_commit=False means the "
            "already-loaded user object is never expired, so without "
            "populate_existing the counter is re-read from the stale identity "
            "map while the row lock is held."
        )

    def test_the_lock_is_not_taken_around_the_password_verify(self):
        """Holding a user row across Argon2 would serialize that account's
        logins for the duration of every hash — a cheaper denial of service
        than the one the counter defends against. The lock must sit inside the
        failure branch, after the verify."""
        source = inspect.getsource(AuthService.authenticate_user)
        verify_at = source.index("verify_password(password, user.password_hash)")
        lock_at = source.index("with_for_update()")
        assert lock_at > verify_at, (
            "the locking read must come after the password verify, not before "
            "it — see this test's docstring for why"
        )


@pytest.mark.integration
@pytest.mark.asyncio
class TestConcurrentFailedLoginsBothCount:
    async def test_two_concurrent_wrong_passwords_increment_the_counter_twice(
        self, db_session
    ):
        # `db_session` is taken for its `_initialize_database` dependency, which
        # is what connects `database_manager.engine`; the session itself is
        # unused here because a lost update needs two independent connections,
        # and that fixture's outer transaction would hide the commits. Same
        # arrangement as the AUTH-9/AUTH-13 race tests next door.
        org_id = str(uuid.uuid4())
        user_id = str(uuid.uuid4())
        username = f"lockracer-{user_id[:8]}"

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
                        "name": "Lockout Race Test Dept",
                        "otype": "fire_department",
                        "slug": f"lockout-race-{org_id[:8]}",
                        "tz": "UTC",
                    },
                )
                # Organization.active is a Python-side default, not a server
                # default, so a raw INSERT that omits it stores NULL and
                # authenticate_user's `Organization.active.is_(True)` join
                # silently finds no candidate at all — the test would then pass
                # for the wrong reason, counting zero on both paths.
                await setup_conn.execute(
                    text(
                        "INSERT INTO users "
                        "(id, organization_id, username, first_name, last_name, "
                        "email, password_hash, status, failed_login_attempts) "
                        "VALUES (:id, :org, :un, :fn, :ln, :em, :pw, 'active', 0)"
                    ),
                    {
                        "id": user_id,
                        "org": org_id,
                        "un": username,
                        "fn": "Lockout",
                        "ln": "Racer",
                        "em": f"{username}@test.com",
                        "pw": hash_password(_PASSWORD),
                    },
                )

        try:

            async def attempt():
                async with database_manager.engine.connect() as conn:
                    session = AsyncSession(bind=conn, expire_on_commit=False)
                    user, message = await AuthService(session).authenticate_user(
                        username, _WRONG
                    )
                    await session.close()
                    return user, message

            results = await asyncio.gather(attempt(), attempt())
            assert all(user is None for user, _ in results), (
                "both attempts used the wrong password and must fail; a "
                "success here means the fixture is wrong, not the lock"
            )

            async with database_manager.engine.connect() as check_conn:
                counted = (
                    await check_conn.execute(
                        text("SELECT failed_login_attempts FROM users WHERE id = :id"),
                        {"id": user_id},
                    )
                ).scalar()

            assert counted == 2, (
                f"two concurrent failed sign-ins recorded {counted} failure(s), "
                "not 2. Both read the counter before either committed and both "
                "wrote the same value, so an attacker spreading guesses across "
                "connections advances the lockout threshold far more slowly "
                "than the attempt count — the per-account layer that exists "
                "for distributed guessing is diluted."
            )
        finally:
            async with database_manager.engine.connect() as cleanup_conn:
                async with cleanup_conn.begin():
                    await cleanup_conn.execute(
                        text("DELETE FROM users WHERE id = :id"), {"id": user_id}
                    )
                    await cleanup_conn.execute(
                        text("DELETE FROM organizations WHERE id = :id"),
                        {"id": org_id},
                    )

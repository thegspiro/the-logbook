"""A password-reset link is single-use even when it is submitted twice at once.

`AuthService.reset_password_with_token` looks the user up by the hash of the
emailed token, validates the new password, writes it, clears the token and
commits. The lookup was unlocked, so two submissions of the same link -- a
double-click, a retried POST, or an attacker holding a leaked link racing the
member who received it -- both read the live token before either cleared it.
Both pass validation, both set a password, both report success, and whichever
commits last owns the account while the other party was told theirs took.

"This link has already been used" is the guarantee the email promises, and it is
the same single-use shape the codebase already enforces for a TOTP code
(`_verify_and_consume_totp`) and a recovery code
(`_verify_and_consume_recovery_code`): re-read the row with a lock before
trusting what it holds. The re-read has to be a locking read for the reason
CLAUDE.md pitfall #27 gives -- under REPEATABLE READ a plain SELECT answers from
the snapshot taken at the transaction's first statement, so a lock alone would
still show the token the winner has just cleared.

The race needs two independently-committing connections, so this uses
`database_manager.engine.connect()` directly rather than the savepoint-wrapped
`db_session` fixture, as `test_auth_lockout_race.py` does.
"""

import asyncio
import hashlib
import inspect
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import database_manager
from app.core.security import hash_password
from app.services.auth_service import AuthService

_OLD_PASSWORD = "Old-Passw0rd!-for-the-race"
_PASSWORD_A = "Alpha-Reset-Passw0rd!-1"
_PASSWORD_B = "Bravo-Reset-Passw0rd!-2"


@pytest.mark.unit
class TestTheLockIsDeclared:
    """A source-level guard, so the fix cannot be quietly reverted where the
    DB-backed test below is not run."""

    def test_the_row_is_relocked_by_primary_key_and_reread(self):
        source = inspect.getsource(AuthService.reset_password_with_token)
        assert "User.id == user.id" in source
        locked = source[source.index("User.id == user.id") :]
        assert "with_for_update()" in locked.split("user = locked")[0], (
            "the reset-token row must be re-read with a lock so two "
            "submissions of one link cannot both find the token live"
        )
        assert "populate_existing" in locked.split("user = locked")[0], (
            "without populate_existing the re-read returns the row already "
            "loaded, and a winner's commit would not be seen"
        )

    def test_the_lock_is_not_taken_through_the_token_index(self):
        source = inspect.getsource(AuthService.reset_password_with_token)
        lookup = source[source.index("password_reset_token == token_hash") :]
        first = lookup.split("user = result")[0]
        assert "with_for_update" not in first, (
            "a locking read through the non-unique token index takes gap locks "
            "and deadlocks against the winner's UPDATE (error 1213)"
        )


@pytest.mark.integration
@pytest.mark.asyncio
class TestConcurrentResetSubmissions:
    async def test_one_link_set_twice_at_once_changes_the_password_once(
        self, db_session
    ):
        # `db_session` is taken only for its `_initialize_database` dependency.
        org_id = str(uuid.uuid4())
        user_id = str(uuid.uuid4())
        username = f"resetrace-{user_id[:8]}"
        raw_token = uuid.uuid4().hex + uuid.uuid4().hex
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()

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
                        "name": "Reset Race Test Dept",
                        "otype": "fire_department",
                        "slug": f"reset-race-{org_id[:8]}",
                        "tz": "UTC",
                    },
                )
                await setup_conn.execute(
                    text(
                        "INSERT INTO users "
                        "(id, organization_id, username, first_name, last_name, "
                        "email, password_hash, status, password_reset_token, "
                        "password_reset_expires_at) "
                        "VALUES (:id, :org, :un, :fn, :ln, :em, :pw, 'active', "
                        ":tok, :exp)"
                    ),
                    {
                        "id": user_id,
                        "org": org_id,
                        "un": username,
                        "fn": "Reset",
                        "ln": "Racer",
                        "em": f"{username}@test.com",
                        "pw": hash_password(_OLD_PASSWORD),
                        "tok": token_hash,
                        "exp": datetime.now(timezone.utc) + timedelta(minutes=30),
                    },
                )

        arrivals = 0
        both_arrived = asyncio.Event()

        async def meet_then_pass(_password):
            # Holds the first caller past the token lookup long enough for a
            # second to reach the same point. Unlocked, both arrive and both
            # proceed; locked, the second is still waiting on the row, so the
            # first moves on after the wait and the second then finds no token.
            nonlocal arrivals
            arrivals += 1
            if arrivals >= 2:
                both_arrived.set()
            try:
                await asyncio.wait_for(both_arrived.wait(), timeout=1.0)
            except asyncio.TimeoutError:
                pass
            return True, None

        async def submit(new_password: str):
            async with database_manager.engine.connect() as conn:
                session = AsyncSession(bind=conn, expire_on_commit=False)
                try:
                    return await AuthService(session).reset_password_with_token(
                        raw_token, new_password
                    )
                finally:
                    await session.close()

        try:
            with patch(
                "app.services.auth_service.check_password_not_breached",
                meet_then_pass,
            ):
                results = await asyncio.gather(submit(_PASSWORD_A), submit(_PASSWORD_B))

            succeeded = [ok for ok, _ in results if ok]
            assert len(succeeded) == 1, (
                f"{len(succeeded)} of 2 simultaneous submissions of one reset "
                "link reported success, not 1. Both read the live token before "
                "either cleared it, so a link that is meant to work once set "
                "two passwords and the later commit silently won the account."
            )

            async with database_manager.engine.connect() as check_conn:
                token = (
                    await check_conn.execute(
                        text("SELECT password_reset_token FROM users WHERE id = :i"),
                        {"i": user_id},
                    )
                ).scalar()
            assert token is None
        finally:
            async with database_manager.engine.connect() as cleanup_conn:
                async with cleanup_conn.begin():
                    await cleanup_conn.execute(
                        text("DELETE FROM password_history WHERE user_id = :i"),
                        {"i": user_id},
                    )
                    await cleanup_conn.execute(
                        text("DELETE FROM users WHERE id = :i"), {"i": user_id}
                    )
                    await cleanup_conn.execute(
                        text("DELETE FROM organizations WHERE id = :i"),
                        {"i": org_id},
                    )

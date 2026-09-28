"""A correct password must not clear an MFA account's failed-attempt counter.

`mfa_login` adds each wrong second-factor code to `failed_login_attempts`, the
same counter the password step locks the account on. `authenticate_user`
reset that counter on any correct password, so for an MFA account the tally
never reached the lockout threshold: whoever held the password could guess
four codes, sign in again, and guess four more, indefinitely. Found driving
workflow review W04 — three wrong codes, then a correct password, and the
stored counter read 0.

For an MFA account the password step is not full authentication, so it must
leave the counter alone; `mfa_login` clears it once the second factor
succeeds. A password-only account still resets on a correct password.
"""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import database_manager
from app.core.security import hash_password
from app.services.auth_service import AuthService

_PASSWORD = "CorrectHorseBatteryStaple1!"


async def _counter_after_correct_password(mfa_enabled: bool) -> int:
    org_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    username = f"mfareset-{user_id[:8]}"

    async with database_manager.engine.connect() as setup_conn:
        async with setup_conn.begin():
            # `active` is a Python-side default, so a raw INSERT must set it
            # or authenticate_user's `Organization.active.is_(True)` join finds
            # no candidate and the test passes for the wrong reason.
            await setup_conn.execute(
                text(
                    "INSERT INTO organizations "
                    "(id, name, organization_type, slug, timezone, active) "
                    "VALUES (:id, :name, :otype, :slug, :tz, 1)"
                ),
                {
                    "id": org_id,
                    "name": "MFA Lockout Reset Dept",
                    "otype": "fire_department",
                    "slug": f"mfa-reset-{org_id[:8]}",
                    "tz": "UTC",
                },
            )
            await setup_conn.execute(
                text(
                    "INSERT INTO users "
                    "(id, organization_id, username, first_name, last_name, "
                    "email, password_hash, status, failed_login_attempts, "
                    "mfa_enabled) "
                    "VALUES (:id, :org, :un, 'Mfa', 'Reset', :em, :pw, "
                    "'active', 3, :mfa)"
                ),
                {
                    "id": user_id,
                    "org": org_id,
                    "un": username,
                    "em": f"{username}@test.com",
                    "pw": hash_password(_PASSWORD),
                    "mfa": 1 if mfa_enabled else 0,
                },
            )

    try:
        async with database_manager.engine.connect() as conn:
            session = AsyncSession(bind=conn, expire_on_commit=False)
            user, message = await AuthService(session).authenticate_user(
                username, _PASSWORD
            )
            assert user is not None, f"correct password was refused: {message}"
            await session.commit()
            await session.close()

        async with database_manager.engine.connect() as check_conn:
            return (
                await check_conn.execute(
                    text("SELECT failed_login_attempts FROM users WHERE id = :id"),
                    {"id": user_id},
                )
            ).scalar()
    finally:
        async with database_manager.engine.connect() as cleanup_conn:
            async with cleanup_conn.begin():
                await cleanup_conn.execute(
                    text("DELETE FROM users WHERE id = :id"), {"id": user_id}
                )
                await cleanup_conn.execute(
                    text("DELETE FROM organizations WHERE id = :id"), {"id": org_id}
                )


@pytest.mark.integration
class TestPasswordStepAndTheLockoutCounter:
    # `db_session` is taken for its `_initialize_database` dependency, which
    # connects `database_manager.engine`; the writes need their own committed
    # connections, which that fixture's outer transaction would hide.

    async def test_mfa_account_keeps_its_failed_code_count(self, db_session):
        counted = await _counter_after_correct_password(mfa_enabled=True)
        assert counted == 3, (
            f"a correct password reset an MFA account's counter to {counted}; "
            "failed second-factor codes must keep counting toward the lockout "
            "until the second factor succeeds"
        )

    async def test_password_only_account_still_resets(self, db_session):
        assert await _counter_after_correct_password(mfa_enabled=False) == 0

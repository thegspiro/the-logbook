"""
A retried recovery-code request gets the codes it already issued (AUTH-7).

Regenerating recovery codes, or confirming MFA setup, commits a new set and
shows it once. If that response never reached the member, retrying failed on
the spent authenticator code, and a fresh code issued and stored another set:
either way the codes that worked were codes nobody had read. A request that
carries an ``Idempotency-Key`` is now answered, on retry, with the set it
already issued, for that member, that endpoint and that code only, and only
while the set is still the live one.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pyotp
import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.auth import (
    CodedHTTPException,
    mfa_regenerate_recovery_codes,
    mfa_verify_setup,
)
from app.core import issued_secrets
from app.schemas.auth import MFAVerify
from app.services import mfa_service

pytestmark = pytest.mark.unit

_KEY = "5b0d2a3e-8c1f-4f7e-9a61-0d8e2b7c4f19"


def _user(**overrides):
    defaults = dict(
        id="user-1",
        organization_id="org-1",
        email="member@test.com",
        username="member",
        mfa_enabled=True,
        mfa_secret=mfa_service.generate_secret(),
        mfa_last_timestep=None,
        mfa_backup_codes=[],
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _db_for(user):
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=user)
    db = MagicMock()
    db.execute = AsyncMock(return_value=result)
    db.commit = AsyncMock()
    db.flush = AsyncMock()
    return db


@pytest.fixture(autouse=True)
def _local_store():
    """Use the per-process store, empty, whatever Redis the host has."""
    issued_secrets.reset_local_store()
    offline = SimpleNamespace(is_connected=False, redis_client=None)
    with (
        patch.object(issued_secrets, "cache_manager", offline),
        patch("app.api.v1.endpoints.auth.log_audit_event", new=AsyncMock()),
        patch("app.api.v1.endpoints.auth.notify_security_event", new=AsyncMock()),
    ):
        yield
    issued_secrets.reset_local_store()


async def _regenerate(user, code, key=_KEY):
    return await mfa_regenerate_recovery_codes(
        data=MFAVerify(code=code),
        background_tasks=MagicMock(),
        current_user=user,
        db=_db_for(user),
        idempotency_key=key,
    )


class TestRegenerateRetry:
    async def test_a_retry_returns_the_set_already_issued(self):
        user = _user()
        code = pyotp.TOTP(user.mfa_secret).now()

        first = await _regenerate(user, code)
        retry = await _regenerate(user, code)

        assert retry == first
        # The set the retry shows is the one that works.
        assert set(user.mfa_backup_codes) == {
            mfa_service.hash_recovery_code(c) for c in first["recovery_codes"]
        }

    async def test_a_retry_does_not_issue_another_set(self):
        user = _user()
        code = pyotp.TOTP(user.mfa_secret).now()
        await _regenerate(user, code)

        with patch.object(
            mfa_service,
            "generate_recovery_codes",
            wraps=mfa_service.generate_recovery_codes,
        ) as generate:
            await _regenerate(user, code)

        generate.assert_not_called()

    async def test_without_a_key_a_retry_still_fails_on_the_spent_code(self):
        user = _user()
        code = pyotp.TOTP(user.mfa_secret).now()
        await _regenerate(user, code, key=None)

        with pytest.raises(CodedHTTPException) as exc:
            await _regenerate(user, code, key=None)
        assert exc.value.status_code == 400

    async def test_the_key_with_a_different_code_is_refused(self):
        user = _user()
        code = pyotp.TOTP(user.mfa_secret).now()
        await _regenerate(user, code)

        other = "000000" if code != "000000" else "111111"
        with pytest.raises(HTTPException) as exc:
            await _regenerate(user, other)
        assert exc.value.status_code == 422

    async def test_another_member_with_the_same_key_gets_nothing_back(self):
        owner, other = _user(), _user(id="user-2")
        await _regenerate(owner, pyotp.TOTP(owner.mfa_secret).now())

        other_code = pyotp.TOTP(other.mfa_secret).now()
        result = await _regenerate(other, other_code)

        assert set(other.mfa_backup_codes) == {
            mfa_service.hash_recovery_code(c) for c in result["recovery_codes"]
        }
        assert set(other.mfa_backup_codes).isdisjoint(owner.mfa_backup_codes)

    async def test_a_set_replaced_since_is_not_replayed(self):
        user = _user()
        code = pyotp.TOTP(user.mfa_secret).now()
        await _regenerate(user, code)
        # A later regeneration replaced the set; the remembered one no
        # longer works and must not be shown as if it did.
        user.mfa_backup_codes = [mfa_service.hash_recovery_code("replaced-set")]

        with pytest.raises(CodedHTTPException):
            await _regenerate(user, code)

    async def test_spending_one_code_does_not_make_the_set_stale(self):
        user = _user()
        code = pyotp.TOTP(user.mfa_secret).now()
        first = await _regenerate(user, code)
        user.mfa_backup_codes = user.mfa_backup_codes[1:]

        assert await _regenerate(user, code) == first

    async def test_a_malformed_key_is_refused(self):
        user = _user()
        with pytest.raises(HTTPException) as exc:
            await _regenerate(user, pyotp.TOTP(user.mfa_secret).now(), key="a b")
        assert exc.value.status_code == 400


class TestVerifySetupRetry:
    async def test_a_retry_after_mfa_was_enabled_returns_the_same_codes(self):
        user = _user(mfa_enabled=False)
        code = pyotp.TOTP(user.mfa_secret).now()

        async def confirm():
            return await mfa_verify_setup(
                data=MFAVerify(code=code),
                background_tasks=MagicMock(),
                current_user=user,
                db=_db_for(user),
                idempotency_key=_KEY,
            )

        first = await confirm()
        assert user.mfa_enabled is True
        assert await confirm() == first

    async def test_a_setup_key_does_not_answer_a_regeneration(self):
        user = _user(mfa_enabled=False)
        code = pyotp.TOTP(user.mfa_secret).now()
        await mfa_verify_setup(
            data=MFAVerify(code=code),
            background_tasks=MagicMock(),
            current_user=user,
            db=_db_for(user),
            idempotency_key=_KEY,
        )

        # Same key and code at the other endpoint: the code is spent and
        # nothing is replayed across scopes.
        with pytest.raises(CodedHTTPException):
            await _regenerate(user, code)


class TestStore:
    async def test_the_codes_are_not_stored_in_plaintext(self):
        user = _user()
        result = await _regenerate(user, pyotp.TOTP(user.mfa_secret).now())

        stored = [sealed for _, sealed in issued_secrets._local.values()]
        assert len(stored) == 1
        for plain in result["recovery_codes"]:
            assert plain not in stored[0]

    async def test_the_local_store_is_bounded(self):
        cap = issued_secrets._LOCAL_MAX_ENTRIES
        for index in range(cap + 5):
            await issued_secrets.remember(
                user_id=f"user-{index}",
                scope="s",
                key=_KEY,
                body="123456",
                response={"recovery_codes": []},
            )
        assert len(issued_secrets._local) == cap

    async def test_redis_is_used_when_connected(self):
        stored = {}

        class FakeRedis:
            async def get(self, key):
                return stored.get(key)

            async def setex(self, key, ttl, value):
                assert ttl == issued_secrets.REPLAY_WINDOW_SECONDS
                stored[key] = value

        online = SimpleNamespace(is_connected=True, redis_client=FakeRedis())
        with patch.object(issued_secrets, "cache_manager", online):
            await issued_secrets.remember(
                user_id="u",
                scope="s",
                key=_KEY,
                body="123456",
                response={"recovery_codes": ["a"]},
            )
            recalled = await issued_secrets.recall(
                user_id="u", scope="s", key=_KEY, body="123456"
            )

        assert recalled == {"recovery_codes": ["a"]}
        assert len(stored) == 1

    assert not issued_secrets._local

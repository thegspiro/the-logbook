"""Refused sign-ins cost one Argon2 verification, the same as a wrong password.

The unknown-user, no-password and locked-account branches used to run
``verify_password(..., hash_password(...))``: a hash *and* a verify, about
twice the wrong-password path's single verify. Measured on this code that was
128 ms against 77 ms — a gap an outsider could use to tell which member emails
have accounts, inside the rate limits. Each branch now spends exactly one
verification against a hash built once.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core import security
from app.services.auth_service import AuthService

pytestmark = pytest.mark.unit


def _db(*results):
    db = AsyncMock()
    db.execute.side_effect = list(results)
    return db


def _no_org():
    result = MagicMock()
    result.scalar_one_or_none.return_value = None
    return result


def _candidates(*users):
    result = MagicMock()
    result.scalars.return_value.all.return_value = list(users)
    return result


def _account(**fields):
    base = dict(
        id="user-1",
        organization_id="org-1",
        password_hash="$argon2id$stored",
        locked_until=None,
    )
    base.update(fields)
    return SimpleNamespace(**base)


@pytest.fixture
def hasher():
    """Count Argon2 work without paying for it."""
    fake = MagicMock()
    fake.hash.return_value = "$argon2id$dummy"
    fake.verify.side_effect = security.VerifyMismatchError()
    fake.check_needs_rehash.return_value = False
    security._dummy_password_hash.cache_clear()
    with patch.object(security, "password_hasher", fake):
        # The dummy is built on first use; build it here so the attempts
        # below are measured on the steady state every request after the
        # first one sees.
        security.burn_password_verification("warm-up")
        fake.reset_mock()
        yield fake
    security._dummy_password_hash.cache_clear()


async def _attempt(db):
    return await AuthService(db).authenticate_user("someone@fd.example", "guess")


async def test_an_unknown_user_costs_one_verification(hasher):
    user, error = await _attempt(_db(_no_org(), _candidates()))

    assert (user, error) == (None, "Incorrect username or password")
    assert hasher.verify.call_count == 1
    hasher.hash.assert_not_called()


async def test_an_account_with_no_password_costs_one_verification(hasher):
    await _attempt(_db(_no_org(), _candidates(_account(password_hash=None))))

    assert hasher.verify.call_count == 1
    hasher.hash.assert_not_called()


async def test_a_locked_account_costs_one_verification(hasher):
    locked = _account(locked_until=datetime.now(timezone.utc) + timedelta(minutes=5))

    with patch("app.services.auth_service.settings.ACCOUNT_LOCKOUT_REVEAL", False):
        _, error = await _attempt(_db(_no_org(), _candidates(locked)))

    assert error == "Incorrect username or password"
    assert hasher.verify.call_count == 1
    hasher.hash.assert_not_called()


def test_the_dummy_hash_is_built_once(hasher):
    for _ in range(3):
        security.burn_password_verification("guess")

    hasher.hash.assert_not_called()
    assert hasher.verify.call_count == 3

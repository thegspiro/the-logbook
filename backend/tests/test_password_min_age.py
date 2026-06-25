"""
Regression tests for the minimum-password-age check in
AuthService.change_password (DB-light).

A user created by an admin (or via self-registration) gets
``must_change_password=True`` together with a fresh ``password_changed_at``
timestamp. The HIPAA minimum-password-age policy must NOT block that mandatory
first change, otherwise the user is locked out of completing setup. For a
normal (non-forced) change, the policy must still be enforced.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

import app.services.auth_service as auth_module
from app.core.config import settings
from app.core.security import hash_password
from app.services.auth_service import AuthService

CURRENT_PASSWORD = "OldP@ssw0rd2024"
NEW_PASSWORD = "NewP@ssw0rd2025"


@pytest.fixture(autouse=True)
def _min_age_enabled(monkeypatch):
    # Ensure the policy is active (>0) regardless of environment overrides.
    monkeypatch.setattr(settings, "HIPAA_MINIMUM_PASSWORD_AGE_DAYS", 1)


@pytest.fixture
def _patched_helpers(monkeypatch):
    """Stub out the DB-touching helpers so change_password runs in isolation."""
    monkeypatch.setattr(
        auth_module, "_check_password_history", AsyncMock(return_value=False)
    )
    monkeypatch.setattr(
        auth_module, "_save_password_to_history", AsyncMock(return_value=None)
    )


def _recent_user(**kw):
    """A user whose password was 'just' set (fails the min-age window)."""
    defaults = dict(
        id="u1",
        username="alice",
        password_hash=hash_password(CURRENT_PASSWORD),
        password_changed_at=datetime.now(timezone.utc),
        must_change_password=False,
        failed_login_attempts=0,
        locked_until=None,
    )
    defaults.update(kw)
    return SimpleNamespace(**defaults)


def _service():
    db = MagicMock()
    db.commit = AsyncMock()
    svc = AuthService(db)
    # Session revocation hits the DB; not under test here.
    svc._revoke_all_user_sessions = AsyncMock(return_value=0)
    return svc


@pytest.mark.unit
async def test_forced_change_bypasses_minimum_age(_patched_helpers):
    """must_change_password=True must skip the minimum-age block."""
    user = _recent_user(must_change_password=True)
    svc = _service()

    success, error = await svc.change_password(
        user=user,
        current_password=CURRENT_PASSWORD,
        new_password=NEW_PASSWORD,
    )

    assert success is True
    assert error is None
    # The mandatory-change flag is cleared once the change completes.
    assert user.must_change_password is False


@pytest.mark.unit
async def test_normal_change_still_enforces_minimum_age(_patched_helpers):
    """A non-forced change within the window is still rejected."""
    user = _recent_user(must_change_password=False)
    svc = _service()

    success, error = await svc.change_password(
        user=user,
        current_password=CURRENT_PASSWORD,
        new_password=NEW_PASSWORD,
    )

    assert success is False
    assert error is not None
    assert "recently" in error.lower()

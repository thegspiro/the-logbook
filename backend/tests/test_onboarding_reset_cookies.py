"""A reset clears the auth cookies of the account it deletes.

``POST /onboarding/reset`` deletes every user, including the system owner who
pressed the button, but left that owner's auth cookies in the browser. Every
request after it then carried credentials for a user that no longer existed,
and ``/onboarding/start`` refuses invalid credentials rather than treating
them as anonymous — so the wizard could not begin again, and its retrying
hammered the endpoint into its rate limit (workflow review W01-10).
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.v1 import onboarding as onboarding_ep

pytestmark = pytest.mark.unit


async def _reset():
    db = MagicMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    with patch.object(
        onboarding_ep.OnboardingService,
        "get_onboarding_status",
        new=AsyncMock(return_value=SimpleNamespace(is_completed=False)),
    ), patch.object(onboarding_ep, "validate_session", new=AsyncMock()), patch.object(
        onboarding_ep, "_require_owner_authority", new=AsyncMock()
    ), patch(
        "app.core.audit.log_audit_event", new=AsyncMock()
    ):
        return await onboarding_ep.reset_onboarding(
            request=MagicMock(), db=db, current_user=None
        )


def _expired_cookies(response) -> dict[str, list[str]]:
    """Cookie name -> the Set-Cookie headers that expire it."""
    expired: dict[str, list[str]] = {}
    for name, value in response.raw_headers:
        if name.decode().lower() != "set-cookie":
            continue
        header = value.decode()
        if "Max-Age=0" in header or "expires=Thu, 01 Jan 1970" in header:
            expired.setdefault(header.split("=", 1)[0], []).append(header)
    return expired


async def test_reset_expires_the_auth_cookies():
    response = await _reset()

    expired = _expired_cookies(response)
    assert "access_token" in expired
    assert "refresh_token" in expired
    assert "csrf_token" in expired


async def test_reset_still_reports_success():
    response = await _reset()

    assert response.status_code == 200
    assert b'"success":true' in response.body

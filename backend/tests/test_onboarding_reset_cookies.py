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
    ), patch.object(
        onboarding_ep, "_audit_reset_durably", new=AsyncMock()
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


# ONB-8: the attempt is committed to the audit log before anything is deleted.


def _db(fail_delete=False):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=RuntimeError("FK") if fail_delete else None)
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    return db


async def _reset_with(db, audit):
    with patch.object(
        onboarding_ep.OnboardingService,
        "get_onboarding_status",
        new=AsyncMock(return_value=SimpleNamespace(is_completed=False)),
    ), patch.object(onboarding_ep, "validate_session", new=AsyncMock()), patch.object(
        onboarding_ep, "_require_owner_authority", new=AsyncMock()
    ), patch(
        "app.core.audit.log_audit_event", new=AsyncMock()
    ), patch.object(
        onboarding_ep, "_audit_reset_durably", new=audit
    ):
        return await onboarding_ep.reset_onboarding(
            request=MagicMock(), db=db, current_user=None
        )


async def test_no_durable_audit_record_means_no_reset():
    from fastapi import HTTPException

    db = _db()
    audit = AsyncMock(side_effect=RuntimeError("audit down"))

    with pytest.raises(HTTPException) as exc:
        await _reset_with(db, audit)

    assert exc.value.status_code == 500
    db.execute.assert_not_awaited()
    db.commit.assert_not_awaited()


async def test_the_attempt_is_recorded_before_the_first_delete():
    db = _db()
    order = []
    audit = AsyncMock(side_effect=lambda *a, **k: order.append("audit"))
    db.execute = AsyncMock(side_effect=lambda *a, **k: order.append("delete"))

    await _reset_with(db, audit)

    assert order[0] == "audit"
    assert audit.await_args_list[0].args[0] == "onboarding.reset_initiated"


async def test_a_failed_reset_is_recorded_durably_too():
    from fastapi import HTTPException

    db = _db(fail_delete=True)
    audit = AsyncMock()

    with pytest.raises(HTTPException):
        await _reset_with(db, audit)

    events = [call.args[0] for call in audit.await_args_list]
    assert events == ["onboarding.reset_initiated", "onboarding.reset_failed"]
    db.rollback.assert_awaited()

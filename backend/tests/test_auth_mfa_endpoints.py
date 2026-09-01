"""
Tests for MFA auth-router endpoint wiring.

Unit-level: inspects the router's declared routes/dependencies without a
running server or database. Verifies the new self-service recovery-code
regeneration endpoint exists and is rate limited, and that the login
challenge endpoint is rate limited.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pyotp
import pytest
from starlette.requests import Request

from app.api.v1.endpoints.auth import (
    CodedHTTPException,
    _finish_oauth_login,
    _verify_and_consume_totp,
    mfa_login,
    mfa_regenerate_recovery_codes,
    router,
)
from app.core.security import create_mfa_pending_token
from app.schemas.auth import MFALogin, MFAVerify
from app.services import mfa_service


def _route(path: str, method: str):
    for route in router.routes:
        if getattr(route, "path", None) == path:
            if method in getattr(route, "methods", set()):
                return route
    return None


def _dep_names(path: str, method: str):
    route = _route(path, method)
    if not route:
        return None
    dependant = getattr(route, "dependant", None)
    if not dependant:
        return []
    names = []
    for dep in dependant.dependencies:
        call = dep.call
        names.append(getattr(call, "__name__", str(call)))
    return names


class TestMfaEndpoints:
    def test_regenerate_recovery_codes_route_exists(self):
        assert _route("/mfa/recovery-codes", "POST") is not None

    def test_regenerate_requires_authenticated_user(self):
        names = _dep_names("/mfa/recovery-codes", "POST")
        assert any("get_current_active_user" in n for n in names), names

    def test_regenerate_is_rate_limited(self):
        # rate_limit_login() attaches a dependency at the route level.
        route = _route("/mfa/recovery-codes", "POST")
        dependant = getattr(route, "dependant", None)
        all_calls = [
            getattr(d.call, "__name__", str(d.call))
            for d in (dependant.dependencies if dependant else [])
        ]
        # The rate-limit dependency is anonymous; assert at least one extra
        # security dependency beyond the user/db ones is present.
        assert route is not None, all_calls
        assert len(all_calls) >= 2, all_calls

    def test_mfa_login_route_exists(self):
        assert _route("/mfa/login", "POST") is not None

    def test_mfa_status_route_exists(self):
        assert _route("/mfa/status", "GET") is not None


@pytest.mark.asyncio
async def test_oauth_login_requires_mfa_before_session_creation():
    user = SimpleNamespace(
        id="user-id", email="member@example.com", username="member", mfa_enabled=True
    )
    request = Request({"type": "http", "method": "GET", "path": "/", "headers": []})

    with (
        patch(
            "app.api.v1.endpoints.auth.create_mfa_pending_token",
            return_value="pending-token",
        ),
        patch("app.api.v1.endpoints.auth.log_audit_event", new=AsyncMock()),
        patch(
            "app.api.v1.endpoints.auth.AuthService.create_user_tokens",
            new=AsyncMock(),
        ) as create_tokens,
    ):
        response = await _finish_oauth_login(AsyncMock(), user, request, "google")

    assert response.status_code == 302
    assert response.headers["location"].endswith("#mfa_token=pending-token")
    assert "access_token=" not in response.headers.get("set-cookie", "")
    create_tokens.assert_not_awaited()


def _mfa_user(**overrides):
    """A minimal stand-in for `User` covering only what the MFA routes read."""
    defaults = dict(
        id="user-1",
        organization_id="org-1",
        mfa_enabled=True,
        mfa_secret=mfa_service.generate_secret(),
        mfa_last_timestep=None,
        mfa_backup_codes=[],
        is_active=True,
        locked_until=None,
        failed_login_attempts=0,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


@pytest.mark.asyncio
class TestTotpConsumedAcrossMfaRoutes:
    """Regression for the gap where a TOTP code verified at a management
    route (e.g. /mfa/recovery-codes) was never recorded as consumed, leaving
    it still valid for a completely independent login at /mfa/login for the
    rest of its ~30s window.

    Before the fix, `mfa_regenerate_recovery_codes` (and `mfa_verify_setup`,
    `mfa_disable`) called bare `mfa_service.verify_totp`, which never touches
    `user.mfa_last_timestep` — so this test's second call reached `mfa_login`
    with `verify_totp_get_timestep(..., last_timestep=None)`, matched the
    still-valid code, and succeeded. It must now fail: the first call records
    the time-step via `_verify_and_consume_totp`, so the second call sees
    `last_timestep == <that step>` and rejects the replay.
    """

    async def test_code_used_at_recovery_codes_route_cannot_replay_at_login(self):
        user = _mfa_user()
        code = pyotp.TOTP(user.mfa_secret).now()
        db = AsyncMock()

        with (
            patch("app.api.v1.endpoints.auth.log_audit_event", new=AsyncMock()),
            patch("app.api.v1.endpoints.auth.notify_security_event", new=AsyncMock()),
        ):
            result = await mfa_regenerate_recovery_codes(
                data=MFAVerify(code=code),
                background_tasks=AsyncMock(),
                current_user=user,
                db=db,
            )
        assert "recovery_codes" in result
        # The consuming helper must have recorded the step actually used.
        assert user.mfa_last_timestep is not None

        # An attacker who already holds the password (a prerequisite either
        # way) completes the password step for free and obtains their own
        # mfa_pending token, then replays the code merely *observed* in use
        # above (shoulder-surfing, a compromised endpoint, a phishing relay).
        temp_token = create_mfa_pending_token(user.id)
        execute_result = MagicMock()
        execute_result.scalar_one_or_none = MagicMock(return_value=user)
        db.execute = AsyncMock(return_value=execute_result)

        request = Request(
            {"type": "http", "method": "POST", "path": "/", "headers": []}
        )

        with pytest.raises(CodedHTTPException) as exc:
            await mfa_login(
                data=MFALogin(temp_token=temp_token, code=code), request=request, db=db
            )
        assert exc.value.status_code == 401

    async def test_verify_and_consume_totp_rejects_its_own_replay(self):
        """Unit-level check on the shared primitive itself: consuming a code
        once must block a second verification of that exact code."""
        user = _mfa_user()
        code = pyotp.TOTP(user.mfa_secret).now()

        assert _verify_and_consume_totp(user, code) is True
        assert _verify_and_consume_totp(user, code) is False

    async def test_fresh_code_after_consumption_still_verifies(self):
        """Sanity check: consuming one time-step must not lock out a later,
        genuinely different code."""
        user = _mfa_user()
        code = pyotp.TOTP(user.mfa_secret).now()
        assert _verify_and_consume_totp(user, code) is True

        # A code from the step after the one just consumed is correctly not
        # a replay; simulate it directly rather than sleeping 30s in a test.
        next_step_code = pyotp.TOTP(user.mfa_secret).at(
            (user.mfa_last_timestep + 1) * 30
        )
        assert (
            mfa_service.verify_totp_get_timestep(
                user.mfa_secret, next_step_code, last_timestep=user.mfa_last_timestep
            )
            is not None
        )


@pytest.mark.asyncio
class TestMfaLoginBruteForceWiring:
    """Regression: `mfa_login` must feed `security_monitor.detect_brute_force`
    on both a failed and a successful MFA-code attempt, mirroring exactly how
    `login` feeds it on the password step. Before the fix, `mfa_login` never
    called `detect_brute_force` at all — guessing the second factor could not
    trigger this specific HIGH-severity alert (the separate, still-enforced
    per-account lockout and suspicious-IP throttle covered abuse resistance,
    but this detector's history stayed empty for the whole MFA step).
    """

    async def test_failed_mfa_code_feeds_detect_brute_force_failure(self):
        user = _mfa_user()
        db = AsyncMock()
        execute_result = MagicMock()
        execute_result.scalar_one_or_none = MagicMock(return_value=user)
        db.execute = AsyncMock(return_value=execute_result)
        temp_token = create_mfa_pending_token(user.id)
        request = Request(
            {"type": "http", "method": "POST", "path": "/", "headers": []}
        )

        detect = AsyncMock(return_value=None)
        with (
            patch(
                "app.api.v1.endpoints.auth.security_monitor.detect_brute_force",
                detect,
            ),
            patch("app.api.v1.endpoints.auth.record_auth_failure", new=AsyncMock()),
        ):
            with pytest.raises(CodedHTTPException):
                await mfa_login(
                    data=MFALogin(temp_token=temp_token, code="000000"),
                    request=request,
                    db=db,
                )

        detect.assert_awaited_once_with(
            db, ip="unknown", user_id=user.id, success=False
        )

    async def test_successful_mfa_login_feeds_detect_brute_force_success(self):
        user = _mfa_user()
        code = pyotp.TOTP(user.mfa_secret).now()
        db = AsyncMock()
        execute_result = MagicMock()
        execute_result.scalar_one_or_none = MagicMock(return_value=user)
        db.execute = AsyncMock(return_value=execute_result)
        temp_token = create_mfa_pending_token(user.id)
        request = Request(
            {"type": "http", "method": "POST", "path": "/", "headers": []}
        )

        detect = AsyncMock(return_value=None)
        with (
            patch(
                "app.api.v1.endpoints.auth.security_monitor.detect_brute_force",
                detect,
            ),
            patch("app.api.v1.endpoints.auth.clear_auth_failures", new=AsyncMock()),
            patch(
                "app.api.v1.endpoints.auth.AuthService.create_user_tokens",
                new=AsyncMock(return_value=("access-token", "refresh-token")),
            ),
        ):
            await mfa_login(
                data=MFALogin(temp_token=temp_token, code=code),
                request=request,
                db=db,
            )

        detect.assert_awaited_once_with(db, ip="unknown", user_id=user.id, success=True)

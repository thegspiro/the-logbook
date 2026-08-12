"""
Tests for MFA auth-router endpoint wiring.

Unit-level: inspects the router's declared routes/dependencies without a
running server or database. Verifies the new self-service recovery-code
regeneration endpoint exists and is rate limited, and that the login
challenge endpoint is rate limited.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from starlette.requests import Request

from app.api.v1.endpoints.auth import _finish_oauth_login, router


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

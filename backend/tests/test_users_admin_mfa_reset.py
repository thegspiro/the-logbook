"""
Tests for the admin "reset MFA" endpoint permission gating.

Unit-level: inspects the route's declared dependencies without needing a
running server or database. The endpoint must require an admin-level
permission and be rate limited, mirroring the admin password-reset endpoint.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.users import _enforce_account_reset_ceiling, router


def _get_route_deps(path: str, method: str):
    """Extract dependency identifiers from a router endpoint."""
    for route in router.routes:
        if getattr(route, "path", None) == path:
            if method in getattr(route, "methods", set()):
                dependant = getattr(route, "dependant", None)
                if not dependant:
                    return None
                names = []
                for dep in dependant.dependencies:
                    call = dep.call
                    perms = getattr(call, "required_permissions", None)
                    if perms:
                        names.append(f"PermissionChecker({','.join(perms)})")
                    else:
                        names.append(getattr(call, "__name__", str(call)))
                return names
    return None


class TestResetMfaEndpoint:
    PATH = "/{user_id}/reset-mfa"

    def test_route_exists(self):
        assert (
            _get_route_deps(self.PATH, "POST") is not None
        ), "Route /{user_id}/reset-mfa POST not found"

    def test_requires_admin_permission(self):
        deps = _get_route_deps(self.PATH, "POST")
        assert any(
            "users.create" in d or "members.manage" in d for d in deps
        ), f"reset-mfa must require an admin permission; got {deps}"

    def test_is_rate_limited(self):
        deps = _get_route_deps(self.PATH, "POST")
        assert any(
            "_rate_limit_admin_reset" in d for d in deps
        ), f"reset-mfa must be rate limited; got {deps}"


def _user(user_id: str, permissions: list[str]):
    return SimpleNamespace(
        id=user_id,
        rank=None,
        positions=[SimpleNamespace(permissions=permissions)],
    )


class TestAccountResetPrivilegeCeiling:
    @pytest.mark.asyncio
    async def test_blocks_reset_of_more_privileged_user(self):
        caller = _user("caller", ["members.manage"])
        target = _user("target", ["members.manage", "security.manage"])
        report = AsyncMock()

        with patch(
            "app.api.v1.endpoints.users.report_privilege_escalation_attempt",
            report,
        ):
            with pytest.raises(HTTPException) as exc:
                await _enforce_account_reset_ceiling(caller, target, AsyncMock())

        assert exc.value.status_code == 403
        report.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_allows_reset_within_callers_permission_ceiling(self):
        caller = _user("caller", ["members.manage", "security.manage"])
        target = _user("target", ["members.manage"])

        await _enforce_account_reset_ceiling(caller, target, AsyncMock())

    @pytest.mark.asyncio
    async def test_wildcard_admin_can_reset_any_user(self):
        caller = _user("caller", ["*"])
        target = _user("target", ["members.manage", "security.manage"])

        await _enforce_account_reset_ceiling(caller, target, AsyncMock())

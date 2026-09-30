"""The public-portal admin API is for administrators, not every member.

Until 2026-09-30 every handler in ``app/api/v1/public_portal_admin.py`` took
only ``get_current_user``, and the router is mounted behind ``module_gate``,
which checks that the Public Information module is enabled and nothing else.
So any signed-in member of an organization with the module on could mint and
revoke public API keys, change the portal's configuration and rate limits, and
edit the data whitelist that decides which member fields the public API
publishes. The screen that drives these endpoints was already gated on
``settings.manage``; the API behind it was not.

These tests pin the gate on every route, including any added later, and prove
the gate refuses a baseline member and admits a holder of the permission.
"""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute

from app.api.dependencies import PermissionChecker
from app.api.v1 import public_portal_admin
from app.core.permissions import DEFAULT_POSITIONS

pytestmark = pytest.mark.unit

REQUIRED = "settings.manage"


def _permission_checkers(dependant) -> list[PermissionChecker]:
    found = []
    for dep in dependant.dependencies:
        if isinstance(dep.call, PermissionChecker):
            found.append(dep.call)
        found.extend(_permission_checkers(dep))
    return found


def _routes() -> list[APIRoute]:
    return [r for r in public_portal_admin.router.routes if isinstance(r, APIRoute)]


def test_router_has_routes():
    # Guards the sweep below against passing vacuously on an empty router.
    assert len(_routes()) >= 13


@pytest.mark.parametrize(
    "route",
    _routes(),
    ids=lambda r: f"{sorted(r.methods)[0]} {r.path}",
)
def test_every_route_requires_settings_manage(route: APIRoute):
    checkers = _permission_checkers(route.dependant)
    assert checkers, f"{route.path} has no permission dependency"
    # Exactly settings.manage: an OR'd extra grant would reopen the route to
    # whoever holds it.
    assert [c.required_permissions for c in checkers] == [[REQUIRED]]


def test_baseline_member_does_not_hold_settings_manage():
    # The gate only protects anything if a plain member lacks the permission.
    baseline = set(DEFAULT_POSITIONS["member"]["permissions"]) | set(
        DEFAULT_POSITIONS["firefighter"]["permissions"]
    )
    assert REQUIRED not in baseline
    assert "*" not in baseline
    assert "settings.*" not in baseline


def _user(permissions: list[str]) -> SimpleNamespace:
    return SimpleNamespace(
        positions=[SimpleNamespace(permissions=permissions)],
        rank=None,
    )


async def test_gate_refuses_member_permissions():
    member_perms = list(DEFAULT_POSITIONS["member"]["permissions"])
    with pytest.raises(HTTPException) as exc:
        await PermissionChecker([REQUIRED])(current_user=_user(member_perms))
    assert exc.value.status_code == 403


async def test_gate_admits_settings_manage():
    user = _user([REQUIRED])
    assert await PermissionChecker([REQUIRED])(current_user=user) is user

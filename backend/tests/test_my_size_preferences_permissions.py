"""Authorization contract for a member's own uniform sizes.

The `/inventory/my/size-preferences` pair is self-scoped: both handlers key
the row on ``current_user``, so neither grants any reach over another
member's sizes. They therefore require authentication only, matching every
sibling endpoint behind "My Issued Gear" (issued gear, equipment requests,
return requests, loan extension) and the contract the June 2026 changelog
recorded for them — "self, login required".

They spent a period behind ``inventory.view``, which left the ungated My
Sizes button on an ungated page pointing at a gated endpoint. These tests
pin both halves so neither can drift back: the self endpoints stay open to
any authenticated member, and the officer-facing endpoints for *another*
member's sizes keep their own, stricter gates.
"""

import pytest

from app.api.v1.endpoints.inventory import router


def _permission_checkers(path: str, method: str):
    """The permission dependencies attached to one route, or None if absent."""
    for route in router.routes:
        if route.path == path and method in route.methods:
            return [
                dependency.call
                for dependency in route.dependant.dependencies
                if hasattr(dependency.call, "required_permissions")
            ]
    pytest.fail(f"{method} {path} route not found")


@pytest.mark.parametrize("method", ["GET", "PUT"])
def test_own_size_preferences_require_only_authentication(method):
    """A member's own sizes are their own record, like their issued gear."""
    assert _permission_checkers("/my/size-preferences", method) == []


@pytest.mark.parametrize(
    ("method", "expected"),
    [("GET", "inventory.view"), ("PUT", "inventory.manage")],
)
def test_another_members_size_preferences_stay_gated(method, expected):
    """Relaxing the self endpoints must not relax the officer-facing ones."""
    checkers = _permission_checkers("/members/{user_id}/size-preferences", method)
    assert len(checkers) == 1
    assert set(checkers[0].required_permissions) == {expected}

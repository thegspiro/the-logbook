"""Who may read a *named member's* gear.

A member profile is a directory card. Which turnout coat, radio or SCBA mask a
colleague signed for — and what condition it is in — is quartermaster business,
not part of it. These routes were gated on ``inventory.view``, which every
member holds as part of the baseline Member position, so the gate passed for
the whole department. Cross-member reads require ``inventory.manage``.
"""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.inventory import (
    _is_quartermaster,
    _redact_holder,
    _require_self_or_quartermaster,
    router,
)
from app.core.permissions import DEFAULT_POSITIONS
from app.schemas.inventory import InventoryItemResponse


def _permission_set(path: str, method: str) -> set[str]:
    for route in router.routes:
        if route.path == path and method in route.methods:
            for dependency in route.dependant.dependencies:
                permissions = getattr(dependency.call, "required_permissions", None)
                if permissions is not None:
                    return set(permissions)
    pytest.fail(f"Permission dependency not found for {method} {path}")


def _user(user_id: str, *permissions: str) -> SimpleNamespace:
    return SimpleNamespace(
        id=user_id,
        rank=None,
        positions=[SimpleNamespace(permissions=list(permissions))],
    )


def test_baseline_member_holds_inventory_view_but_not_manage():
    """The fact that makes ``inventory.view`` unusable as the gate.

    If this ever stops being true, the guard below can be revisited — until
    then, ``inventory.view`` says only "this person is a member".
    """
    member_permissions = set(DEFAULT_POSITIONS["member"]["permissions"])

    assert "inventory.view" in member_permissions
    assert "inventory.manage" not in member_permissions


def test_member_may_read_their_own_gear_without_an_inventory_permission():
    _require_self_or_quartermaster("user-1", _user("user-1"))


def test_baseline_member_may_not_read_a_colleagues_gear():
    with pytest.raises(HTTPException) as exc_info:
        _require_self_or_quartermaster("user-2", _user("user-1", "inventory.view"))

    assert exc_info.value.status_code == 403


def test_quartermaster_may_read_any_members_gear():
    _require_self_or_quartermaster("user-2", _user("user-1", "inventory.manage"))


def test_wildcard_grant_covers_quartermaster_reads():
    _require_self_or_quartermaster("user-2", _user("user-1", "inventory.*"))


def test_members_inventory_roster_requires_quartermaster():
    """The roster names who holds which gear, for every member at once."""
    permissions = _permission_set("/members-summary", "GET")

    assert permissions == {"inventory.manage"}
    assert "inventory.view" not in permissions


def _item(assigned_to: str | None) -> InventoryItemResponse:
    return InventoryItemResponse.model_construct(
        assigned_to_user_id=assigned_to,
        assigned_to_name="Jane Doe" if assigned_to else None,
    )


def test_the_catalog_does_not_name_who_holds_a_colleagues_item():
    """The alternate route to the same disclosure.

    ``/items`` stays open to every member — they browse it for gear and search
    it for a replacement — so the holder is stripped instead. Without this,
    ``?assigned_to=<uuid>`` rebuilds a colleague's kit from an endpoint the
    whole department can reach.
    """
    viewer = _user("user-1", "inventory.view")

    redacted = _redact_holder(_item("user-2"), viewer, _is_quartermaster(viewer))

    assert redacted.assigned_to_user_id is None
    assert redacted.assigned_to_name is None


def test_a_member_still_sees_their_own_name_on_their_own_gear():
    viewer = _user("user-1", "inventory.view")

    kept = _redact_holder(_item("user-1"), viewer, _is_quartermaster(viewer))

    assert kept.assigned_to_user_id == "user-1"
    assert kept.assigned_to_name == "Jane Doe"


def test_a_quartermaster_sees_who_holds_what():
    viewer = _user("user-1", "inventory.manage")

    kept = _redact_holder(_item("user-2"), viewer, _is_quartermaster(viewer))

    assert kept.assigned_to_user_id == "user-2"
    assert kept.assigned_to_name == "Jane Doe"


@pytest.mark.parametrize(
    ("path", "method"),
    [
        ("/items/{item_id}/history", "GET"),
        ("/items/{item_id}/issuances", "GET"),
        ("/checkout/active", "GET"),
        ("/checkout/overdue", "GET"),
        ("/clearances/{clearance_id}", "GET"),
    ],
)
def test_reads_that_name_the_holder_require_quartermaster(path, method):
    """Every route that answers "who has this" carries the same gate.

    Gating only the per-member routes left these as equivalent ways to ask the
    same question: an item's chain of custody, the members issued units of a
    pool item, the outstanding-checkout lists (which take a user_id filter),
    and a departure clearance's full line-item detail (item names, serials,
    values, disposition, and the departing member's id) — a colleague could
    look up a member's clearance by id even though the identically-shaped
    ``/users/{user_id}/clearance`` sibling route already required
    self-or-quartermaster — all name members.
    """
    permissions = _permission_set(path, method)

    assert permissions == {"inventory.manage"}
    assert "inventory.view" not in permissions

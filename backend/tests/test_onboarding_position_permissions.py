"""Onboarding position-save permission rebuild tests (no DB).

The ``/onboarding/session/positions`` (and ``/session/roles``) handler
rebuilds a system position's permission list from the editor's per-module
view/manage checkboxes. Sub-permissions granted by DEFAULT_POSITIONS
(``facilities.view_sensitive``, ``members.assign_positions``, ...) cannot be
represented by those checkboxes. Read-only sub-permissions must survive a
view-only submission, but hidden write permissions must not. These tests lock
the carry-over rules of ``_merge_default_permissions``.
"""

from app.api.v1.onboarding import (
    RolePermission,
    _merge_default_permissions,
    expand_module_checkboxes,
)
from app.core.permissions import DEFAULT_POSITIONS, permission_matches

# The endpoint's own expansion, not a copy of it: a local mimic drifted the
# moment the real one learned about view-implied permissions.
_rebuild = expand_module_checkboxes


def _merged(submitted: dict[str, RolePermission], defaults: list[str]) -> list[str]:
    return _merge_default_permissions(_rebuild(submitted), submitted, defaults)


def test_customized_treasurer_keeps_facilities_view_sensitive():
    defaults = DEFAULT_POSITIONS["treasurer"]["permissions"]
    submitted = {
        "facilities": RolePermission(view=True, manage=False),
        "fundraising": RolePermission(view=True, manage=True),
    }
    merged = _merged(submitted, defaults)
    assert "facilities.view_sensitive" in merged
    assert "facilities.view" in merged


def test_manage_wildcard_covers_sub_permissions_without_duplication():
    defaults = [
        "facilities.view",
        "facilities.view_sensitive",
        "facilities.manage",
    ]
    submitted = {"facilities": RolePermission(view=True, manage=True)}
    merged = _merged(submitted, defaults)
    # Not re-added literally — the module wildcard from manage covers it.
    assert "facilities.view_sensitive" not in merged
    assert permission_matches("facilities.view_sensitive", set(merged))


def test_unchecking_a_module_revokes_its_sub_permissions():
    defaults = ["facilities.view", "facilities.view_sensitive", "events.view"]
    submitted = {
        "facilities": RolePermission(view=False, manage=False),
        "events": RolePermission(view=True, manage=False),
    }
    merged = _merged(submitted, defaults)
    assert "facilities.view_sensitive" not in merged
    assert "facilities.view" not in merged
    assert "events.view" in merged


def test_unsubmitted_module_defaults_are_preserved():
    defaults = ["audit.view", "users.create", "facilities.view"]
    submitted = {"facilities": RolePermission(view=True, manage=False)}
    merged = _merged(submitted, defaults)
    assert "audit.view" in merged
    assert "users.create" in merged


def test_view_only_does_not_carry_hidden_action_permissions():
    defaults = [
        "members.view",
        "members.assign_positions",
        "members.create",
        "members.manage",
    ]
    submitted = {"members": RolePermission(view=True, manage=False)}
    merged = set(_merged(submitted, defaults))
    assert merged == {"members.view"}


def test_member_keeps_shift_swap_with_scheduling_view_only():
    defaults = DEFAULT_POSITIONS["member"]["permissions"]
    submitted = {"scheduling": RolePermission(view=True, manage=False)}
    merged = _merged(submitted, defaults)
    assert "scheduling.swap" in merged
    assert "scheduling.view" in merged


def test_unchecking_scheduling_revokes_shift_swap():
    defaults = DEFAULT_POSITIONS["member"]["permissions"]
    submitted = {"scheduling": RolePermission(view=False, manage=False)}
    merged = _merged(submitted, defaults)
    assert "scheduling.swap" not in merged
    assert "scheduling.view" not in merged


def test_vice_president_keeps_only_read_sub_permissions_with_view_only():
    defaults = DEFAULT_POSITIONS["vice_president"]["permissions"]
    submitted = {
        "members": RolePermission(view=True, manage=False),
        "facilities": RolePermission(view=True, manage=False),
    }
    merged = set(_merged(submitted, defaults))
    assert "facilities.view_sensitive" in merged
    assert "members.assign_positions" not in merged


def test_view_only_drops_default_write_permissions_across_modules():
    defaults = DEFAULT_POSITIONS["fire_chief"]["permissions"]
    submitted = {
        module: RolePermission(view=True, manage=False)
        for module in ("members", "positions", "events", "apparatus", "facilities")
    }
    merged = set(_merged(submitted, defaults))
    hidden_writes = {
        "members.assign_positions",
        "members.create",
        "positions.create",
        "positions.delete",
        "positions.manage_permissions",
        "events.create",
        "events.delete",
        "apparatus.edit",
        "apparatus.delete",
        "apparatus.maintenance",
        "facilities.create",
        "facilities.edit",
        "facilities.delete",
        "facilities.maintenance",
    }
    assert merged.isdisjoint(hidden_writes)
    assert "facilities.view_sensitive" in merged


def test_member_keeps_storefront_order_with_store_view_alone():
    """Browsing the store is useless without being able to check out.

    ``storefront.order`` is an action a plain member holds alongside baseline
    view access, which the two-checkbox editor cannot express. It rode along as
    an un-submitted module's default until the Department Store was added to
    the frontend registry — from that point the module *is* submitted, so
    without the view-implied grant a member saved from the position editor
    browses the catalog and gets a 403 at checkout.
    """
    defaults = DEFAULT_POSITIONS["member"]["permissions"]
    submitted = {"storefront": RolePermission(view=True, manage=False)}
    merged = _merged(submitted, defaults)
    assert "storefront.view" in merged
    assert "storefront.order" in merged


def test_a_brand_new_position_can_order_from_store_view_alone():
    """A position built in the editor has no defaults to carry over.

    Carry-over only rescues a position DEFAULT_POSITIONS already seeded, so a
    custom position ticked View-only used to save ``storefront.view`` with no
    way to check out — while the registry told the administrator that View
    includes placing orders.
    """
    submitted = {"storefront": RolePermission(view=True, manage=False)}
    merged = _merged(submitted, defaults=[])
    assert merged == ["storefront.view", "storefront.order"]


def test_unchecking_the_store_revokes_ordering_too():
    defaults = ["storefront.view", "storefront.order"]
    submitted = {"storefront": RolePermission(view=False, manage=False)}
    merged = _merged(submitted, defaults)
    assert "storefront.order" not in merged
    assert "storefront.view" not in merged


def test_store_manage_covers_ordering_through_the_wildcard():
    defaults = ["storefront.view", "storefront.order", "storefront.manage"]
    submitted = {"storefront": RolePermission(view=True, manage=True)}
    merged = _merged(submitted, defaults)
    assert "storefront.order" not in merged
    assert permission_matches("storefront.order", set(merged))

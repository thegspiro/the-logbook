"""Onboarding position-save permission rebuild tests (no DB).

The ``/onboarding/session/positions`` (and ``/session/roles``) handler
rebuilds a system position's permission list from the editor's per-module
view/manage checkboxes. Sub-permissions granted by DEFAULT_POSITIONS
(``facilities.view_sensitive``, ``members.assign_positions``, ...) cannot be
represented by those checkboxes. Read-only sub-permissions must survive a
view-only submission, but hidden write permissions must not. These tests lock
the carry-over rules of ``_merge_default_permissions``.
"""

from app.api.v1.onboarding import RolePermission, _merge_default_permissions
from app.core.permissions import DEFAULT_POSITIONS, permission_matches


def _rebuild(submitted: dict[str, RolePermission]) -> list[str]:
    """Mimic the endpoint's checkbox -> permission-list expansion."""
    permission_list = []
    for module_id, perms in submitted.items():
        if perms.view:
            permission_list.append(f"{module_id}.view")
        if perms.manage:
            permission_list.append(f"{module_id}.manage")
            permission_list.append(f"{module_id}.*")
    return permission_list


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

"""
Tests for the centralized permission matcher
(app/core/permissions.py :: permission_matches / permission_matches_any).

This is the single source of truth shared by the HTTP dependency layer, the
role service, and admin-access checks. The key contract is module-wildcard
support (``users.*`` satisfies ``users.view``) so the three consumers cannot
diverge — previously the role service and admin check only honored the global
``*`` and exact matches.
"""

from types import SimpleNamespace

from app.api.dependencies import _collect_user_permissions, _has_permission
from app.core.permissions import (
    ALL_PERMISSIONS,
    LEGACY_PERMISSION_ALIASES,
    expand_legacy_permissions,
    permission_matches,
    permission_matches_any,
)


class TestPermissionMatches:
    def test_global_wildcard_grants_everything(self):
        assert permission_matches("anything.at_all", {"*"}) is True

    def test_exact_match(self):
        assert permission_matches("users.view", {"users.view"}) is True

    def test_module_wildcard_grants_action(self):
        assert permission_matches("users.view", {"users.*"}) is True
        assert permission_matches("settings.manage_contact", {"settings.*"}) is True

    def test_module_wildcard_does_not_cross_modules(self):
        assert permission_matches("events.view", {"users.*"}) is False

    def test_no_match(self):
        assert permission_matches("users.delete", {"users.view", "events.*"}) is False

    def test_non_namespaced_required_only_exact_or_global(self):
        # A required permission with no "." can't be satisfied by a module wildcard.
        assert permission_matches("admin", {"admin.*"}) is False
        assert permission_matches("admin", {"admin"}) is True

    def test_empty_granted_set(self):
        assert permission_matches("users.view", set()) is False


class TestPermissionMatchesAny:
    def test_true_when_one_matches_via_wildcard(self):
        assert permission_matches_any(["users.view", "roles.edit"], {"roles.*"}) is True

    def test_false_when_none_match(self):
        assert permission_matches_any(["users.view"], {"events.*"}) is False

    def test_global_wildcard(self):
        assert permission_matches_any(["a.b", "c.d"], {"*"}) is True

    def test_empty_required(self):
        assert permission_matches_any([], {"*"}) is False


class TestDependencyWrapperDelegates:
    """_has_permission must stay behavior-identical to the shared matcher."""

    def test_module_wildcard(self):
        assert _has_permission("users.view", {"users.*"}) is True

    def test_exact_and_global(self):
        assert _has_permission("users.view", {"users.view"}) is True
        assert _has_permission("users.view", {"*"}) is True

    def test_denied(self):
        assert _has_permission("users.view", {"events.view"}) is False


class TestLegacyPermissionAliases:
    """A renamed permission keeps working for rows the migration didn't reach.

    ``equipment_check.*`` became ``inventory.check_*`` when equipment
    checklists moved to the Inventory module. The rename migration rewrites
    ``positions.permissions``, but a database restored from an older backup —
    or a row written by an integration still using the old vocabulary — would
    otherwise drop to no access, silently. These assert the safety net, not
    the migration.
    """

    def test_every_alias_target_is_a_real_permission(self):
        """A typo'd target would alias to a grant nothing ever checks."""
        known = {p.name for p in ALL_PERMISSIONS}
        targets = {t for ts in LEGACY_PERMISSION_ALIASES.values() for t in ts}
        assert targets <= known, sorted(targets - known)

    def test_no_alias_key_is_still_a_live_permission(self):
        """An alias for a name that still exists would be a rename half-done."""
        known = {p.name for p in ALL_PERMISSIONS}
        assert not (set(LEGACY_PERMISSION_ALIASES) & known)

    def test_retired_name_expands_to_its_replacement(self):
        expanded = expand_legacy_permissions({"equipment_check.manage"})
        assert permission_matches("inventory.check_manage", expanded)

    def test_retired_module_wildcard_expands_to_all_three(self):
        """``equipment_check.*`` cannot match ``inventory.*`` on its own.

        The module segment changed, so the wildcard has to be listed
        explicitly rather than left to ``permission_matches``.
        """
        expanded = expand_legacy_permissions({"equipment_check.*"})
        for name in (
            "inventory.check_view",
            "inventory.check_manage",
            "inventory.check_submit",
        ):
            assert permission_matches(name, expanded), name

    def test_expansion_is_additive(self):
        """The stored string survives, so a grants readout stays truthful."""
        expanded = expand_legacy_permissions({"equipment_check.view"})
        assert "equipment_check.view" in expanded

    def test_unrelated_grants_are_untouched(self):
        assert expand_legacy_permissions({"events.view"}) == {"events.view"}

    def test_collect_user_permissions_applies_the_alias(self):
        """The expansion has to happen where every check funnels through."""
        user = SimpleNamespace(
            positions=[SimpleNamespace(permissions=["equipment_check.submit"])],
            rank=None,
        )
        assert permission_matches(
            "inventory.check_submit", _collect_user_permissions(user)
        )


class TestInventoryWildcardCoversChecklists:
    """``inventory.*`` grants the checklist permissions, deliberately.

    This is a real widening, not a tautology worth asserting for its own sake.
    Before the move these were ``equipment_check.*``, which ``inventory.*``
    did not reach; renaming them into the inventory namespace put them under
    that wildcard. A department that had built its own position granting
    ``inventory.*`` — a quartermaster, typically — gained the ability to
    author and submit equipment checklists on upgrade, without anyone
    choosing that for them.

    It is the intended behaviour (the grants live with the stock they
    describe, exactly as ``view_medical``/``manage_medical`` do), so it is
    pinned here rather than left implicit: moving any of these three back out
    of the ``inventory`` namespace, or adding a fourth the wildcard should not
    cover, has to fail a test and be argued for.
    """

    CHECK_PERMISSIONS = (
        "inventory.check_view",
        "inventory.check_manage",
        "inventory.check_submit",
    )

    def test_inventory_wildcard_grants_every_checklist_permission(self):
        for name in self.CHECK_PERMISSIONS:
            assert permission_matches(name, {"inventory.*"}), name

    def test_a_narrow_inventory_grant_does_not_imply_them(self):
        """``inventory.view`` is not a wildcard, so it grants none of these —
        the widening is the wildcard's doing, not the namespace's."""
        for name in self.CHECK_PERMISSIONS:
            assert not permission_matches(name, {"inventory.view"}), name

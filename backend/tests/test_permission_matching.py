"""
Tests for the centralized permission matcher
(app/core/permissions.py :: permission_matches / permission_matches_any).

This is the single source of truth shared by the HTTP dependency layer, the
role service, and admin-access checks. The key contract is module-wildcard
support (``users.*`` satisfies ``users.view``) so the three consumers cannot
diverge — previously the role service and admin check only honored the global
``*`` and exact matches.
"""

from app.api.dependencies import _has_permission
from app.core.permissions import permission_matches, permission_matches_any


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

"""
Tests for the role service permission helpers
(app/services/role_service.py).

Focus on the wildcard-aware permission checks: a user whose role grants a
module wildcard (e.g. ``training.*``) must be reported as having the concrete
action (``training.view``). Before centralizing on permission_matches these
service methods only honored the global ``*`` and exact matches, so they
disagreed with the HTTP enforcement layer. Also covers the slugify helper.
DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.services.role_service import RoleManagementService, slugify


def _roles_result(roles):
    r = MagicMock()
    r.scalars.return_value.all.return_value = roles
    return r


def _db_with_roles(roles):
    db = MagicMock()
    db.execute = AsyncMock(return_value=_roles_result(roles))
    return db


def _role(permissions):
    return SimpleNamespace(id="r1", name="R", priority=0, permissions=permissions)


class TestSlugify:
    def test_spaces_to_underscores(self):
        assert slugify("Training Officer") == "training_officer"

    def test_strips_and_collapses_punctuation(self):
        assert slugify("  Assistant / Chief!! ") == "assistant_chief"

    def test_already_slug(self):
        assert slugify("admin") == "admin"


class TestGetUserPermissions:
    async def test_unions_permissions_across_roles(self):
        db = _db_with_roles([_role(["users.view"]), _role(["events.*", "users.view"])])
        perms = await RoleManagementService().get_user_permissions(db, "u1")
        assert perms == {"users.view", "events.*"}

    async def test_handles_role_with_no_permissions(self):
        db = _db_with_roles([_role(None), _role(["a.b"])])
        perms = await RoleManagementService().get_user_permissions(db, "u1")
        assert perms == {"a.b"}


class TestUserHasPermission:
    async def test_module_wildcard_satisfies_action(self):
        db = _db_with_roles([_role(["training.*"])])
        assert (
            await RoleManagementService().user_has_permission(db, "u1", "training.view")
            is True
        )

    async def test_exact_match(self):
        db = _db_with_roles([_role(["training.view"])])
        assert (
            await RoleManagementService().user_has_permission(db, "u1", "training.view")
            is True
        )

    async def test_denied_across_modules(self):
        db = _db_with_roles([_role(["training.*"])])
        assert (
            await RoleManagementService().user_has_permission(db, "u1", "events.view")
            is False
        )

    async def test_global_wildcard(self):
        db = _db_with_roles([_role(["*"])])
        assert (
            await RoleManagementService().user_has_permission(db, "u1", "anything.goes")
            is True
        )


class TestUserHasAnyPermission:
    async def test_true_via_wildcard(self):
        db = _db_with_roles([_role(["roles.*"])])
        assert (
            await RoleManagementService().user_has_any_permission(
                db, "u1", ["users.view", "roles.edit"]
            )
            is True
        )

    async def test_false_when_none_match(self):
        db = _db_with_roles([_role(["events.*"])])
        assert (
            await RoleManagementService().user_has_any_permission(
                db, "u1", ["users.view", "roles.edit"]
            )
            is False
        )

"""
Tests for documents service folder access control
(app/services/documents_service.py).

can_access_folder is a security boundary deciding which document folders a
member may see. Covers the leadership override, leadership/owner/organization
visibility, and the allowed-roles restriction, plus the permission/role
collection helpers. Pure logic; no DB.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.models.document import FolderVisibility
from app.services.documents_service import (
    DocumentsService,
    _get_user_permissions,
    _get_user_role_slugs,
    _is_leadership,
)


def _user(uid="u1", roles=None):
    # roles: list of (permissions_list, slug)
    role_objs = [
        SimpleNamespace(permissions=perms, slug=slug) for perms, slug in (roles or [])
    ]
    return SimpleNamespace(id=uid, roles=role_objs)


def _folder(visibility, owner_user_id=None, allowed_roles=None):
    return SimpleNamespace(
        id="f1",
        visibility=visibility,
        owner_user_id=owner_user_id,
        allowed_roles=allowed_roles,
    )


def _svc():
    return DocumentsService(MagicMock())


class TestHelpers:
    def test_collect_permissions_across_roles(self):
        user = _user(roles=[(["a", "b"], "r1"), (["b", "c"], "r2")])
        assert _get_user_permissions(user) == {"a", "b", "c"}

    def test_collect_role_slugs(self):
        user = _user(roles=[([], "chief"), ([], "secretary")])
        assert _get_user_role_slugs(user) == {"chief", "secretary"}

    def test_is_leadership(self):
        assert _is_leadership({"documents.manage"}) is True
        assert _is_leadership({"members.manage"}) is True
        assert _is_leadership({"*"}) is True
        assert _is_leadership({"events.view"}) is False


class TestCanAccessFolder:
    def test_leadership_sees_everything(self):
        user = _user(roles=[(["documents.manage"], "chief")])
        # Even a leadership-only folder is visible to leadership.
        folder = _folder(FolderVisibility.LEADERSHIP)
        assert _svc().can_access_folder(folder, user) is True

    def test_leadership_visibility_blocks_non_leadership(self):
        user = _user(roles=[(["events.view"], "ff")])
        folder = _folder(FolderVisibility.LEADERSHIP)
        assert _svc().can_access_folder(folder, user) is False

    def test_owner_visibility_owner_allowed(self):
        user = _user(uid="u1", roles=[([], "ff")])
        folder = _folder(FolderVisibility.OWNER, owner_user_id="u1")
        assert _svc().can_access_folder(folder, user) is True

    def test_owner_visibility_non_owner_blocked(self):
        user = _user(uid="u2", roles=[([], "ff")])
        folder = _folder(FolderVisibility.OWNER, owner_user_id="u1")
        assert _svc().can_access_folder(folder, user) is False

    def test_owner_visibility_no_owner_blocked(self):
        user = _user(uid="u1", roles=[([], "ff")])
        folder = _folder(FolderVisibility.OWNER, owner_user_id=None)
        assert _svc().can_access_folder(folder, user) is False

    def test_organization_visibility_open_to_all(self):
        user = _user(roles=[([], "ff")])
        folder = _folder(FolderVisibility.ORGANIZATION)
        assert _svc().can_access_folder(folder, user) is True

    def test_organization_with_allowed_roles_match(self):
        user = _user(roles=[([], "officer")])
        folder = _folder(
            FolderVisibility.ORGANIZATION, allowed_roles=["officer", "chief"]
        )
        assert _svc().can_access_folder(folder, user) is True

    def test_organization_with_allowed_roles_no_match(self):
        user = _user(roles=[([], "ff")])
        folder = _folder(FolderVisibility.ORGANIZATION, allowed_roles=["officer"])
        assert _svc().can_access_folder(folder, user) is False

    def test_none_visibility_defaults_to_organization(self):
        user = _user(roles=[([], "ff")])
        folder = _folder(None)
        assert _svc().can_access_folder(folder, user) is True


class TestCanAccessDocument:
    """A by-id document fetch must honour the containing folder's access rules,
    otherwise a member can pull a leadership-only or another member's personal
    (owner-only) document by guessing its id — bypassing the list view."""

    async def test_no_folder_is_org_level_accessible(self):
        doc = SimpleNamespace(folder_id=None)
        user = _user(roles=[([], "ff")])
        assert await _svc().can_access_document(doc, "org-1", user) is True

    async def test_owner_only_folder_blocks_other_member(self):
        svc = _svc()
        svc.get_folder_by_id = AsyncMock(
            return_value=_folder(FolderVisibility.OWNER, owner_user_id="u1")
        )
        doc = SimpleNamespace(folder_id="f1")
        other = _user(uid="u2", roles=[([], "ff")])
        assert await svc.can_access_document(doc, "org-1", other) is False

    async def test_leadership_folder_blocks_non_leadership(self):
        svc = _svc()
        svc.get_folder_by_id = AsyncMock(
            return_value=_folder(FolderVisibility.LEADERSHIP)
        )
        doc = SimpleNamespace(folder_id="f1")
        user = _user(roles=[(["events.view"], "ff")])
        assert await svc.can_access_document(doc, "org-1", user) is False

    async def test_leadership_folder_allows_leadership(self):
        svc = _svc()
        svc.get_folder_by_id = AsyncMock(
            return_value=_folder(FolderVisibility.LEADERSHIP)
        )
        doc = SimpleNamespace(folder_id="f1")
        chief = _user(roles=[(["documents.manage"], "chief")])
        assert await svc.can_access_document(doc, "org-1", chief) is True

    async def test_missing_folder_falls_back_to_accessible(self):
        svc = _svc()
        svc.get_folder_by_id = AsyncMock(return_value=None)
        doc = SimpleNamespace(folder_id="gone")
        user = _user(roles=[([], "ff")])
        assert await svc.can_access_document(doc, "org-1", user) is True


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))

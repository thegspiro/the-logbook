"""Phase 3 folder rights: a module's folder opens to that module's rights.

docs/FILE_STORAGE_HARDENING.md decisions 10 and 19. Only a full administrator
(``*``) passes every folder; documents.manage admits the library's
leadership-only folders and nothing else; members.manage is no override at
all; a member's personal folder admits its owner alone.

The seeded positions are used as the callers so the table below reads as the
department sees it: a quartermaster, a treasurer, a training officer.
"""

import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.core.permissions import DEFAULT_POSITIONS
from app.models.document import (
    APPARATUS_FOLDER_PERMISSIONS,
    EVENTS_FOLDER_PERMISSIONS,
    FINANCE_FOLDER_PERMISSIONS,
    SEPARATIONS_FOLDER_PERMISSIONS,
    SYSTEM_FOLDERS,
    TRAINING_FOLDER_PERMISSIONS,
    FolderVisibility,
    system_folder_fields,
)
from app.services.documents_service import DocumentsService

pytestmark = pytest.mark.unit

MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261009_0317_b38df38d849b_gate_module_folders_on_module_rights.py"
)


def _position(slug: str, uid: str = "u1"):
    role = SimpleNamespace(
        permissions=DEFAULT_POSITIONS[slug]["permissions"], slug=slug
    )
    return SimpleNamespace(id=uid, roles=[role], rank=None)


def _grants(*permissions: str, uid: str = "u1"):
    role = SimpleNamespace(permissions=list(permissions), slug="custom")
    return SimpleNamespace(id=uid, roles=[role], rank=None)


def _root(slug: str):
    fields = system_folder_fields(slug)
    return SimpleNamespace(
        id=f"root-{slug}",
        visibility=fields["visibility"],
        owner_user_id=None,
        allowed_roles=None,
        required_permissions=fields["required_permissions"],
        parent_id=None,
        organization_id="org-1",
    )


def _personal(owner: str):
    return SimpleNamespace(
        id="personal",
        visibility=FolderVisibility.OWNER,
        owner_user_id=owner,
        allowed_roles=None,
        required_permissions=None,
        parent_id=None,
        organization_id="org-1",
    )


def _reads(folder, user) -> bool:
    return DocumentsService._folder_admits_user(folder, user)


def _writes(folder, user) -> bool:
    return DocumentsService._folder_admits_user(folder, user, require_write=True)


class TestTheRightsMap:
    def test_each_module_root_carries_its_module_rights(self):
        roots = {folder["slug"]: folder for folder in SYSTEM_FOLDERS}
        assert roots["training"]["required_permissions"] == TRAINING_FOLDER_PERMISSIONS
        assert roots["events"]["required_permissions"] == EVENTS_FOLDER_PERMISSIONS
        assert (
            roots["apparatus"]["required_permissions"] == APPARATUS_FOLDER_PERMISSIONS
        )
        assert roots["finance"]["required_permissions"] == FINANCE_FOLDER_PERMISSIONS
        assert (
            roots["member-separations"]["required_permissions"]
            == SEPARATIONS_FOLDER_PERMISSIONS
        )

    def test_no_system_root_is_leadership_only_any_more(self):
        assert all(
            folder.get("visibility", FolderVisibility.ORGANIZATION)
            == FolderVisibility.ORGANIZATION
            for folder in SYSTEM_FOLDERS
        )

    def test_library_folders_stay_on_documents_view(self):
        library = {"meeting-minutes", "sops", "policies", "forms", "reports", "general"}
        for folder in SYSTEM_FOLDERS:
            if folder["slug"] in library:
                assert not folder.get("required_permissions"), folder["slug"]

    def test_constructor_fields_do_not_share_the_definition_list(self):
        fields = system_folder_fields("apparatus")
        fields["required_permissions"].append("x")
        assert "x" not in APPARATUS_FOLDER_PERMISSIONS
        assert fields["is_system"] is True

    def test_the_migration_stamps_the_same_rights(self):
        """The migration freezes its own copy; today the two must agree."""
        spec = importlib.util.spec_from_file_location("gate_migration", MIGRATION)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        assert module._GATES == {
            "training": TRAINING_FOLDER_PERMISSIONS,
            "events": EVENTS_FOLDER_PERMISSIONS,
            "apparatus": APPARATUS_FOLDER_PERMISSIONS,
            "member-separations": SEPARATIONS_FOLDER_PERMISSIONS,
        }


class TestWhoOpensWhichModuleFolder:
    @pytest.mark.parametrize(
        ("slug", "position", "reads", "writes"),
        [
            ("apparatus", "quartermaster", True, False),
            ("apparatus", "apparatus_officer", True, True),
            ("apparatus", "treasurer", False, False),
            ("apparatus", "member", False, False),
            ("training", "training_officer", True, True),
            ("training", "member", True, False),
            ("training", "quartermaster", False, False),
            ("finance", "treasurer", True, True),
            ("finance", "training_officer", False, False),
            ("finance", "member", False, False),
            ("events", "member", True, False),
            ("events", "training_officer", True, True),
            ("member-separations", "membership_coordinator", True, True),
            ("member-separations", "treasurer", False, False),
        ],
    )
    def test_module_rights_decide(self, slug, position, reads, writes):
        user = _position(position)
        assert _reads(_root(slug), user) is reads
        assert _writes(_root(slug), user) is writes

    def test_documents_manage_does_not_open_a_module_folder(self):
        user = _grants("documents.view", "documents.manage")
        for slug in (
            "apparatus",
            "training",
            "finance",
            "events",
            "member-separations",
        ):
            assert _reads(_root(slug), user) is False, slug

    def test_a_full_administrator_opens_every_folder(self):
        admin = _grants("*")
        for folder in SYSTEM_FOLDERS:
            assert _writes(_root(folder["slug"]), admin) is True

    def test_a_module_wildcard_counts_as_that_module(self):
        assert _writes(_root("finance"), _grants("finance.*")) is True


class TestPersonalFolders:
    def test_the_owner_opens_their_own_folder(self):
        assert _reads(_personal("u1"), _grants("documents.view", uid="u1")) is True

    @pytest.mark.parametrize(
        "permissions",
        [
            ("members.manage",),
            ("documents.manage",),
            ("members.manage", "documents.manage"),
        ],
    )
    def test_officers_do_not_open_another_members_folder(self, permissions):
        assert _reads(_personal("u1"), _grants(*permissions, uid="u2")) is False

    def test_a_captain_does_not_open_another_members_folder(self):
        assert _reads(_personal("u1"), _position("captain", uid="u2")) is False

    def test_a_full_administrator_does(self):
        assert _reads(_personal("u1"), _grants("*", uid="u2")) is True


class TestLeadershipOnlyLibraryFolders:
    def _leadership(self):
        folder = _personal("u1")
        folder.visibility = FolderVisibility.LEADERSHIP
        folder.owner_user_id = None
        return folder

    def test_library_managers_open_them(self):
        assert _reads(self._leadership(), _grants("documents.manage")) is True

    def test_members_manage_alone_does_not(self):
        assert _reads(self._leadership(), _grants("members.manage")) is False

    def test_a_role_restriction_now_binds_library_managers_too(self):
        folder = _personal("u1")
        folder.visibility = FolderVisibility.ORGANIZATION
        folder.owner_user_id = None
        folder.allowed_roles = ["officer"]
        assert _reads(folder, _grants("documents.manage")) is False

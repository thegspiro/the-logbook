"""The folder-access editor's rules (docs/FILE_STORAGE_HARDENING.md decision 27).

A custom folder can be restricted by position, by permission, or both. A
built-in folder keeps its module rights and can only be narrowed. A
personal folder's access is fixed. Nobody saves settings that shut
themselves out of the folder they are editing, except a full administrator.
"""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.document import DocumentFolder, FolderVisibility, system_folder_fields
from app.models.user import Organization, Position
from app.services.documents_service import DocumentsService

pytestmark = pytest.mark.integration


# Folders name positions by id. Fixed here so the stand-in members below can
# hold them; each test's rows are rolled back, so the ids never collide.
QUARTERMASTER = str(uuid4())
HISTORIAN = str(uuid4())


def _member(*permissions: str, position: str = "custom"):
    role = SimpleNamespace(permissions=list(permissions), slug=position, id=position)
    return SimpleNamespace(id=str(uuid4()), roles=[role], rank=None)


LIBRARIAN = _member("documents.view", "documents.manage", position=HISTORIAN)
ADMIN = _member("*", position="chief")


@pytest.fixture
async def org(db_session):
    org = Organization(name="Folder Editor FD", slug=f"fae-{uuid4().hex[:8]}")
    db_session.add(org)
    await db_session.flush()
    db_session.add_all(
        [
            Position(
                id=QUARTERMASTER,
                organization_id=org.id,
                name="Quartermaster",
                slug="quartermaster",
            ),
            Position(
                id=HISTORIAN, organization_id=org.id, name="Historian", slug="historian"
            ),
        ]
    )
    await db_session.flush()
    return org


async def _create(db_session, org, user=LIBRARIAN, **fields):
    return await DocumentsService(db_session).create_folder(
        org.id, {"name": "Quartermaster files", **fields}, None, acting_user=user
    )


async def _update(db_session, org, folder, user=LIBRARIAN, **fields):
    return await DocumentsService(db_session).update_folder(
        folder.id, org.id, fields, acting_user=user
    )


class TestPermissionRestrictions:
    async def test_a_custom_folder_opens_to_a_permission(self, db_session, org):
        folder = await _create(
            db_session,
            org,
            required_permissions=["inventory.manage", "documents.manage"],
        )

        assert folder.required_permissions == ["inventory.manage", "documents.manage"]
        assert DocumentsService._folder_admits_user(folder, _member("inventory.manage"))
        assert not DocumentsService._folder_admits_user(
            folder, _member("inventory.view")
        )

    async def test_an_unknown_permission_is_refused(self, db_session, org):
        with pytest.raises(ValueError, match="Unknown permission: inventory.own"):
            await _create(db_session, org, required_permissions=["inventory.own"])

    async def test_duplicates_and_blanks_are_settled(self, db_session, org):
        folder = await _create(
            db_session,
            org,
            required_permissions=["documents.manage", " documents.manage", ""],
        )
        assert folder.required_permissions == ["documents.manage"]

        updated = await _update(db_session, org, folder, required_permissions=[])
        assert updated.required_permissions is None


class TestPositionRestrictions:
    async def test_positions_must_be_this_departments(self, db_session, org):
        other = Organization(name="Other FD", slug=f"fae-other-{uuid4().hex[:8]}")
        db_session.add(other)
        await db_session.flush()
        theirs = Position(organization_id=other.id, name="Chief", slug="chief")
        db_session.add(theirs)
        await db_session.flush()

        with pytest.raises(ValueError, match=f"Unknown position: {theirs.id}"):
            await _create(
                db_session, org, allowed_roles=[HISTORIAN, theirs.id], user=ADMIN
            )

    async def test_a_slug_is_not_an_id(self, db_session, org):
        with pytest.raises(ValueError, match="Unknown position: historian"):
            await _create(db_session, org, allowed_roles=["historian"], user=ADMIN)

    async def test_positions_need_a_folder_open_to_the_organization(
        self, db_session, org
    ):
        with pytest.raises(ValueError, match="open to the organization"):
            await _create(
                db_session,
                org,
                visibility="leadership",
                allowed_roles=[HISTORIAN],
            )

    async def test_switching_to_leadership_with_positions_left_is_refused(
        self, db_session, org
    ):
        folder = await _create(db_session, org, allowed_roles=[HISTORIAN])
        with pytest.raises(ValueError, match="open to the organization"):
            await _update(db_session, org, folder, visibility="leadership")


class TestBuiltInFolders:
    async def _root(self, db_session, org, slug="finance"):
        folder = DocumentFolder(organization_id=org.id, **system_folder_fields(slug))
        db_session.add(folder)
        await db_session.flush()
        return folder

    async def test_module_rights_cannot_be_replaced(self, db_session, org):
        root = await self._root(db_session, org)
        with pytest.raises(ValueError, match="module rights cannot be changed"):
            await _update(db_session, org, root, user=ADMIN, required_permissions=["*"])

    async def test_module_rights_resent_unchanged_still_save(self, db_session, org):
        root = await self._root(db_session, org)
        rights = list(root.required_permissions)
        updated = await _update(
            db_session,
            org,
            root,
            user=ADMIN,
            required_permissions=list(reversed(rights)),
            description="Receipts and statements",
        )
        assert updated.required_permissions == rights

    async def test_they_can_be_narrowed_to_positions(self, db_session, org):
        root = await self._root(db_session, org)
        updated = await _update(
            db_session, org, root, user=ADMIN, allowed_roles=[QUARTERMASTER]
        )

        treasurer = _member("finance.view", position="treasurer")
        quartermaster = _member("finance.view", position=QUARTERMASTER)
        assert not DocumentsService._folder_admits_user(updated, treasurer)
        assert DocumentsService._folder_admits_user(updated, quartermaster)
        # The module gate still applies to anyone in the position.
        assert not DocumentsService._folder_admits_user(
            updated, _member("documents.view", position=QUARTERMASTER)
        )


class TestPersonalFolders:
    async def test_their_access_cannot_be_changed(self, db_session, org):
        folder = DocumentFolder(
            organization_id=org.id,
            name="Smith, John",
            visibility=FolderVisibility.OWNER,
        )
        db_session.add(folder)
        await db_session.flush()
        with pytest.raises(ValueError, match="personal folder"):
            await _update(
                db_session, org, folder, user=ADMIN, visibility="organization"
            )

    async def test_resending_what_is_stored_still_saves(self, db_session, org):
        folder = DocumentFolder(
            organization_id=org.id,
            name="Smith, John",
            visibility=FolderVisibility.OWNER,
        )
        db_session.add(folder)
        await db_session.flush()
        updated = await _update(
            db_session,
            org,
            folder,
            user=ADMIN,
            visibility="owner",
            allowed_roles=None,
            description="Certificates",
        )
        assert updated.description == "Certificates"


class TestNobodyShutsThemselvesOut:
    async def test_creating_a_folder_you_cannot_open_is_refused(self, db_session, org):
        with pytest.raises(ValueError, match="shut you out"):
            await _create(db_session, org, allowed_roles=[QUARTERMASTER])

    async def test_saving_settings_you_fail_is_refused_and_nothing_changes(
        self, db_session, org
    ):
        folder = await _create(db_session, org, allowed_roles=[HISTORIAN])
        folder_id = folder.id

        with pytest.raises(ValueError, match="shut you out"):
            await _update(
                db_session, org, folder, required_permissions=["inventory.manage"]
            )

        # The refused change was rolled back, not just left unflushed.
        stored = (
            await db_session.execute(
                select(DocumentFolder).where(DocumentFolder.id == folder_id)
            )
        ).scalar_one()
        assert stored.required_permissions is None
        assert stored.allowed_roles == [HISTORIAN]

    async def test_a_view_only_permission_does_not_count_for_managing(
        self, db_session, org
    ):
        # The editor must still be able to manage the folder afterwards, and a
        # view-tier permission never admits a write (permission_matches_any_write).
        with pytest.raises(ValueError, match="shut you out"):
            await _create(
                db_session,
                org,
                user=_member("documents.manage", "inventory.view"),
                required_permissions=["inventory.view"],
            )

    async def test_a_full_administrator_may(self, db_session, org):
        folder = await _create(
            db_session, org, user=ADMIN, allowed_roles=[QUARTERMASTER]
        )
        assert folder.allowed_roles == [QUARTERMASTER]

    async def test_a_rename_alone_is_not_an_access_change(self, db_session, org):
        folder = await _create(
            db_session, org, user=ADMIN, allowed_roles=[QUARTERMASTER]
        )
        # The librarian cannot open it, but the shut-out check only runs on
        # an access change; reaching the folder at all is the endpoint's
        # own check.
        renamed = await _update(db_session, org, folder, name="Stores")
        assert renamed.name == "Stores"

"""The folder-access editor's rules (docs/FILE_STORAGE_HARDENING.md decision 27).

A custom folder can be restricted by position, by permission, or both. A
built-in folder keeps its module rights and can only be narrowed. A
personal folder's access is fixed. Nobody saves settings that shut
themselves out of the folder they are editing, except a full administrator.
"""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import select, text

from app.core.error_codes import CodedValueError, ErrorCode
from app.models.document import DocumentFolder, FolderVisibility, system_folder_fields
from app.models.user import Organization, Position, user_roles
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
    # A row for the stand-in ADMIN, so a confirmation it records names a real
    # member. Archived: the audience checks count active members, and this
    # row holds no positions of its own, so active it would be a member who
    # opens nothing.
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES (:id, :org, :un, "
            "'Stand-in', 'Chief', :em, 'hashed', 'archived')"
        ),
        {
            "id": ADMIN.id,
            "org": str(org.id),
            "un": f"admin-{ADMIN.id[:8]}",
            "em": f"admin-{ADMIN.id[:8]}@example.org",
        },
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


async def _active_member(db_session, org, *permissions, position_id=None):
    """A real active member whose permissions come from a position they hold."""
    if position_id is None:
        position = Position(
            organization_id=org.id,
            name=f"Holder {uuid4().hex[:6]}",
            slug=f"holder-{uuid4().hex[:8]}",
            permissions=list(permissions),
        )
        db_session.add(position)
        await db_session.flush()
        position_id = position.id
    user_id = str(uuid4())
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES (:id, :org, :un, "
            "'Test', 'Member', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": str(org.id),
            "un": f"m-{user_id[:8]}",
            "em": f"m-{user_id[:8]}@example.org",
        },
    )
    await db_session.execute(
        user_roles.insert().values(user_id=user_id, position_id=position_id)
    )
    await db_session.flush()
    return user_id


class TestAFolderNobodyButAdministratorsCanOpen:
    """Decision 29: such a folder needs confirming; it is not refused outright."""

    async def test_a_permission_nobody_holds_asks_for_confirmation(
        self, db_session, org
    ):
        await _active_member(db_session, org, "documents.view", "inventory.view")

        with pytest.raises(CodedValueError) as refused:
            await _create(
                db_session, org, user=ADMIN, required_permissions=["training.manage"]
            )
        assert refused.value.error_code == ErrorCode.DOC_FOLDER_ADMIN_ONLY

        folder = await DocumentsService(db_session).create_folder(
            org.id,
            {"name": "Admins only", "required_permissions": ["training.manage"]},
            None,
            acting_user=ADMIN,
            confirm_admin_only=True,
        )
        assert folder.required_permissions == ["training.manage"]

    async def test_a_permission_someone_holds_saves_without_asking(
        self, db_session, org
    ):
        await _active_member(db_session, org, "documents.view", "inventory.view")
        folder = await _create(
            db_session, org, user=ADMIN, required_permissions=["inventory.view"]
        )
        assert folder.required_permissions == ["inventory.view"]

    async def test_a_module_wildcard_counts_as_holding(self, db_session, org):
        await _active_member(db_session, org, "inventory.*")
        await _create(
            db_session, org, user=ADMIN, required_permissions=["inventory.manage"]
        )

    async def test_a_vacant_position_asks_for_confirmation(self, db_session, org):
        await _active_member(db_session, org, "documents.view")
        with pytest.raises(CodedValueError):
            await _create(db_session, org, user=ADMIN, allowed_roles=[QUARTERMASTER])

        await _active_member(db_session, org, position_id=QUARTERMASTER)
        await _create(db_session, org, user=ADMIN, allowed_roles=[QUARTERMASTER])

    async def test_a_parent_nobody_opens_counts(self, db_session, org):
        await _active_member(db_session, org, "documents.view")
        parent = await DocumentsService(db_session).create_folder(
            org.id,
            {"name": "Locked", "required_permissions": ["training.manage"]},
            None,
            acting_user=ADMIN,
            confirm_admin_only=True,
        )
        with pytest.raises(CodedValueError):
            await _create(db_session, org, user=ADMIN, parent_id=parent.id)

    async def test_an_update_that_shuts_everyone_out_is_rolled_back(
        self, db_session, org
    ):
        await _active_member(db_session, org, "documents.view", "inventory.view")
        folder = await _create(
            db_session, org, user=ADMIN, required_permissions=["inventory.view"]
        )
        folder_id = folder.id

        with pytest.raises(CodedValueError):
            await _update(
                db_session,
                org,
                folder,
                user=ADMIN,
                required_permissions=["training.manage"],
            )
        stored = (
            await db_session.execute(
                select(DocumentFolder).where(DocumentFolder.id == folder_id)
            )
        ).scalar_one()
        assert stored.required_permissions == ["inventory.view"]

    async def test_a_rename_of_an_admin_only_folder_does_not_ask(self, db_session, org):
        await _active_member(db_session, org, "documents.view")
        folder = await DocumentsService(db_session).create_folder(
            org.id,
            {"name": "Admins", "required_permissions": ["training.manage"]},
            None,
            acting_user=ADMIN,
            confirm_admin_only=True,
        )
        renamed = await _update(db_session, org, folder, user=ADMIN, name="Command")
        assert renamed.name == "Command"

    async def test_a_department_of_administrators_alone_is_not_asked(
        self, db_session, org
    ):
        # A fresh install: the system owner is the only account.
        await _active_member(db_session, org, "*")
        await _create(
            db_session, org, user=ADMIN, required_permissions=["training.manage"]
        )

    async def test_the_endpoint_returns_the_code_and_honours_the_confirmation(
        self, db_session, org
    ):
        from fastapi import HTTPException

        from app.api.v1.endpoints.documents import create_folder
        from app.schemas.documents import DocumentFolderCreate

        await _active_member(db_session, org, "documents.view")
        # A real row: the folder records who created it.
        chief_id = await _active_member(db_session, org, "*")
        caller = SimpleNamespace(
            id=chief_id,
            organization_id=org.id,
            username="chief",
            roles=ADMIN.roles,
            rank=None,
        )
        payload = {"name": "Admins", "required_permissions": ["training.manage"]}

        with pytest.raises(HTTPException) as refused:
            await create_folder(
                DocumentFolderCreate(**payload), db=db_session, current_user=caller
            )
        assert refused.value.status_code == 400
        assert refused.value.error_code == ErrorCode.DOC_FOLDER_ADMIN_ONLY

        created = await create_folder(
            DocumentFolderCreate(**payload, confirm_admin_only=True),
            db=db_session,
            current_user=caller,
        )
        assert created.required_permissions == ["training.manage"]


async def _remove_positions(db_session, user_id):
    await db_session.execute(user_roles.delete().where(user_roles.c.user_id == user_id))
    await db_session.flush()


async def _set_status(db_session, user_id, status):
    await db_session.execute(
        text("UPDATE users SET status = :status WHERE id = :id"),
        {"status": status, "id": user_id},
    )
    await db_session.flush()


async def _admin_only(db_session, org, viewer=ADMIN):
    folders = await DocumentsService(db_session).admin_only_folders(org.id, viewer)
    return [folder.name for folder in folders]


class TestAFolderThatLosesItsAudience:
    """Decision 30: a folder shut by a change to people, not to the folder, is
    listed for administrators until it is fixed or confirmed."""

    async def _quartermaster_folder(self, db_session, org):
        # Someone besides the quartermaster, so the department is never
        # administrators alone once the quartermaster goes.
        await _active_member(db_session, org, "documents.view")
        holder = await _active_member(db_session, org, position_id=QUARTERMASTER)
        folder = await _create(
            db_session, org, user=ADMIN, allowed_roles=[QUARTERMASTER]
        )
        return holder, folder

    async def test_an_open_folder_is_not_listed(self, db_session, org):
        await self._quartermaster_folder(db_session, org)
        assert await _admin_only(db_session, org) == []

    async def test_losing_the_last_holder_of_a_position_lists_it(self, db_session, org):
        holder, _ = await self._quartermaster_folder(db_session, org)
        await _remove_positions(db_session, holder)
        assert await _admin_only(db_session, org) == ["Quartermaster files"]

    async def test_archiving_the_last_holder_lists_it(self, db_session, org):
        holder, _ = await self._quartermaster_folder(db_session, org)
        await _set_status(db_session, holder, "archived")
        assert await _admin_only(db_session, org) == ["Quartermaster files"]

    async def test_a_probationary_holder_still_opens_it(self, db_session, org):
        holder, _ = await self._quartermaster_folder(db_session, org)
        await _set_status(db_session, holder, "probationary")
        assert await _admin_only(db_session, org) == []

    async def test_only_the_topmost_shut_folder_is_listed(self, db_session, org):
        holder, folder = await self._quartermaster_folder(db_session, org)
        await _create(db_session, org, user=ADMIN, name="Stores", parent_id=folder.id)
        await _remove_positions(db_session, holder)
        assert await _admin_only(db_session, org) == ["Quartermaster files"]

    async def test_a_personal_folder_is_left_out(self, db_session, org):
        await _active_member(db_session, org, "documents.view")
        owner = await _active_member(db_session, org, "documents.view")
        db_session.add(
            DocumentFolder(
                organization_id=org.id,
                name="Member's own",
                visibility=FolderVisibility.OWNER,
                owner_user_id=owner,
            )
        )
        await db_session.flush()
        await _set_status(db_session, owner, "archived")
        assert await _admin_only(db_session, org) == []

    async def test_nobody_but_a_full_administrator_is_shown_the_list(
        self, db_session, org
    ):
        holder, _ = await self._quartermaster_folder(db_session, org)
        await _remove_positions(db_session, holder)
        assert await _admin_only(db_session, org, viewer=LIBRARIAN) == []

    async def test_a_confirmed_folder_is_not_listed(self, db_session, org):
        holder, folder = await self._quartermaster_folder(db_session, org)
        await _remove_positions(db_session, holder)

        confirmed = await DocumentsService(db_session).confirm_admin_only(
            folder.id, org.id, ADMIN
        )
        assert confirmed.admin_only_confirmed_at is not None
        assert confirmed.admin_only_confirmed_by == ADMIN.id
        assert await _admin_only(db_session, org) == []

    async def test_confirming_a_folder_someone_else_opens_is_refused(
        self, db_session, org
    ):
        _, folder = await self._quartermaster_folder(db_session, org)
        with pytest.raises(ValueError, match="nothing to confirm"):
            await DocumentsService(db_session).confirm_admin_only(
                folder.id, org.id, ADMIN
            )

    async def test_confirming_at_save_is_recorded(self, db_session, org):
        await _active_member(db_session, org, "documents.view")
        folder = await DocumentsService(db_session).create_folder(
            org.id,
            {"name": "Command", "required_permissions": ["training.manage"]},
            None,
            acting_user=ADMIN,
            confirm_admin_only=True,
        )
        assert folder.admin_only_confirmed_at is not None
        assert await _admin_only(db_session, org) == []

    async def test_opening_it_to_someone_clears_the_confirmation(self, db_session, org):
        await _active_member(db_session, org, "documents.view", "inventory.view")
        folder = await DocumentsService(db_session).create_folder(
            org.id,
            {"name": "Command", "required_permissions": ["training.manage"]},
            None,
            acting_user=ADMIN,
            confirm_admin_only=True,
        )
        reopened = await _update(
            db_session, org, folder, user=ADMIN, required_permissions=["inventory.view"]
        )
        assert reopened.admin_only_confirmed_at is None
        assert reopened.admin_only_confirmed_by is None

    async def test_the_endpoints_list_and_confirm(self, db_session, org):
        from fastapi import HTTPException

        from app.api.v1.endpoints.documents import (
            confirm_admin_only_folder,
            list_admin_only_folders,
        )

        holder, folder = await self._quartermaster_folder(db_session, org)
        await _remove_positions(db_session, holder)
        chief_id = await _active_member(db_session, org, "*")
        chief = SimpleNamespace(
            id=chief_id,
            organization_id=org.id,
            username="chief",
            roles=ADMIN.roles,
            rank=None,
        )
        librarian = SimpleNamespace(
            id=LIBRARIAN.id,
            organization_id=org.id,
            username="librarian",
            roles=LIBRARIAN.roles,
            rank=None,
        )

        listed = await list_admin_only_folders(db=db_session, current_user=chief)
        assert [f.name for f in listed] == ["Quartermaster files"]

        # Closed to a documents manager who is not a full administrator.
        with pytest.raises(HTTPException) as hidden:
            await confirm_admin_only_folder(
                folder.id, db=db_session, current_user=librarian
            )
        assert hidden.value.status_code == 404

        await confirm_admin_only_folder(folder.id, db=db_session, current_user=chief)
        assert await list_admin_only_folders(db=db_session, current_user=chief) == []

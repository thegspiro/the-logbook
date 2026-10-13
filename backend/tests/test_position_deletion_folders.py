"""Deleting a position never strands or reopens a document folder.

Folders name positions by id (migration 5b2e9c7d4a18). Deleting a position
takes it out of every folder that lists it, and is refused while it is the
only position opening a folder: emptying that list would open the folder to
the whole department.
"""

import importlib.util
import json
import uuid
from pathlib import Path

import pytest
from sqlalchemy import select, text

from app.models.audit import AuditLog
from app.models.document import DocumentFolder, FolderVisibility
from app.models.user import Position, user_roles
from app.services.role_service import role_service

pytestmark = pytest.mark.integration


async def _position(db_session, org_id, name, permissions=None):
    position = Position(
        organization_id=org_id,
        name=name,
        slug=name.lower().replace(" ", "-"),
        permissions=permissions or ["documents.view"],
    )
    db_session.add(position)
    await db_session.flush()
    return position


async def _folder(db_session, org_id, name, roles, **kwargs):
    folder = DocumentFolder(
        organization_id=org_id, name=name, allowed_roles=roles, **kwargs
    )
    db_session.add(folder)
    await db_session.flush()
    return folder


@pytest.fixture
async def dept(db_session, setup_org_and_admin):
    org_id, admin_id = setup_org_and_admin
    # Deleting a position is refused if it would leave no administrator, so
    # the department keeps one through a position no test deletes.
    chief = await _position(db_session, org_id, "Chief", ["*"])
    await db_session.execute(
        user_roles.insert().values(user_id=admin_id, position_id=chief.id)
    )
    await db_session.flush()
    return org_id, admin_id


async def _delete(db_session, dept, position):
    org_id, admin_id = dept
    return await role_service.delete_role(
        db_session, str(position.id), str(org_id), str(admin_id)
    )


async def _roles_of(db_session, folder_id):
    return (
        await db_session.execute(
            select(DocumentFolder.allowed_roles).where(DocumentFolder.id == folder_id)
        )
    ).scalar_one()


class TestDeletingAPosition:
    async def test_it_leaves_every_folder_that_also_names_another(
        self, db_session, dept
    ):
        org_id, _ = dept
        quartermaster = await _position(db_session, org_id, "Quartermaster")
        captain = await _position(db_session, org_id, "Captain")
        stores = await _folder(
            db_session, org_id, "Stores", [quartermaster.id, captain.id]
        )
        stores_id, captain_id = stores.id, captain.id

        await _delete(db_session, dept, quartermaster)

        assert await _roles_of(db_session, stores_id) == [captain_id]
        audit = (
            await db_session.execute(
                select(AuditLog).where(AuditLog.event_type == "role_deleted")
            )
        ).scalar_one()
        assert audit.event_data["removed_from_folders"] == ["Stores"]

    async def test_it_is_refused_while_it_alone_opens_a_folder(self, db_session, dept):
        org_id, _ = dept
        quartermaster = await _position(db_session, org_id, "Quartermaster")
        await _folder(db_session, org_id, "Stores", [quartermaster.id])
        await _folder(db_session, org_id, "Uniforms", [quartermaster.id])
        quartermaster_id = quartermaster.id

        with pytest.raises(ValueError, match="only position.*Stores, Uniforms"):
            await _delete(db_session, dept, quartermaster)

        still_there = (
            await db_session.execute(
                select(Position.id).where(Position.id == quartermaster_id)
            )
        ).scalar_one_or_none()
        assert still_there == quartermaster_id

    async def test_a_leadership_folder_does_not_hold_it_back(self, db_session, dept):
        # Positions are not read on a leadership-only folder (older rows can
        # still carry them), so removing the last one opens nothing.
        org_id, _ = dept
        quartermaster = await _position(db_session, org_id, "Quartermaster")
        folder = await _folder(
            db_session,
            org_id,
            "Officers",
            [quartermaster.id],
            visibility=FolderVisibility.LEADERSHIP,
        )
        folder_id = folder.id

        await _delete(db_session, dept, quartermaster)

        assert await _roles_of(db_session, folder_id) is None

    async def test_a_new_position_with_the_same_name_inherits_nothing(
        self, db_session, dept
    ):
        org_id, _ = dept
        quartermaster = await _position(db_session, org_id, "Quartermaster")
        captain = await _position(db_session, org_id, "Captain")
        stores = await _folder(
            db_session, org_id, "Stores", [quartermaster.id, captain.id]
        )
        stores_id = stores.id
        await _delete(db_session, dept, quartermaster)

        successor = await _position(db_session, org_id, "Quartermaster")

        assert successor.id not in await _roles_of(db_session, stores_id)


MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261013_1130_5b2e9c7d4a18_folder_positions_by_id.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("folder_positions_by_id", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestTheMigration:
    async def test_slugs_become_this_departments_ids_and_back(
        self, db_session, dept, monkeypatch
    ):
        org_id, _ = dept
        quartermaster = await _position(db_session, org_id, "Quartermaster")
        folder_id = str(uuid.uuid4())
        # Written as the old code stored it: slugs, one of them orphaned.
        await db_session.execute(
            text(
                "INSERT INTO document_folders (id, organization_id, name, "
                "visibility, allowed_roles) VALUES (:id, :org, 'Stores', "
                "'organization', :roles)"
            ),
            {
                "id": folder_id,
                "org": str(org_id),
                "roles": json.dumps(["quartermaster", "deleted-long-ago"]),
            },
        )
        await db_session.flush()
        module = _migration()

        def run(direction):
            def apply(sync_session):
                monkeypatch.setattr(
                    module.op, "get_bind", lambda: sync_session.connection()
                )
                getattr(module, direction)()

            return apply

        async def stored():
            raw = (
                await db_session.execute(
                    text("SELECT allowed_roles FROM document_folders WHERE id = :id"),
                    {"id": folder_id},
                )
            ).scalar_one()
            return json.loads(raw) if isinstance(raw, str) else raw

        await db_session.run_sync(run("upgrade"))
        # The orphan stays as it was, so the folder stays closed rather than
        # opening to everyone because its list emptied.
        assert await stored() == [str(quartermaster.id), "deleted-long-ago"]

        await db_session.run_sync(run("downgrade"))
        assert await stored() == ["quartermaster", "deleted-long-ago"]

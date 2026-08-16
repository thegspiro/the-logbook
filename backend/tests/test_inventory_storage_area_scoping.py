"""
XC-1: storage-area create/update validate their client-supplied FKs.

A storage area carries two ids straight from the request body — the room it
sits in and the area it nests under. Neither was checked against the caller's
org, so an area could be filed under another organization's room, and the tree
view then read that room's name back into the response.

DB-free: the mocked `db.execute` drives `is_in_org`'s single lookup, so a
`scalar_one_or_none()` of None means "foreign/nonexistent" and any value means
"in-org".
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.inventory import create_storage_area, update_storage_area
from app.models.inventory import StorageArea, StorageLocationType
from app.schemas.inventory import StorageAreaCreate, StorageAreaUpdate
from app.services.inventory_service import InventoryService


def _result(value):
    r = MagicMock()
    r.scalar_one_or_none.return_value = value
    return r


@pytest.fixture(autouse=True)
def stub_barcode():
    """Stub the sequential-barcode allocator out.

    Storage areas were made always-scannable after these tests were written:
    create assigns the next code in the org's series, and update backfills one
    for an area that predates the rule. Both reach for the organization row and
    its settings JSON, which this DB-free fixture has no way to answer — and
    none of it is what these tests are about. Barcode allocation has its own
    coverage; this file is about which foreign keys are allowed through.
    """
    with patch.object(
        InventoryService,
        "next_storage_area_barcode",
        new=AsyncMock(return_value="SA-000001"),
    ) as stub:
        yield stub


@pytest.fixture(autouse=True)
def no_audit_log():
    """Stub audit logging out.

    It runs on the success path and issues its own statements against the same
    mocked session, which would otherwise be counted as the endpoint's.
    """
    with patch(
        "app.api.v1.endpoints.inventory.log_audit_event", new=AsyncMock()
    ) as stub:
        yield stub


@pytest.fixture
def org_id():
    return str(uuid4())


@pytest.fixture
def user(org_id):
    return SimpleNamespace(
        id=str(uuid4()), organization_id=org_id, username="quartermaster"
    )


@pytest.fixture
def db():
    session = AsyncMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    session.execute = AsyncMock()
    return session


def _existing_area(org_id):
    return StorageArea(
        id=str(uuid4()),
        organization_id=org_id,
        name="Rack A",
        storage_type=StorageLocationType.RACK,
        sort_order=0,
        is_active=True,
    )


class TestCreateStorageArea:
    async def test_foreign_room_is_rejected(self, db, user):
        db.execute.side_effect = [_result(None)]
        payload = StorageAreaCreate(
            name="Rack A", storage_type="rack", location_id=uuid4()
        )

        with pytest.raises(HTTPException) as exc:
            await create_storage_area(data=payload, db=db, current_user=user)

        assert exc.value.status_code == 400
        assert "room" in str(exc.value.detail).lower()
        db.add.assert_not_called()

    async def test_foreign_parent_area_is_rejected(self, db, user):
        # Room resolves in-org; the parent does not.
        db.execute.side_effect = [_result("room"), _result(None)]
        payload = StorageAreaCreate(
            name="Shelf 1",
            storage_type="shelf",
            location_id=uuid4(),
            parent_id=uuid4(),
        )

        with pytest.raises(HTTPException) as exc:
            await create_storage_area(data=payload, db=db, current_user=user)

        assert exc.value.status_code == 400
        assert "parent" in str(exc.value.detail).lower()
        db.add.assert_not_called()

    async def test_in_org_references_are_stored(self, db, user, org_id):
        db.execute.side_effect = [_result("room"), _result("parent")]
        room_id, parent_id = uuid4(), uuid4()
        payload = StorageAreaCreate(
            name="Shelf 1",
            storage_type="shelf",
            location_id=room_id,
            parent_id=parent_id,
        )

        await create_storage_area(data=payload, db=db, current_user=user)

        db.add.assert_called_once()
        area = db.add.call_args.args[0]
        assert area.organization_id == org_id
        assert area.location_id == str(room_id)
        assert area.parent_id == str(parent_id)

    async def test_an_unfiled_area_needs_no_lookup(self, db, user):
        """location_id and parent_id are optional — omitting both is legal."""
        payload = StorageAreaCreate(name="Loose bin", storage_type="bin")

        await create_storage_area(data=payload, db=db, current_user=user)

        db.execute.assert_not_awaited()
        db.add.assert_called_once()


class TestUpdateStorageArea:
    async def test_refiling_into_a_foreign_room_is_rejected(self, db, user, org_id):
        area = _existing_area(org_id)
        db.execute.side_effect = [_result(area), _result(None)]

        with pytest.raises(HTTPException) as exc:
            await update_storage_area(
                area_id=uuid4(),
                data=StorageAreaUpdate(location_id=uuid4()),
                db=db,
                current_user=user,
            )

        assert exc.value.status_code == 400
        assert "room" in str(exc.value.detail).lower()
        db.commit.assert_not_awaited()

    async def test_a_rename_does_not_trigger_fk_lookups(self, db, user, org_id):
        """An unset FK means "leave it alone", not "validate None"."""
        area = _existing_area(org_id)
        db.execute.side_effect = [_result(area)]

        await update_storage_area(
            area_id=uuid4(),
            data=StorageAreaUpdate(name="Rack B"),
            db=db,
            current_user=user,
        )

        assert area.name == "Rack B"
        # One execute: the org-scoped fetch of the area itself.
        assert db.execute.await_count == 1
        db.commit.assert_awaited_once()

    async def test_clearing_the_room_is_allowed(self, db, user, org_id):
        """An explicit null unfiles the area rather than failing validation."""
        area = _existing_area(org_id)
        area.location_id = str(uuid4())
        db.execute.side_effect = [_result(area)]

        await update_storage_area(
            area_id=uuid4(),
            data=StorageAreaUpdate(location_id=None),
            db=db,
            current_user=user,
        )

        assert area.location_id is None
        db.commit.assert_awaited_once()

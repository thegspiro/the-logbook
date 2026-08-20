"""
Tests for storage-area barcodes.

Every storage area carries a barcode so a shelf can be scanned the same way an
item can. Areas draw from their own per-organization series ("SA-000001"), kept
in ``organization.settings["storage_area_barcode"]`` so it never collides with
the item series in ``settings["barcode"]``. The DB session is mocked, so the
suite needs no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.api.v1.endpoints.inventory import create_storage_area, update_storage_area
from app.models.inventory import StorageArea, StorageLocationType
from app.schemas.inventory import StorageAreaCreate, StorageAreaUpdate
from app.services.inventory_service import InventoryService


def _service(org, *exists_results):
    """Service whose first scalar() returns the org (FOR UPDATE) and whose
    later scalar() calls answer the existence checks."""
    db = MagicMock()
    db.scalar = AsyncMock(side_effect=[org, *exists_results])
    db.flush = AsyncMock()
    return InventoryService(db), db


class TestNextStorageAreaBarcode:
    async def test_first_barcode_for_a_fresh_org(self):
        org = SimpleNamespace(settings={})
        service, db = _service(org, None)
        code = await service.next_storage_area_barcode(uuid4())
        assert code == "SA-000001"
        assert org.settings["storage_area_barcode"] == {
            "prefix": "SA-",
            "next_number": 2,
        }
        db.flush.assert_awaited()

    async def test_keeps_its_own_counter_apart_from_the_item_series(self):
        org = SimpleNamespace(
            settings={"barcode": {"prefix": "INV-", "next_number": 88}}
        )
        service, _ = _service(org, None)
        code = await service.next_storage_area_barcode(uuid4())
        # The item counter is untouched — a shelf must not consume an item number.
        assert code == "SA-000001"
        assert org.settings["barcode"]["next_number"] == 88

    async def test_continues_from_the_stored_counter(self):
        org = SimpleNamespace(
            settings={"storage_area_barcode": {"prefix": "SA-", "next_number": 12}}
        )
        service, _ = _service(org, None)
        assert await service.next_storage_area_barcode(uuid4()) == "SA-000012"
        assert org.settings["storage_area_barcode"]["next_number"] == 13

    async def test_skips_a_number_already_in_use(self):
        org = SimpleNamespace(settings={"storage_area_barcode": {"next_number": 4}})
        service, _ = _service(org, "taken-area-id", None)
        assert await service.next_storage_area_barcode(uuid4()) == "SA-000005"

    async def test_honours_a_configured_custom_prefix(self):
        org = SimpleNamespace(
            settings={"storage_area_barcode": {"prefix": "LOC-", "next_number": 3}}
        )
        service, _ = _service(org, None)
        assert await service.next_storage_area_barcode(uuid4()) == "LOC-000003"

    async def test_raises_when_org_missing(self):
        service, _ = _service(None)
        with pytest.raises(ValueError, match="Organization not found"):
            await service.next_storage_area_barcode(uuid4())


def _write_db():
    db = MagicMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.execute = AsyncMock()
    return db


def _user(org_id):
    return SimpleNamespace(id=str(uuid4()), organization_id=org_id, username="qm")


class TestCreateAssignsABarcode:
    async def test_generates_one_when_the_caller_sends_none(self):
        db = _write_db()
        data = StorageAreaCreate(name="Rack A", storage_type="rack")
        with (
            patch.object(
                InventoryService,
                "next_storage_area_barcode",
                AsyncMock(return_value="SA-000001"),
            ),
            patch("app.api.v1.endpoints.inventory.log_audit_event", AsyncMock()),
        ):
            response = await create_storage_area(
                data=data, db=db, current_user=_user(str(uuid4()))
            )
        assert response["barcode"] == "SA-000001"
        assert db.add.call_args.args[0].barcode == "SA-000001"

    async def test_keeps_an_explicit_barcode(self):
        db = _write_db()
        data = StorageAreaCreate(
            name="Rack A", storage_type="rack", barcode="LEGACY-42"
        )
        generator = AsyncMock(return_value="SA-000001")
        with (
            patch.object(InventoryService, "next_storage_area_barcode", generator),
            patch("app.api.v1.endpoints.inventory.log_audit_event", AsyncMock()),
        ):
            response = await create_storage_area(
                data=data, db=db, current_user=_user(str(uuid4()))
            )
        assert response["barcode"] == "LEGACY-42"
        generator.assert_not_awaited()

    async def test_treats_a_whitespace_barcode_as_absent(self):
        db = _write_db()
        data = StorageAreaCreate(name="Rack A", storage_type="rack", barcode="   ")
        with (
            patch.object(
                InventoryService,
                "next_storage_area_barcode",
                AsyncMock(return_value="SA-000009"),
            ),
            patch("app.api.v1.endpoints.inventory.log_audit_event", AsyncMock()),
        ):
            response = await create_storage_area(
                data=data, db=db, current_user=_user(str(uuid4()))
            )
        assert response["barcode"] == "SA-000009"


def _existing_area(org_id, barcode):
    area = StorageArea(
        id=str(uuid4()),
        organization_id=org_id,
        name="Rack A",
        storage_type=StorageLocationType.RACK,
        barcode=barcode,
        sort_order=0,
        is_active=True,
    )
    db = _write_db()
    found = MagicMock()
    found.scalar_one_or_none.return_value = area
    db.execute = AsyncMock(return_value=found)
    return area, db


class TestUpdateKeepsTheBarcode:
    async def test_a_blank_barcode_does_not_wipe_the_printed_one(self):
        org_id = str(uuid4())
        area, db = _existing_area(org_id, "SA-000004")
        with patch("app.api.v1.endpoints.inventory.log_audit_event", AsyncMock()):
            await update_storage_area(
                area_id=uuid4(),
                data=StorageAreaUpdate(barcode=""),
                db=db,
                current_user=_user(org_id),
            )
        assert area.barcode == "SA-000004"

    async def test_an_area_from_before_the_change_gets_one_on_first_edit(self):
        org_id = str(uuid4())
        area, db = _existing_area(org_id, None)
        with (
            patch.object(
                InventoryService,
                "next_storage_area_barcode",
                AsyncMock(return_value="SA-000021"),
            ),
            patch("app.api.v1.endpoints.inventory.log_audit_event", AsyncMock()),
        ):
            await update_storage_area(
                area_id=uuid4(),
                data=StorageAreaUpdate(name="Rack A1"),
                db=db,
                current_user=_user(org_id),
            )
        assert area.name == "Rack A1"
        assert area.barcode == "SA-000021"

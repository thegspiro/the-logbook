"""
Explicit nulls aimed at a value that cannot be cleared are refused by name.

Two update paths reached a comparison or a flush with a null the column could
not hold:

* ``InventoryService.update_item`` compared a pool item's new quantity with
  ``< 0``, so a blank quantity from the medical-supplies form raised a
  TypeError that came back as a 400 reading
  "'<' not supported between instances of 'NoneType' and 'int'".
* ``EquipmentCheckService.update_compartment`` wrote every key with a plain
  ``setattr``, so a null ``container_type`` (NOT NULL) reached the flush as an
  IntegrityError — a 500 — instead of the 400 ``update_item`` gives the same
  null through ``apply_updates``.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest

from app.models.apparatus import CheckTemplateCompartment
from app.models.inventory import InventoryItem, TrackingType
from app.services.equipment_check_service import EquipmentCheckService
from app.services.inventory_service import InventoryService

pytestmark = pytest.mark.unit


@pytest.fixture
def mock_db():
    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    db.execute = AsyncMock()
    return db


class TestPoolQuantityNull:
    @staticmethod
    def _pool_item():
        return InventoryItem(
            id=str(uuid4()),
            organization_id=str(uuid4()),
            name="Nitrile gloves",
            tracking_type=TrackingType.POOL,
            quantity=10,
        )

    async def test_a_null_quantity_on_a_pool_item_is_refused_by_name(self, mock_db):
        service = InventoryService(mock_db)
        item = self._pool_item()
        service._get_item_locked = AsyncMock(return_value=item)
        service.get_item_by_id = AsyncMock(return_value=item)

        result, err = await service.update_item(
            item_id=UUID(item.id),
            organization_id=UUID(item.organization_id),
            update_data={"quantity": None},
        )

        assert result is None
        assert err == "Pool item quantity is required"
        assert item.quantity == 10
        mock_db.commit.assert_not_awaited()

    async def test_a_negative_quantity_is_still_refused(self, mock_db):
        service = InventoryService(mock_db)
        item = self._pool_item()
        service._get_item_locked = AsyncMock(return_value=item)

        result, err = await service.update_item(
            item_id=UUID(item.id),
            organization_id=UUID(item.organization_id),
            update_data={"quantity": -1},
        )

        assert result is None
        assert err == "Pool item quantity cannot be negative"


class TestCompartmentNotNullColumns:
    @staticmethod
    def _compartment():
        return CheckTemplateCompartment(
            id=str(uuid4()),
            template_id=str(uuid4()),
            name="Driver side 1",
            container_type="bag",
        )

    async def test_a_null_container_type_is_a_value_error(self, mock_db):
        service = EquipmentCheckService(mock_db)
        compartment = self._compartment()
        service._get_compartment = AsyncMock(return_value=compartment)

        with pytest.raises(ValueError, match="container_type"):
            await service.update_compartment(
                compartment.id, "org-1", {"container_type": None}
            )

        assert compartment.container_type == "bag"
        mock_db.commit.assert_not_awaited()

    async def test_a_custom_container_type_and_a_cleared_parent_are_written(
        self, mock_db
    ):
        service = EquipmentCheckService(mock_db)
        compartment = self._compartment()
        compartment.parent_compartment_id = str(uuid4())
        service._get_compartment = AsyncMock(return_value=compartment)
        service._advance_content_revision = AsyncMock()
        result = MagicMock()
        result.scalars.return_value.first.return_value = compartment
        mock_db.execute.return_value = result

        await service.update_compartment(
            compartment.id,
            "org-1",
            {"container_type": "Trauma Kit", "parent_compartment_id": None},
        )

        assert compartment.container_type == "Trauma Kit"
        assert compartment.parent_compartment_id is None
        mock_db.commit.assert_awaited_once()

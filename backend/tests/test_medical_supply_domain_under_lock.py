"""MSUP-25: medical-domain writes re-check the domain under the item's lock.

The medical supplies routes check domain membership in a preflight, then call
a general inventory mutation. A reclassification landing between the two —
the item moved to a gear category, or its category's type changed — let a
medical-only manager edit stock outside their domain. Each mutation now takes
``required_item_types`` and re-validates against the locked rows, the way
``retire_item`` already did.

These tests land the reclassification first and then call the mutation: the
preflight is not in play, so what is proven is that the mutation itself
refuses on the current rows. Maintenance completion's RETIRED bypass is the
second half of the same finding.
"""

import uuid
from datetime import date

import pytest
from sqlalchemy import func, select

from app.models.inventory import (
    MEDICAL_ITEM_TYPES,
    InventoryCategory,
    InventoryItem,
    InventoryLot,
    ItemCondition,
    ItemType,
    TrackingType,
)
from app.models.user import Organization
from app.services.inventory_service import InventoryService, ItemOutsideDomainError

pytestmark = pytest.mark.integration


async def _org(db):
    org = Organization(name="Domain FD", slug=f"domain-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _category(db, org, item_type: ItemType) -> InventoryCategory:
    category = InventoryCategory(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=f"{item_type.value}-{uuid.uuid4().hex[:6]}",
        item_type=item_type,
    )
    db.add(category)
    await db.flush()
    return category


async def _item(db, org, category) -> InventoryItem:
    item = InventoryItem(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        category_id=category.id,
        name=f"gauze-{uuid.uuid4().hex[:6]}",
        tracking_type=TrackingType.POOL,
        quantity=10,
        active=True,
    )
    db.add(item)
    await db.flush()
    return item


async def _lot(db, org, item, quantity=5) -> InventoryLot:
    lot = InventoryLot(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        inventory_item_id=item.id,
        quantity=quantity,
        expiration_date=date(2027, 1, 1),
    )
    db.add(lot)
    await db.flush()
    return lot


@pytest.fixture
async def medical(db_session):
    """A medical item, plus a gear category to reclassify it into."""
    org = await _org(db_session)
    medical_category = await _category(db_session, org, ItemType.MEDICAL)
    gear_category = await _category(db_session, org, ItemType.EQUIPMENT)
    item = await _item(db_session, org, medical_category)
    return org, medical_category, gear_category, item


async def _lot_count(db, item_id) -> int:
    return await db.scalar(
        select(func.count(InventoryLot.id)).where(
            InventoryLot.inventory_item_id == item_id
        )
    )


class TestUpdateItem:
    async def test_an_item_moved_out_of_the_domain_is_not_found(
        self, db_session, medical
    ):
        org, _medical_category, gear_category, item = medical
        item.category_id = gear_category.id
        await db_session.flush()

        updated, error = await InventoryService(db_session).update_item(
            item.id, org.id, {"name": "renamed"}, required_item_types=MEDICAL_ITEM_TYPES
        )

        assert updated is None
        assert error == "Item not found"

    async def test_a_reclassified_category_is_not_found(self, db_session, medical):
        org, medical_category, _gear, item = medical
        medical_category.item_type = ItemType.EQUIPMENT
        await db_session.flush()

        updated, error = await InventoryService(db_session).update_item(
            item.id, org.id, {"name": "renamed"}, required_item_types=MEDICAL_ITEM_TYPES
        )

        assert (updated, error) == (None, "Item not found")

    async def test_a_move_into_a_gear_category_is_not_found(self, db_session, medical):
        org, _medical_category, gear_category, item = medical

        updated, error = await InventoryService(db_session).update_item(
            item.id,
            org.id,
            {"category_id": gear_category.id},
            required_item_types=MEDICAL_ITEM_TYPES,
        )

        assert (updated, error) == (None, "Item not found")

    async def test_an_item_still_in_the_domain_is_updated(self, db_session, medical):
        org, _medical_category, _gear, item = medical

        updated, error = await InventoryService(db_session).update_item(
            item.id,
            org.id,
            {"name": "Gauze 4x4"},
            required_item_types=MEDICAL_ITEM_TYPES,
        )

        assert error is None
        assert updated.name == "Gauze 4x4"


class TestLots:
    async def test_adding_a_lot_to_an_item_moved_out_is_refused(
        self, db_session, medical
    ):
        org, _medical_category, gear_category, item = medical
        item.category_id = gear_category.id
        await db_session.flush()

        lot = await InventoryService(db_session).add_lot(
            item.id, org.id, {"quantity": 3}, required_item_types=MEDICAL_ITEM_TYPES
        )

        assert lot is None
        assert await _lot_count(db_session, item.id) == 0

    async def test_a_delivery_with_one_line_moved_out_receives_nothing(
        self, db_session, medical
    ):
        org, medical_category, gear_category, item = medical
        other = await _item(db_session, org, medical_category)
        other.category_id = gear_category.id
        await db_session.flush()

        with pytest.raises(ItemOutsideDomainError):
            await InventoryService(db_session).add_lots_bulk(
                org.id,
                [
                    {"inventory_item_id": item.id, "quantity": 2},
                    {"inventory_item_id": other.id, "quantity": 2},
                ],
                required_item_types=MEDICAL_ITEM_TYPES,
            )

        assert await _lot_count(db_session, item.id) == 0

    async def test_a_lot_of_an_item_moved_out_is_neither_updated_nor_deleted(
        self, db_session, medical
    ):
        org, medical_category, _gear, item = medical
        lot = await _lot(db_session, org, item)
        medical_category.item_type = ItemType.EQUIPMENT
        await db_session.flush()
        service = InventoryService(db_session)

        assert (
            await service.update_lot(
                lot.id, org.id, {"quantity": 1}, required_item_types=MEDICAL_ITEM_TYPES
            )
            is None
        )
        assert (
            await service.delete_lot(
                lot.id, org.id, required_item_types=MEDICAL_ITEM_TYPES
            )
            is False
        )
        await db_session.refresh(lot)
        assert lot.quantity == 5

    async def test_lots_in_the_domain_are_written(self, db_session, medical):
        org, _medical_category, _gear, item = medical
        service = InventoryService(db_session)

        lot = await service.add_lot(
            item.id, org.id, {"quantity": 3}, required_item_types=MEDICAL_ITEM_TYPES
        )
        updated = await service.update_lot(
            lot.id, org.id, {"quantity": 4}, required_item_types=MEDICAL_ITEM_TYPES
        )

        assert updated.quantity == 4
        assert await service.delete_lot(
            lot.id, org.id, required_item_types=MEDICAL_ITEM_TYPES
        )

    async def test_callers_without_a_domain_are_unchanged(self, db_session, medical):
        org, _medical_category, gear_category, item = medical
        item.category_id = gear_category.id
        await db_session.flush()

        lot = await InventoryService(db_session).add_lot(
            item.id, org.id, {"quantity": 3}
        )

        assert lot is not None


class TestMaintenanceCannotRetire:
    async def test_completing_maintenance_as_retired_is_refused(
        self, db_session, medical
    ):
        org, _medical_category, _gear, item = medical

        record, error = await InventoryService(db_session).create_maintenance_record(
            item.id,
            org.id,
            {
                "maintenance_type": "repair",
                "is_completed": True,
                "condition_after": ItemCondition.RETIRED.value,
            },
            created_by=None,
        )

        assert record is None
        assert error == "Use the item's retire action to deactivate it"
        await db_session.refresh(item)
        assert item.condition != ItemCondition.RETIRED
        assert item.active is True

    async def test_completing_a_record_later_as_retired_is_refused(
        self, db_session, medical
    ):
        org, _medical_category, _gear, item = medical
        service = InventoryService(db_session)
        record, error = await service.create_maintenance_record(
            item.id, org.id, {"maintenance_type": "repair"}, created_by=None
        )
        assert error is None

        updated, error = await service.update_maintenance_record(
            record.id,
            item.id,
            org.id,
            {"is_completed": True, "condition_after": ItemCondition.RETIRED.value},
        )

        assert updated is None
        assert error == "Use the item's retire action to deactivate it"
        await db_session.refresh(item)
        assert item.condition != ItemCondition.RETIRED

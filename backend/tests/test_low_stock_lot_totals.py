"""The low-stock report reads lot-stocked items from their lots (W47-6).

``get_low_stock_items`` summed ``InventoryItem.quantity`` per category, and lot
bookkeeping never touches that column, so a category of lot-stocked supplies
read as empty against its threshold whatever its lots held. It now reads an
item's on-hand the way the reorder alert does: in-date lots for an item with
any lot, ``quantity`` otherwise. The dashboard tile that counts the report
leaves medical categories out, to match the inventory list it opens.
"""

import uuid
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.v1.endpoints.dashboard import get_asset_widgets
from app.models.inventory import (
    MEDICAL_ITEM_TYPES,
    InventoryCategory,
    InventoryItem,
    InventoryLot,
    ItemType,
    TrackingType,
)
from app.models.user import Organization
from app.services.inventory_service import InventoryService
from app.utils.org_timezone import org_today


async def _org(db):
    org = Organization(name="Stock FD", slug=f"stock-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _category(db, org, name, *, threshold, item_type=ItemType.CONSUMABLE):
    category = InventoryCategory(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=name,
        item_type=item_type,
        low_stock_threshold=threshold,
        active=True,
    )
    db.add(category)
    await db.flush()
    return category


async def _item(db, org, category, name, *, quantity=0, lots=()):
    """``lots`` is a sequence of (quantity, days until expiry or None)."""
    item = InventoryItem(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        category_id=category.id,
        name=name,
        tracking_type=TrackingType.POOL,
        quantity=quantity,
        active=True,
    )
    db.add(item)
    await db.flush()
    for lot_quantity, expires_in in lots:
        db.add(
            InventoryLot(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                inventory_item_id=item.id,
                quantity=lot_quantity,
                expiration_date=(
                    None
                    if expires_in is None
                    else org_today(org) + timedelta(days=expires_in)
                ),
            )
        )
    await db.flush()
    return item


@pytest.mark.integration
class TestLowStockReadsLots:
    async def test_a_well_stocked_lot_category_is_not_low(self, db_session):
        org = await _org(db_session)
        gauze = await _category(db_session, org, "Gauze", threshold=5)
        await _item(db_session, org, gauze, "4x4 gauze", lots=[(6, 90), (4, None)])

        rows = await InventoryService(db_session).get_low_stock_items(org.id)

        assert rows == []

    async def test_a_short_lot_category_reports_its_lot_total(self, db_session):
        org = await _org(db_session)
        tape = await _category(db_session, org, "Tape", threshold=5)
        # The quantity column says 50; the lots, which are the real count, say 2.
        await _item(db_session, org, tape, "Cloth tape", quantity=50, lots=[(2, 30)])

        rows = await InventoryService(db_session).get_low_stock_items(org.id)

        assert [(r["category_name"], r["current_stock"]) for r in rows] == [("Tape", 2)]
        assert rows[0]["items"] == [{"name": "Cloth tape", "quantity": 2}]

    async def test_expired_lots_count_as_nothing(self, db_session):
        org = await _org(db_session)
        splints = await _category(db_session, org, "Splints", threshold=1)
        await _item(db_session, org, splints, "SAM splint", quantity=20, lots=[(9, -1)])

        rows = await InventoryService(db_session).get_low_stock_items(org.id)

        assert [(r["category_name"], r["current_stock"]) for r in rows] == [
            ("Splints", 0)
        ]

    async def test_items_without_lots_still_read_quantity(self, db_session):
        org = await _org(db_session)
        gloves = await _category(db_session, org, "Gloves", threshold=10)
        await _item(db_session, org, gloves, "Nitrile M", quantity=3)
        await _item(db_session, org, gloves, "Nitrile L", lots=[(4, None)])

        rows = await InventoryService(db_session).get_low_stock_items(org.id)

        assert [(r["category_name"], r["current_stock"]) for r in rows] == [
            ("Gloves", 7)
        ]
        assert rows[0]["items"] == [
            {"name": "Nitrile M", "quantity": 3},
            {"name": "Nitrile L", "quantity": 4},
        ]

    async def test_medical_is_left_out_when_excluded(self, db_session):
        org = await _org(db_session)
        ems = await _category(
            db_session, org, "EMS", threshold=5, item_type=ItemType.MEDICAL
        )
        await _item(db_session, org, ems, "Tourniquet", lots=[(1, 30)])

        service = InventoryService(db_session)
        assert [
            r["category_name"] for r in await service.get_low_stock_items(org.id)
        ] == ["EMS"]
        assert (
            await service.get_low_stock_items(
                org.id, exclude_item_types=MEDICAL_ITEM_TYPES
            )
            == []
        )


@pytest.mark.unit
async def test_dashboard_low_stock_tile_excludes_medical():
    db = MagicMock()
    db.scalar = AsyncMock(return_value=0)
    with (
        patch(
            "app.api.v1.endpoints.dashboard.OrganizationService.get_enabled_modules",
            new=AsyncMock(return_value=SimpleNamespace(enabled_modules=["inventory"])),
        ),
        patch(
            "app.api.v1.endpoints.dashboard.user_has_permission",
            side_effect=lambda _user, permission: permission == "inventory.manage",
        ),
        patch(
            "app.api.v1.endpoints.dashboard.resolve_org_today",
            new=AsyncMock(return_value=date.today()),
        ),
        patch("app.api.v1.endpoints.dashboard.InventoryService") as inventory,
    ):
        inventory.return_value.get_inventory_summary = AsyncMock(
            return_value={"total_items": 0}
        )
        low_stock = AsyncMock(return_value=[{"category_id": "c"}])
        inventory.return_value.get_low_stock_items = low_stock
        response = await get_asset_widgets(
            db=db, current_user=SimpleNamespace(id="u", organization_id="org-a")
        )

    low_stock.assert_awaited_once_with("org-a", exclude_item_types=MEDICAL_ITEM_TYPES)
    tile = next(w for w in response.widgets if w.id == "inventory-low-stock")
    assert tile.count == 1

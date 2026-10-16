"""
Medical Supplies: the low-stock list and sizes on expiring lots.

The "Low stock" figure on the page and the list it opens must be the same
set, so the list filter reuses the scan the summary counts with. Expiring
lots carry their supply's size, so the adult and pediatric versions of one
supply can be told apart on the list where it matters most.
"""

import uuid
from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from app.api.v1.endpoints import medical_supplies as ms
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
from app.utils.org_timezone import resolve_org_today

pytestmark = pytest.mark.integration


@pytest.fixture
async def stock(db_session):
    org = Organization(name="Low FD", slug=f"low-{uuid.uuid4().hex[:8]}")
    db_session.add(org)
    await db_session.flush()
    medical = InventoryCategory(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Airway",
        item_type=ItemType.MEDICAL,
    )
    gear = InventoryCategory(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Tools",
        item_type=ItemType.TOOL,
    )
    db_session.add_all([medical, gear])
    await db_session.flush()

    def item(name, cat, quantity, reorder_point=None, size=None):
        row = InventoryItem(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            category_id=cat.id,
            name=name,
            size=size,
            tracking_type=TrackingType.POOL,
            quantity=quantity,
            reorder_point=reorder_point,
            active=True,
        )
        db_session.add(row)
        return row

    items = {
        "low": item("Gauze", medical, 2, reorder_point=5),
        "fine": item("Cannula", medical, 20, reorder_point=5),
        "no_floor": item("Shears", medical, 0),
        "gear_low": item("Rope", gear, 0, reorder_point=3),
        "peds": item("Oxygen Mask", medical, 0, size="Pediatric"),
    }
    await db_session.flush()
    db_session.add(
        InventoryLot(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            inventory_item_id=items["peds"].id,
            quantity=3,
            expiration_date=date.today() + timedelta(days=5),
        )
    )
    await db_session.flush()
    return org, items


def _user(org):
    return SimpleNamespace(id="u-1", username="supply", organization_id=org.id)


async def _list(db_session, org, **kwargs):
    defaults = dict(
        category_id=None,
        status_filter=None,
        condition=None,
        location_id=None,
        storage_area_id=None,
        search=None,
        active_only=True,
        sort_by=None,
        sort_order=None,
        skip=0,
        limit=100,
        fuzzy=False,
        low_stock=False,
    )
    defaults.update(kwargs)
    return await ms.list_medical_items(
        **defaults, db=db_session, current_user=_user(org)
    )


class TestLowStockList:
    async def test_lists_only_medical_supplies_at_or_below_their_floor(
        self, db_session, stock
    ):
        org, items = stock

        result = await _list(db_session, org, low_stock=True)

        # A supply with no reorder point is never "low", and gear never
        # appears on the medical list.
        assert [i.name for i in result.items] == ["Gauze"]
        assert result.total == 1

    async def test_matches_the_summary_figure(self, db_session, stock):
        org, _ = stock

        result = await _list(db_session, org, low_stock=True)
        summary = await ms.medical_supply_summary(
            expiring_within_days=30, db=db_session, current_user=_user(org)
        )

        assert result.total == summary["low_stock"]

    async def test_combines_with_search(self, db_session, stock):
        org, _ = stock

        result = await _list(db_session, org, low_stock=True, search="cannula")

        assert result.items == []

    async def test_off_by_default(self, db_session, stock):
        org, _ = stock

        result = await _list(db_session, org)

        assert {i.name for i in result.items} == {
            "Gauze",
            "Cannula",
            "Shears",
            "Oxygen Mask",
        }


class TestItemIdsFilter:
    async def test_an_empty_set_means_none_not_all(self, db_session, stock):
        org, _ = stock

        rows, total = await InventoryService(db_session).get_items(
            organization_id=org.id, item_types=MEDICAL_ITEM_TYPES, item_ids=[]
        )

        assert rows == []
        assert total == 0


class TestExpiringLotSizes:
    async def test_an_expiring_lot_names_its_supplys_size(self, db_session, stock):
        org, _ = stock

        lots = await ms.list_expiring_medical_lots(
            days_ahead=30, db=db_session, current_user=_user(org)
        )

        assert [(lot.item_name, lot.item_size) for lot in lots] == [
            ("Oxygen Mask", "Pediatric")
        ]

    async def test_item_sizes_ignores_another_departments_items(
        self, db_session, stock
    ):
        _org, items = stock

        sizes = await InventoryService(db_session).item_sizes(
            str(uuid.uuid4()), [items["peds"].id]
        )

        assert sizes == {}


class TestNextExpiry:
    async def test_each_supply_carries_its_soonest_stocked_expiry(
        self, db_session, stock
    ):
        org, items = stock
        today = await resolve_org_today(db_session, org.id)
        expired = today - timedelta(days=10)
        db_session.add_all(
            [
                # Expired with units left: the most urgent date, so it wins.
                InventoryLot(
                    id=str(uuid.uuid4()),
                    organization_id=org.id,
                    inventory_item_id=items["low"].id,
                    quantity=1,
                    expiration_date=expired,
                ),
                InventoryLot(
                    id=str(uuid.uuid4()),
                    organization_id=org.id,
                    inventory_item_id=items["low"].id,
                    quantity=4,
                    expiration_date=today + timedelta(days=90),
                ),
                # An empty lot has nothing left to expire.
                InventoryLot(
                    id=str(uuid.uuid4()),
                    organization_id=org.id,
                    inventory_item_id=items["fine"].id,
                    quantity=0,
                    expiration_date=today - timedelta(days=30),
                ),
            ]
        )
        await db_session.flush()

        result = await _list(db_session, org)

        by_name = {i.name: i for i in result.items}
        assert by_name["Gauze"].next_expiration_date == expired
        assert by_name["Gauze"].days_until_next_expiration == -10
        assert by_name["Cannula"].next_expiration_date is None
        assert by_name["Shears"].days_until_next_expiration is None
        peds_lot = date.today() + timedelta(days=5)
        assert by_name["Oxygen Mask"].next_expiration_date == peds_lot
        assert by_name["Oxygen Mask"].days_until_next_expiration == (
            (peds_lot - today).days
        )

    async def test_ignores_another_departments_lots(self, db_session, stock):
        _org, items = stock

        soonest = await InventoryService(db_session).next_lot_expirations(
            str(uuid.uuid4()), [items["peds"].id]
        )

        assert soonest == {}


class TestCategoryCounts:
    async def test_each_medical_category_counts_its_active_supplies(
        self, db_session, stock
    ):
        org, items = stock
        items["fine"].active = False
        db_session.add(
            InventoryCategory(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                name="Empty",
                item_type=ItemType.MEDICAL,
            )
        )
        await db_session.flush()

        categories = await ms.list_medical_categories(
            active_only=True, db=db_session, current_user=_user(org)
        )

        assert {c.name: c.item_count for c in categories} == {
            "Airway": 3,
            "Empty": 0,
        }

    async def test_ignores_another_departments_items(self, db_session, stock):
        _org, items = stock

        counts = await InventoryService(db_session).category_item_counts(
            str(uuid.uuid4()), [items["low"].category_id]
        )

        assert counts == {}

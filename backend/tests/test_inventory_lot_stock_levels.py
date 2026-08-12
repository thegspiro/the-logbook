"""
Stock lots as the on-hand ledger, and receiving a delivery in one pass.

Lots and InventoryItem.quantity are separate ledgers — adding a lot does not
touch quantity — so a consumable stocked purely through lots could sit at zero
ready units without ever tripping the reorder alert. These tests pin which
ledger the alert reads, and the bulk receive that makes pre-stocking practical.

Mocked sessions — no DB — so they run in the sandbox.
"""

from datetime import date, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.inventory import InventoryLot
from app.services.inventory_service import InventoryService

YESTERDAY = date.today() - timedelta(days=1)
NEXT_YEAR = date.today() + timedelta(days=365)


@pytest.fixture
def mock_db():
    db = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.add = MagicMock()
    return db


@pytest.fixture
def service(mock_db):
    return InventoryService(mock_db)


def _item(item_id, quantity, reorder_point):
    item = MagicMock()
    item.id = item_id
    item.quantity = quantity
    item.reorder_point = reorder_point
    return item


def _wire_low_stock(mock_db, items, lot_totals):
    """First select returns the candidate items, second the per-item lot sums."""
    items_result = MagicMock()
    items_result.scalars.return_value.all.return_value = items
    totals_result = MagicMock()
    totals_result.all.return_value = lot_totals
    mock_db.execute = AsyncMock(side_effect=[items_result, totals_result])


class TestLowStockUsesLotsWhenPresent:
    async def test_lot_stocked_item_is_flagged_though_quantity_looks_healthy(
        self, service, mock_db
    ):
        # quantity says 50 but every lot has been swapped out — the column was
        # never maintained because lots are what the supply screens write.
        item = _item("i-1", quantity=50, reorder_point=10)
        _wire_low_stock(mock_db, [item], [("i-1", 2)])

        low = await service.get_low_stock_items_for_alerts("org-1")

        assert low == [(item, 2, True)]

    async def test_lot_stocked_item_above_its_point_is_not_flagged(
        self, service, mock_db
    ):
        item = _item("i-1", quantity=0, reorder_point=10)
        _wire_low_stock(mock_db, [item], [("i-1", 40)])

        assert await service.get_low_stock_items_for_alerts("org-1") == []

    async def test_expired_lots_do_not_count_as_stock(self, service, mock_db):
        # The grouped query sums only in-date lots, so an item whose lots have
        # all expired reports zero rather than falling back to quantity.
        item = _item("i-1", quantity=50, reorder_point=10)
        _wire_low_stock(mock_db, [item], [("i-1", 0)])

        low = await service.get_low_stock_items_for_alerts("org-1")

        assert low == [(item, 0, True)]

    async def test_item_without_lots_still_uses_its_quantity(self, service, mock_db):
        item = _item("i-1", quantity=3, reorder_point=10)
        _wire_low_stock(mock_db, [item], [])

        low = await service.get_low_stock_items_for_alerts("org-1")

        assert low == [(item, 3, False)]

    async def test_ledgers_are_reported_per_item(self, service, mock_db):
        lot_stocked = _item("i-1", quantity=99, reorder_point=10)
        quantity_stocked = _item("i-2", quantity=1, reorder_point=10)
        _wire_low_stock(mock_db, [lot_stocked, quantity_stocked], [("i-1", 4)])

        low = await service.get_low_stock_items_for_alerts("org-1")

        # Sorted by how short each one is, so the email leads with the worst.
        assert low == [(quantity_stocked, 1, False), (lot_stocked, 4, True)]

    async def test_no_candidates_skips_the_lot_query(self, service, mock_db):
        items_result = MagicMock()
        items_result.scalars.return_value.all.return_value = []
        mock_db.execute = AsyncMock(return_value=items_result)

        assert await service.get_low_stock_items_for_alerts("org-1") == []
        assert mock_db.execute.await_count == 1


class TestItemsCarryTheirLotStock:
    """The grid and the export read the same ledger the reorder alert does."""

    async def test_lot_stocked_items_are_marked_with_their_ready_count(
        self, service, mock_db
    ):
        lot_stocked = _item("i-1", quantity=50, reorder_point=None)
        plain = _item("i-2", quantity=7, reorder_point=None)
        totals_result = MagicMock()
        totals_result.all.return_value = [("i-1", 12)]
        mock_db.execute = AsyncMock(return_value=totals_result)

        await service._attach_lot_stock("org-1", [lot_stocked, plain])

        assert (lot_stocked.is_lot_stocked, lot_stocked.lot_stock) == (True, 12)
        # No lots at all: nothing to prefer over the quantity column, and the
        # null says so rather than implying zero stock.
        assert (plain.is_lot_stocked, plain.lot_stock) == (False, None)

    async def test_item_whose_lots_all_expired_reads_as_zero_not_stale(
        self, service, mock_db
    ):
        item = _item("i-1", quantity=50, reorder_point=None)
        totals_result = MagicMock()
        totals_result.all.return_value = [("i-1", 0)]
        mock_db.execute = AsyncMock(return_value=totals_result)

        await service._attach_lot_stock("org-1", [item])

        assert (item.is_lot_stocked, item.lot_stock) == (True, 0)

    async def test_no_items_skips_the_query(self, service, mock_db):
        mock_db.execute = AsyncMock()

        await service._attach_lot_stock("org-1", [])

        mock_db.execute.assert_not_awaited()


class TestAddLotsBulk:
    def _wire_items(self, mock_db, known_ids):
        result = MagicMock()
        result.scalars.return_value.all.return_value = known_ids
        mock_db.execute = AsyncMock(return_value=result)

    async def test_receives_a_delivery_as_dated_lots(self, service, mock_db):
        self._wire_items(mock_db, ["i-1", "i-2"])

        lots = await service.add_lots_bulk(
            "org-1",
            [
                {
                    "inventory_item_id": "i-1",
                    "quantity": 20,
                    "lot_number": "LOT-A",
                    "expiration_date": NEXT_YEAR,
                },
                {"inventory_item_id": "i-2", "quantity": 5},
            ],
            created_by="u-1",
        )

        assert [lot.quantity for lot in lots] == [20, 5]
        assert lots[0].lot_number == "LOT-A"
        assert lots[0].expiration_date == NEXT_YEAR
        assert lots[0].organization_id == "org-1"
        assert lots[0].created_by == "u-1"
        mock_db.commit.assert_awaited_once()

    async def test_a_foreign_item_rejects_the_whole_delivery(self, service, mock_db):
        # XC-1: the ids are client-supplied. A partly-applied delivery is worse
        # than a rejected one — the officer cannot tell which lines landed.
        self._wire_items(mock_db, ["i-1"])

        with pytest.raises(ValueError, match="not in your inventory"):
            await service.add_lots_bulk(
                "org-1",
                [
                    {"inventory_item_id": "i-1", "quantity": 20},
                    {"inventory_item_id": "other-org-item", "quantity": 5},
                ],
            )

        assert not [
            call.args[0]
            for call in mock_db.add.call_args_list
            if isinstance(call.args[0], InventoryLot)
        ]
        mock_db.commit.assert_not_awaited()

    async def test_empty_delivery_is_a_no_op(self, service, mock_db):
        assert await service.add_lots_bulk("org-1", []) == []
        mock_db.commit.assert_not_awaited()

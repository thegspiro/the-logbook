"""Tests for inventory stock-lot and equipment-check swap schemas.

Pure Pydantic-schema tests (no database) covering the lot CRUD schemas,
the camelCase supply-overview serialization, and the lot-swap request/response.
"""

from app.schemas.equipment_check import (
    ApparatusInventoryCompartment,
    ApparatusInventoryItem,
    ApparatusInventoryResponse,
    LotSwapRequest,
    LotSwapResponse,
    ReadyLot,
    SupplyExpiringItem,
    SupplyOverviewResponse,
)
from app.schemas.inventory import (
    ExpiringLotResponse,
    InventoryLotBulkCreate,
    InventoryLotBulkEntry,
    InventoryLotCreate,
    InventoryLotUpdate,
)


class TestInventoryLotSchemas:
    def test_create_defaults_quantity_zero(self):
        lot = InventoryLotCreate()
        assert lot.quantity == 0

    def test_create_accepts_lot_fields(self):
        lot = InventoryLotCreate(
            lot_number="LOT-9", quantity=5, expiration_date="2027-01-01"
        )
        assert lot.lot_number == "LOT-9"
        assert lot.quantity == 5
        assert str(lot.expiration_date) == "2027-01-01"

    def test_create_rejects_negative_quantity(self):
        try:
            InventoryLotCreate(quantity=-1)
        except Exception:
            return
        raise AssertionError("negative quantity should be rejected")

    def test_update_is_partial(self):
        update = InventoryLotUpdate(quantity=3)
        dumped = update.model_dump(exclude_unset=True)
        assert dumped == {"quantity": 3}

    def test_expiring_lot_carries_item_name(self):
        resp = ExpiringLotResponse.model_validate(
            {
                "id": "11111111-1111-1111-1111-111111111111",
                "organization_id": "22222222-2222-2222-2222-222222222222",
                "inventory_item_id": "33333333-3333-3333-3333-333333333333",
                "quantity": 4,
                "created_at": "2026-07-01T00:00:00Z",
                "updated_at": "2026-07-01T00:00:00Z",
                "item_name": "4x4 Gauze",
                "days_until_expiration": 12,
            }
        )
        assert resp.item_name == "4x4 Gauze"
        assert resp.days_until_expiration == 12


class TestApparatusInventorySchemas:
    def test_serializes_camel_case_for_the_crew_view(self):
        payload = ApparatusInventoryResponse(
            apparatus_id="app-1",
            apparatus_name="Engine 1",
            compartments=[
                ApparatusInventoryCompartment(
                    compartment_id="c-1",
                    compartment_name="Front Bumper",
                    items=[
                        ApparatusInventoryItem(
                            template_item_id="ti-1",
                            item_name="4x4 Gauze",
                            restock_needed=True,
                            restock_note="used two",
                            ready_stock=6,
                        )
                    ],
                )
            ],
        ).model_dump(by_alias=True)

        assert payload["apparatusName"] == "Engine 1"
        item = payload["compartments"][0]["items"][0]
        assert item["restockNeeded"] is True
        assert item["restockNote"] == "used two"
        assert item["readyStock"] == 6

    def test_an_item_defaults_to_no_outstanding_report(self):
        item = ApparatusInventoryItem(template_item_id="ti-1", item_name="Epi")
        assert item.restock_needed is False
        assert item.ready_stock == 0


class TestBulkReceiveSchemas:
    def test_entry_carries_the_item_and_its_dates(self):
        entry = InventoryLotBulkEntry(
            inventory_item_id="i-1",
            quantity=24,
            lot_number="LOT-A",
            expiration_date="2027-03-01",
        )
        assert entry.inventory_item_id == "i-1"
        assert str(entry.expiration_date) == "2027-03-01"

    def test_entry_rejects_a_zero_quantity(self):
        # Unlike a standalone lot, a received line with no units is a slip:
        # goods came through the door or the line should not be there.
        try:
            InventoryLotBulkEntry(inventory_item_id="i-1", quantity=0)
        except Exception:
            return
        raise AssertionError("a received line of zero should be rejected")

    def test_delivery_requires_at_least_one_line(self):
        try:
            InventoryLotBulkCreate(entries=[])
        except Exception:
            return
        raise AssertionError("an empty delivery should be rejected")

    def test_delivery_accepts_many_lines(self):
        delivery = InventoryLotBulkCreate(
            entries=[
                InventoryLotBulkEntry(inventory_item_id=f"i-{n}", quantity=1)
                for n in range(20)
            ]
        )
        assert len(delivery.entries) == 20


class TestSupplyAndSwapSchemas:
    def test_supply_overview_serializes_camel_case(self):
        item = SupplyExpiringItem(
            template_item_id="ti1",
            item_name="IV Bag",
            ready_stock=2,
            ready_lots=[ReadyLot(id="l1", quantity=2, lot_number="LOT-1")],
        )
        payload = SupplyOverviewResponse(
            days_ahead=30, total=1, items=[item]
        ).model_dump(by_alias=True)
        assert payload["daysAhead"] == 30
        assert payload["items"][0]["templateItemId"] == "ti1"
        assert payload["items"][0]["readyStock"] == 2
        assert payload["items"][0]["readyLots"][0]["lotNumber"] == "LOT-1"

    def test_swap_request_requires_lot_id(self):
        req = LotSwapRequest(inventory_lot_id="lot-9")
        assert req.inventory_lot_id == "lot-9"

    def test_swap_response_camel_case(self):
        payload = LotSwapResponse(
            template_item_id="ti1", lot_number="LOT-9", remaining_quantity=4
        ).model_dump(by_alias=True)
        assert payload["templateItemId"] == "ti1"
        assert payload["remainingQuantity"] == 4

"""
Medical Supplies domain isolation.

The medical page and the gear page share one catalog, so the only thing
keeping an EMS supply officer out of the uniform closet is that every route
on the medical router pins the domain server-side and re-checks the target of
every by-id write. These tests pin that: a permission grants access to a
domain, never to a row.

Mocked service and session — no DB — so they run in the sandbox.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import medical_supplies as ms
from app.models.inventory import MEDICAL_ITEM_TYPES, ItemType
from app.schemas.inventory import (
    InventoryCategoryCreate,
    InventoryCategoryUpdate,
    InventoryItemCreate,
    InventoryItemUpdate,
    InventoryLotBulkCreate,
)

ORG = "org-1"
MEDICAL_CAT = "11111111-1111-1111-1111-111111111111"
GEAR_CAT = "22222222-2222-2222-2222-222222222222"
MEDICAL_ITEM = "33333333-3333-3333-3333-333333333333"
GEAR_ITEM = "44444444-4444-4444-4444-444444444444"


def _user():
    user = MagicMock()
    user.id = "u-1"
    user.username = "supply"
    user.organization_id = ORG
    return user


def _service(**overrides):
    """A service that knows which ids are medical and which are gear."""
    svc = AsyncMock()
    svc.category_in_domain = AsyncMock(
        side_effect=lambda cid, org, types: str(cid) == MEDICAL_CAT
    )
    svc.item_in_domain = AsyncMock(
        side_effect=lambda iid, org, types: str(iid) == MEDICAL_ITEM
    )
    svc.lot_in_domain = AsyncMock(return_value=True)
    for name, value in overrides.items():
        setattr(svc, name, value)
    return svc


@pytest.fixture
def svc():
    """Patch the service class the router constructs, and silence audit."""
    service = _service()
    with patch.object(ms, "InventoryService", return_value=service), patch.object(
        ms, "log_audit_event", new=AsyncMock()
    ):
        yield service


class TestDomainConstant:
    def test_medical_domain_is_exactly_the_medical_type(self):
        """The router's whole isolation story rests on this set."""
        assert MEDICAL_ITEM_TYPES == frozenset({ItemType.MEDICAL})

    def test_medical_is_last_in_the_enum(self):
        """MySQL stores an ENUM as an ordinal.

        Inserting a member mid-list silently reclassifies every category
        already on file, so new members are appended.
        """
        assert list(ItemType)[-1] is ItemType.MEDICAL


class TestCategoryDomainPinning:
    async def test_create_forces_the_medical_domain(self, svc):
        """A payload claiming to be a uniform category is still filed medical."""
        svc.create_category = AsyncMock(return_value=(MagicMock(id="c-9"), None))

        await ms.create_medical_category(
            InventoryCategoryCreate(name="Airway", item_type="uniform"),
            db=AsyncMock(),
            current_user=_user(),
        )

        stored = svc.create_category.await_args.kwargs["category_data"]
        assert stored["item_type"] == "medical"

    async def test_create_rejects_a_gear_parent(self, svc):
        with pytest.raises(HTTPException) as err:
            await ms.create_medical_category(
                InventoryCategoryCreate(
                    name="Airway", item_type="medical", parent_category_id=GEAR_CAT
                ),
                db=AsyncMock(),
                current_user=_user(),
            )
        assert err.value.status_code == 404

    async def test_update_refuses_to_reclassify_out_of_the_domain(self, svc):
        """Reclassifying would move the category's stock to the other page."""
        with pytest.raises(HTTPException) as err:
            await ms.update_medical_category(
                MEDICAL_CAT,
                InventoryCategoryUpdate(item_type="uniform"),
                db=AsyncMock(),
                current_user=_user(),
            )
        assert err.value.status_code == 400
        assert "cannot be reclassified" in err.value.detail

    async def test_update_of_a_gear_category_is_not_found(self, svc):
        """404, not 403 — a gear category does not exist to this officer."""
        with pytest.raises(HTTPException) as err:
            await ms.update_medical_category(
                GEAR_CAT,
                InventoryCategoryUpdate(name="Renamed"),
                db=AsyncMock(),
                current_user=_user(),
            )
        assert err.value.status_code == 404

    async def test_update_never_forwards_item_type(self, svc):
        """Even 'medical' is dropped rather than written back."""
        svc.update_category = AsyncMock(return_value=(MagicMock(), None))

        await ms.update_medical_category(
            MEDICAL_CAT,
            InventoryCategoryUpdate(item_type="medical", name="Airway"),
            db=AsyncMock(),
            current_user=_user(),
        )

        assert "item_type" not in svc.update_category.await_args.kwargs["update_data"]


class TestItemDomainPinning:
    async def test_list_is_restricted_to_the_medical_domain(self, svc):
        svc.get_items = AsyncMock(return_value=([], 0))

        # Query-defaulted params are passed explicitly: calling the handler
        # directly skips FastAPI's dependency resolution, so the unresolved
        # Query objects would arrive as values.
        await ms.list_medical_items(
            status_filter=None,
            sort_order=None,
            skip=0,
            limit=100,
            db=AsyncMock(),
            current_user=_user(),
        )

        assert svc.get_items.await_args.kwargs["item_types"] == MEDICAL_ITEM_TYPES

    async def test_create_requires_a_medical_category(self, svc):
        with pytest.raises(HTTPException) as err:
            await ms.create_medical_item(
                InventoryItemCreate(name="Gauze 4x4", category_id=GEAR_CAT),
                db=AsyncMock(),
                current_user=_user(),
            )
        assert err.value.status_code == 404

    async def test_create_without_a_category_is_refused(self, svc):
        """An uncategorized item has no domain, so it cannot be created here."""
        with pytest.raises(HTTPException) as err:
            await ms.create_medical_item(
                InventoryItemCreate(name="Gauze 4x4"),
                db=AsyncMock(),
                current_user=_user(),
            )
        assert err.value.status_code == 404

    async def test_update_of_a_gear_item_is_not_found(self, svc):
        with pytest.raises(HTTPException) as err:
            await ms.update_medical_item(
                GEAR_ITEM,
                InventoryItemUpdate(name="Renamed"),
                db=AsyncMock(),
                current_user=_user(),
            )
        assert err.value.status_code == 404

    async def test_update_cannot_move_an_item_to_a_gear_category(self, svc):
        """Moving one item out is the same escape hatch as reclassifying."""
        with pytest.raises(HTTPException) as err:
            await ms.update_medical_item(
                MEDICAL_ITEM,
                InventoryItemUpdate(category_id=GEAR_CAT),
                db=AsyncMock(),
                current_user=_user(),
            )
        assert err.value.status_code == 404

    async def test_get_of_a_gear_item_is_not_found(self, svc):
        with pytest.raises(HTTPException) as err:
            await ms.get_medical_item(GEAR_ITEM, db=AsyncMock(), current_user=_user())
        assert err.value.status_code == 404


class TestLotDomainPinning:
    async def test_lots_of_a_gear_item_are_not_listed(self, svc):
        with pytest.raises(HTTPException) as err:
            await ms.list_medical_item_lots(
                GEAR_ITEM, db=AsyncMock(), current_user=_user()
            )
        assert err.value.status_code == 404

    async def test_a_delivery_is_checked_in_full_before_anything_is_written(self, svc):
        """One gear line rejects the whole shipment.

        A partially-received delivery is worse than a rejected one: the
        officer cannot tell which lines landed without recounting.
        """
        svc.add_lots_bulk = AsyncMock(return_value=[])

        with pytest.raises(HTTPException) as err:
            await ms.receive_medical_delivery(
                InventoryLotBulkCreate(
                    entries=[
                        {"inventory_item_id": MEDICAL_ITEM, "quantity": 5},
                        {"inventory_item_id": GEAR_ITEM, "quantity": 5},
                    ]
                ),
                db=AsyncMock(),
                current_user=_user(),
            )

        assert err.value.status_code == 404
        svc.add_lots_bulk.assert_not_awaited()

    async def test_an_all_medical_delivery_is_written(self, svc):
        svc.add_lots_bulk = AsyncMock(return_value=[])

        await ms.receive_medical_delivery(
            InventoryLotBulkCreate(
                entries=[{"inventory_item_id": MEDICAL_ITEM, "quantity": 5}]
            ),
            db=AsyncMock(),
            current_user=_user(),
        )

        svc.add_lots_bulk.assert_awaited_once()

    async def test_expiring_lots_are_scoped_to_the_domain(self, svc):
        svc.get_expiring_lots = AsyncMock(return_value=[])

        await ms.list_expiring_medical_lots(
            days_ahead=30, db=AsyncMock(), current_user=_user()
        )

        assert (
            svc.get_expiring_lots.await_args.kwargs["item_types"] == MEDICAL_ITEM_TYPES
        )

    async def test_a_gear_lot_cannot_be_deleted(self, svc):
        svc.lot_in_domain = AsyncMock(return_value=False)
        svc.delete_lot = AsyncMock(return_value=True)

        with pytest.raises(HTTPException) as err:
            await ms.delete_medical_lot("lot-9", db=AsyncMock(), current_user=_user())

        assert err.value.status_code == 404
        svc.delete_lot.assert_not_awaited()

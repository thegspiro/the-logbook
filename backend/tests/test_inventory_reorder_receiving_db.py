"""Reorder receiving against a real database.

`receive_reorder` records a lot and a receipt for stock coming in, but until
this test existed nothing asserted that the item's own on-hand count actually
moved. It didn't: the function created the `InventoryLot` and incremented the
reorder's `quantity_received`, then stopped -- `InventoryItem.quantity`, the
column `issue_from_pool` and the distribution/equipment-request fulfillment
paths all gate on, was never touched. Received stock existed in the lot table
and nowhere an item could actually be issued from.
"""

import uuid
from decimal import Decimal

import pytest

from app.models.inventory import (
    InventoryItem,
    ReorderRequest,
    ReorderStatus,
    TrackingType,
)
from app.models.user import Organization, User
from app.services.inventory_service import InventoryService

pytestmark = pytest.mark.integration


async def _make_org(db, name="Receiving FD"):
    org = Organization(name=name, slug=f"receiving-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _make_user(db, org):
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"tester-{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:8]}@example.test",
        first_name="Pat",
        last_name="Quinn",
        password_hash="x",
    )
    db.add(user)
    await db.flush()
    return user


async def _make_pool_item(db, org, name="Structural Gloves", quantity=5):
    item = InventoryItem(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=name,
        tracking_type=TrackingType.POOL,
        quantity=quantity,
    )
    db.add(item)
    await db.flush()
    return item


async def _make_reorder(db, org, item, quantity_requested=10, **kwargs):
    reorder = ReorderRequest(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        item_id=item.id,
        item_name=item.name,
        quantity_requested=quantity_requested,
        quantity_received=kwargs.pop("quantity_received", 0),
        version=kwargs.pop("version", 1),
        status=kwargs.pop("status", ReorderStatus.ORDERED),
        **kwargs,
    )
    db.add(reorder)
    await db.flush()
    return reorder


class TestReceiveReorderCreditsStock:
    async def test_receiving_stock_increases_the_item_on_hand_quantity(
        self, db_session
    ):
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        item = await _make_pool_item(db_session, org, quantity=5)
        reorder = await _make_reorder(db_session, org, item, quantity_requested=10)
        service = InventoryService(db_session)

        result, error = await service.receive_reorder(
            reorder.id,
            org.id,
            {
                "quantity": 4,
                "expected_version": 1,
                "idempotency_key": "receipt-1",
                "lot_number": None,
                "storage_location": "Shelf A",
                "unit_cost": Decimal("9.99"),
                "expiration_date": None,
                "confirm_over_receipt": False,
            },
            user.id,
        )

        assert error is None
        assert result.quantity_received == 4
        assert result.status == ReorderStatus.PARTIALLY_RECEIVED

        await db_session.refresh(item)
        assert item.quantity == 9, (
            "received stock must be credited to InventoryItem.quantity -- "
            "that is the column pool issuance actually checks"
        )

    async def test_a_second_full_receipt_makes_the_item_fully_available(
        self, db_session
    ):
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        item = await _make_pool_item(db_session, org, quantity=0)
        reorder = await _make_reorder(
            db_session,
            org,
            item,
            quantity_requested=6,
            quantity_received=4,
            version=2,
            status=ReorderStatus.PARTIALLY_RECEIVED,
        )
        service = InventoryService(db_session)

        result, error = await service.receive_reorder(
            reorder.id,
            org.id,
            {
                "quantity": 2,
                "expected_version": 2,
                "idempotency_key": "receipt-2",
                "lot_number": None,
                "storage_location": "Shelf A",
                "unit_cost": Decimal("9.99"),
                "expiration_date": None,
                "confirm_over_receipt": False,
            },
            user.id,
        )

        assert error is None
        assert result.status == ReorderStatus.RECEIVED

        await db_session.refresh(item)
        assert item.quantity == 2

"""Reorder receiving against a real database.

`receive_reorder` records a lot and a receipt for stock coming in, and this
file exists because nothing once asserted that the stock was actually
issuable afterwards: the function created the `InventoryLot`, incremented the
reorder's `quantity_received`, and stopped. Received stock existed in the lot
table and nowhere an item could be issued from.

That was first fixed by also crediting `InventoryItem.quantity`, which traded
the bug for a worse one. The two are independently-consumed ledgers -- pool
issuance decremented only `quantity`, the equipment-check swap decrements only
`lot.quantity` -- so one delivery could be dispensed twice, and the drift was
permanent because nothing ever debited `quantity` when its lot was consumed.

Lots are now authoritative for an item that has any, so these tests assert the
original intent (received stock is issuable) rather than the mechanism that
briefly delivered it (a second counter going up).
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
    async def test_received_stock_is_issuable_without_double_counting(self, db_session):
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
        # The receipt is recorded once, as a lot — crediting item.quantity too
        # would make the same four pairs of gloves dispensable twice. And the
        # column is emptied rather than left standing, because creating that
        # first lot is what flips the item to the lot ledger: from then on
        # every reader stops consulting item.quantity, so five left sitting
        # there would be five pairs nobody could issue. They move into an
        # opening-balance lot instead.
        assert item.quantity == 0, (
            "the shelf count belongs in a lot once the item is lot-stocked -- "
            "left in the column it is invisible to every stock reader"
        )

        # Nine, not four and not thirteen: the five that were on the shelf
        # plus the four just received, each issuable exactly once.
        issuance, err = await service.issue_from_pool(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(user.id),
            organization_id=uuid.UUID(org.id),
            issued_by=uuid.UUID(user.id),
            quantity=9,
        )
        assert err is None
        assert issuance is not None

        over, err = await service.issue_from_pool(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(user.id),
            organization_id=uuid.UUID(org.id),
            issued_by=uuid.UUID(user.id),
            quantity=1,
        )
        assert over is None
        assert "Insufficient stock" in err

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
        # Untouched: the two received units live in the lot created above.
        assert item.quantity == 0

        issuance, err = await service.issue_from_pool(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(user.id),
            organization_id=uuid.UUID(org.id),
            issued_by=uuid.UUID(user.id),
            quantity=2,
        )
        assert err is None
        assert issuance is not None

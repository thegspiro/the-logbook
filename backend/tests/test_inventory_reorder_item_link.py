"""
W41-5: a reorder request made in the app can be linked to its inventory item,
at create, by edit, or at receipt — which receiving it requires.

``POST /reorder-requests/{id}/receipts`` refuses an unlinked request, and
nothing on the reorder page set ``item_id``. The owner chose "both": an item
picker at create (with the low-stock data carrying item ids for the quick
fill) and linking at receipt. The receipt dialog links through the plain
PATCH, which therefore accepts ``item_id`` — refused only once stock has been
received against the current link.
"""

import uuid
from decimal import Decimal

import pytest

from app.models.inventory import (
    InventoryCategory,
    InventoryItem,
    ReorderRequest,
    ReorderStatus,
    TrackingType,
)
from app.models.user import Organization, User
from app.schemas.inventory import ReorderRequestUpdate
from app.services.inventory_service import InventoryService

pytestmark = pytest.mark.integration


async def _org(db):
    org = Organization(name="Link FD", slug=f"link-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _user(db, org):
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"qm-{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:8]}@example.test",
        first_name="Pat",
        last_name="Quinn",
        password_hash="x",
    )
    db.add(user)
    await db.flush()
    return user


async def _item(db, org, name="Structural Gloves", category=None):
    item = InventoryItem(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=name,
        tracking_type=TrackingType.POOL,
        quantity=0,
        active=True,
        category_id=category.id if category else None,
    )
    db.add(item)
    await db.flush()
    return item


async def _reorder(db, org, item=None, **kwargs):
    reorder = ReorderRequest(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        item_id=item.id if item else None,
        item_name=item.name if item else "Gloves",
        quantity_requested=kwargs.pop("quantity_requested", 10),
        quantity_received=kwargs.pop("quantity_received", 0),
        version=1,
        status=kwargs.pop("status", ReorderStatus.ORDERED),
    )
    db.add(reorder)
    await db.flush()
    return reorder


def _patch(item_id):
    # What the endpoint hands the service: model_dump(exclude_unset=True).
    return ReorderRequestUpdate(item_id=item_id).model_dump(exclude_unset=True)


def _receipt(key="receipt-1", quantity=4):
    return {
        "quantity": quantity,
        "expected_version": 1,
        "idempotency_key": key,
        "lot_number": None,
        "storage_location": "Shelf A",
        "unit_cost": Decimal("9.99"),
        "expiration_date": None,
        "confirm_over_receipt": False,
    }


class TestLinkingThenReceiving:
    async def test_an_unlinked_order_linked_at_receipt_can_be_received(
        self, db_session
    ):
        org = await _org(db_session)
        qm = await _user(db_session, org)
        item = await _item(db_session, org)
        reorder = await _reorder(db_session, org)
        service = InventoryService(db_session)

        refused, error = await service.receive_reorder(
            reorder.id, org.id, _receipt(), qm.id
        )
        assert refused is None
        assert "Link an inventory item" in error

        linked, error = await service.update_reorder_request(
            reorder.id, org.id, _patch(uuid.UUID(item.id)), qm.id
        )
        assert error is None
        assert linked.item_id == item.id
        assert linked.version == 1  # the link does not invalidate the dialog

        received, error = await service.receive_reorder(
            reorder.id, org.id, _receipt(), qm.id
        )
        assert error is None
        assert received.quantity_received == 4

    async def test_an_item_from_another_department_is_refused(self, db_session):
        org = await _org(db_session)
        other = await _org(db_session)
        qm = await _user(db_session, org)
        theirs = await _item(db_session, other)
        reorder = await _reorder(db_session, org)

        updated, error = await InventoryService(db_session).update_reorder_request(
            reorder.id, org.id, _patch(uuid.UUID(theirs.id)), qm.id
        )

        assert updated is None
        assert error is not None
        await db_session.refresh(reorder)
        assert reorder.item_id is None

    async def test_the_link_is_frozen_once_stock_has_arrived(self, db_session):
        org = await _org(db_session)
        qm = await _user(db_session, org)
        first = await _item(db_session, org, "Gloves M")
        second = await _item(db_session, org, "Gloves L")
        reorder = await _reorder(
            db_session,
            org,
            first,
            quantity_received=4,
            status=ReorderStatus.PARTIALLY_RECEIVED,
        )
        service = InventoryService(db_session)

        moved, error = await service.update_reorder_request(
            reorder.id, org.id, _patch(uuid.UUID(second.id)), qm.id
        )
        cleared, cleared_error = await service.update_reorder_request(
            reorder.id, org.id, _patch(None), qm.id
        )

        assert moved is None
        assert "cannot change once stock has been received" in error
        assert cleared is None
        assert "cannot change once stock has been received" in cleared_error
        await db_session.refresh(reorder)
        assert reorder.item_id == first.id

    async def test_resending_the_same_link_after_a_receipt_is_fine(self, db_session):
        """The edit form sends every field it owns; an unchanged link must not
        make a partially received order uneditable."""
        org = await _org(db_session)
        qm = await _user(db_session, org)
        item = await _item(db_session, org)
        reorder = await _reorder(db_session, org, item, quantity_received=4)

        updated, error = await InventoryService(db_session).update_reorder_request(
            reorder.id,
            org.id,
            {**_patch(uuid.UUID(item.id)), "notes": "Rest due Friday"},
            qm.id,
        )

        assert error is None
        assert updated.notes == "Rest due Friday"


class TestLowStockCarriesIds:
    async def test_each_listed_item_names_its_id(self, db_session):
        org = await _org(db_session)
        category = InventoryCategory(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            name="Gloves",
            item_type="ppe",
            low_stock_threshold=10,
            active=True,
        )
        db_session.add(category)
        await db_session.flush()
        item = await _item(db_session, org, "Nitrile M", category)

        rows = await InventoryService(db_session).get_low_stock_items(org.id)

        assert rows[0]["items"][0]["id"] == item.id

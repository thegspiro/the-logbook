"""Lots are the authoritative on-hand ledger for a lot-stocked item.

`receive_reorder` records incoming stock as an `InventoryLot`, and the
equipment-check swap consumes from lots. When receiving *also* credited
`InventoryItem.quantity`, the same physical units sat in two
independently-consumed ledgers: pool issuance decremented only `quantity`,
the swap decremented only `lot.quantity`, and neither reduced the other's
tally. Forty received boxes could be dispensed as eighty, permanently — no
path ever debited `quantity` when its lot was consumed or expired.

Issuance now draws from lots for any item that has them, first-expired-first-
out, and falls back to `quantity` only for items with no lots at all.
"""

import uuid
from datetime import date, timedelta

import pytest

from app.models.inventory import (
    InventoryItem,
    InventoryLot,
    ItemCondition,
    ItemStatus,
    TrackingType,
)
from app.models.user import Organization, User
from app.services.inventory_service import InventoryService

pytestmark = pytest.mark.integration


async def _org(db):
    org = Organization(name="Ledger FD", slug=f"ledger-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _user(db, org):
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"qm-{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:8]}@example.test",
        first_name="Sam",
        last_name="Reed",
        password_hash="x",
    )
    db.add(user)
    await db.flush()
    return user


async def _item(db, org, quantity=0):
    item = InventoryItem(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="4x4 Gauze",
        tracking_type=TrackingType.POOL,
        quantity=quantity,
    )
    db.add(item)
    await db.flush()
    return item


async def _lot(db, org, item, quantity, expires_in_days=None):
    lot = InventoryLot(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        inventory_item_id=item.id,
        quantity=quantity,
        received_date=date.today(),
        expiration_date=(
            None
            if expires_in_days is None
            else date.today() + timedelta(days=expires_in_days)
        ),
    )
    db.add(lot)
    await db.flush()
    return lot


async def _issue(db, org, user, item, quantity):
    return await InventoryService(db).issue_from_pool(
        item_id=uuid.UUID(item.id),
        user_id=uuid.UUID(user.id),
        organization_id=uuid.UUID(org.id),
        issued_by=uuid.UUID(user.id),
        quantity=quantity,
    )


class TestPoolIssuanceUsesTheLotLedger:
    async def test_issuing_consumes_the_lot_not_a_second_counter(self, db_session):
        """The double-count itself: forty received units must be dispensable
        once in total, whichever consumer takes them."""
        org = await _org(db_session)
        user = await _user(db_session, org)
        item = await _item(db_session, org, quantity=0)
        lot = await _lot(db_session, org, item, quantity=40)

        issuance, err = await _issue(db_session, org, user, item, 40)

        assert err is None
        assert issuance is not None
        await db_session.refresh(lot)
        # Nothing left for the equipment-check swap to deploy.
        assert lot.quantity == 0

    async def test_issuing_more_than_the_lots_hold_is_refused(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        # A stale quantity column must not authorize an issue the lots cannot
        # cover — that column is maintained by nothing once lots exist.
        item = await _item(db_session, org, quantity=999)
        await _lot(db_session, org, item, quantity=3)

        issuance, err = await _issue(db_session, org, user, item, 5)

        assert issuance is None
        assert "Insufficient stock: 3 available" in err

    async def test_soonest_expiring_lot_is_consumed_first(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        item = await _item(db_session, org)
        later = await _lot(db_session, org, item, quantity=10, expires_in_days=365)
        sooner = await _lot(db_session, org, item, quantity=10, expires_in_days=30)

        _, err = await _issue(db_session, org, user, item, 10)

        assert err is None
        await db_session.refresh(sooner)
        await db_session.refresh(later)
        assert sooner.quantity == 0
        assert later.quantity == 10

    async def test_expired_stock_is_not_issuable(self, db_session):
        """The swap refuses expired lots, so they are not stock anyone can
        use; counting them here would paper over the shortage."""
        org = await _org(db_session)
        user = await _user(db_session, org)
        item = await _item(db_session, org, quantity=0)
        expired = await _lot(db_session, org, item, quantity=20, expires_in_days=-1)

        issuance, err = await _issue(db_session, org, user, item, 1)

        assert issuance is None
        assert "Insufficient stock: 0 available" in err
        await db_session.refresh(expired)
        assert expired.quantity == 20

    async def test_an_item_with_no_lots_still_uses_its_own_quantity(self, db_session):
        """Individually-counted pool stock never had lots and must keep
        working exactly as before."""
        org = await _org(db_session)
        user = await _user(db_session, org)
        item = await _item(db_session, org, quantity=6)

        issuance, err = await _issue(db_session, org, user, item, 2)

        assert err is None
        assert issuance is not None
        await db_session.refresh(item)
        assert item.quantity == 4


class TestFirstLotDoesNotStrandColumnStock:
    """Crossing from the column ledger to the lot ledger.

    The moment an item has any lot, every reader stops consulting
    ``InventoryItem.quantity``. So recording the first delivery against an
    item that was being counted in the column made whatever was on the shelf
    invisible: the item read as zero ready units, low-stock alerts fired
    against a full cupboard, and issuing refused stock that was there.
    """

    async def test_adding_a_first_lot_carries_the_shelf_count_forward(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        item = await _item(db_session, org, quantity=12)

        await InventoryService(db_session).add_lot(
            item.id, org.id, {"quantity": 5, "lot_number": "L-1"}
        )

        # 12 on the shelf plus the 5 just received, all issuable.
        issuance, err = await _issue(db_session, org, user, item, 17)
        assert err is None, err
        assert issuance is not None
        await db_session.refresh(item)
        # Counted once, in the lot ledger only.
        assert item.quantity == 0

    async def test_a_bulk_delivery_carries_it_forward_too(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        item = await _item(db_session, org, quantity=4)

        await InventoryService(db_session).add_lots_bulk(
            org.id, [{"inventory_item_id": item.id, "quantity": 1}]
        )

        issuance, err = await _issue(db_session, org, user, item, 5)
        assert err is None, err
        assert issuance is not None

    async def test_a_second_lot_does_not_carry_anything_again(self, db_session):
        """Once per item. A stale non-zero column on an already-lotted item is
        not stock — it is the residue the lot ledger replaced."""
        org = await _org(db_session)
        item = await _item(db_session, org, quantity=999)
        await _lot(db_session, org, item, quantity=3)

        await InventoryService(db_session).add_lot(item.id, org.id, {"quantity": 2})

        totals = await InventoryService(db_session)._in_date_lot_totals(
            org.id, [item.id]
        )
        assert totals[item.id] == 5


async def _return(db, org, user, issuance, quantity=None, condition=None):
    return await InventoryService(db).return_to_pool(
        issuance_id=uuid.UUID(issuance.id),
        organization_id=uuid.UUID(org.id),
        returned_by=uuid.UUID(user.id),
        quantity_returned=quantity,
        return_condition=condition,
    )


class TestReturnsGoBackToTheLedgerTheyCameFrom:
    """`item.quantity` is read by nothing once an item has lots.

    Crediting a return there therefore did not restore the units — issuance,
    low-stock and the checklist swap all consult the lots — so returned gear
    disappeared from available stock permanently.
    """

    async def test_a_return_credits_the_lot_it_was_issued_from(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        item = await _item(db_session, org, quantity=0)
        lot = await _lot(db_session, org, item, quantity=10)

        issuance, err = await _issue(db_session, org, user, item, 4)
        assert err is None
        await db_session.refresh(lot)
        assert lot.quantity == 6

        ok, err = await _return(db_session, org, user, issuance)
        assert ok, err
        await db_session.refresh(lot)
        assert lot.quantity == 10
        await db_session.refresh(item)
        # Not parked in a column nobody reads.
        assert item.quantity == 0

    async def test_a_return_spanning_two_lots_repays_both(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        item = await _item(db_session, org, quantity=0)
        sooner = await _lot(db_session, org, item, quantity=3, expires_in_days=30)
        later = await _lot(db_session, org, item, quantity=5, expires_in_days=365)

        issuance, err = await _issue(db_session, org, user, item, 5)
        assert err is None
        await db_session.refresh(sooner)
        await db_session.refresh(later)
        assert (sooner.quantity, later.quantity) == (0, 3)

        ok, err = await _return(db_session, org, user, issuance)
        assert ok, err
        await db_session.refresh(sooner)
        await db_session.refresh(later)
        assert (sooner.quantity, later.quantity) == (3, 5)

    async def test_partial_returns_never_repay_the_same_units_twice(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        item = await _item(db_session, org, quantity=0)
        lot = await _lot(db_session, org, item, quantity=10)

        issuance, _ = await _issue(db_session, org, user, item, 6)
        await _return(db_session, org, user, issuance, quantity=2)
        await _return(db_session, org, user, issuance, quantity=4)

        await db_session.refresh(lot)
        assert lot.quantity == 10

    async def test_an_unserviceable_return_does_not_rejoin_ready_stock(
        self, db_session
    ):
        """A lot carries no condition of its own.

        Crediting a damaged return back to the lot it came from puts it at the
        front of the FEFO queue with a lot number and an expiry — issuable
        again, and swappable onto an apparatus during a check. The issuance
        row keeps the return and its condition; the units come off the
        issuable balance.
        """
        org = await _org(db_session)
        user = await _user(db_session, org)
        item = await _item(db_session, org, quantity=0)
        lot = await _lot(db_session, org, item, quantity=10)

        issuance, _ = await _issue(db_session, org, user, item, 4)
        await db_session.refresh(lot)
        assert lot.quantity == 6

        ok, err = await _return(
            db_session, org, user, issuance, condition=ItemCondition.DAMAGED
        )
        assert ok, err
        await db_session.refresh(lot)
        assert lot.quantity == 6
        await db_session.refresh(item)
        # Not parked in the column either — it is not stock any more.
        assert item.quantity == 0
        assert item.quantity_issued == 0

    async def test_an_unserviceable_column_return_is_written_off_too(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        item = await _item(db_session, org, quantity=6)

        issuance, _ = await _issue(db_session, org, user, item, 2)
        await db_session.refresh(item)
        assert item.quantity == 4

        ok, err = await _return(
            db_session, org, user, issuance, condition=ItemCondition.OUT_OF_SERVICE
        )
        assert ok, err
        await db_session.refresh(item)
        assert item.quantity == 4

    async def test_a_legacy_issuance_returns_into_the_lot_ledger(self, db_session):
        """No allocation record, but the item is lot-stocked anyway.

        Every issuance that went out before `lot_allocations` existed has it
        NULL, and the migration deliberately leaves those rows alone — it
        cannot know which lots they drew from. Sending their returns back to
        `quantity` puts the units in a column no reader consults for a
        lot-stocked item, which is the same disappearance in a different
        place. The lot is unrecoverable, so they land undated.
        """
        org = await _org(db_session)
        user = await _user(db_session, org)
        item = await _item(db_session, org, quantity=0)
        lot = await _lot(db_session, org, item, quantity=10)

        issuance, _ = await _issue(db_session, org, user, item, 3)
        # Exactly the shape of a row written before the column existed.
        issuance.lot_allocations = None
        await db_session.flush()

        ok, err = await _return(db_session, org, user, issuance)
        assert ok, err

        await db_session.refresh(item)
        assert item.quantity == 0
        await db_session.refresh(lot)
        # The original lot is not credited — which one it was is unknown — so
        # the units arrive as a lot of their own and the total is whole again.
        assert lot.quantity == 7
        totals = await InventoryService(db_session)._in_date_lot_totals(
            org.id, [item.id]
        )
        assert totals[item.id] == 10

    async def test_a_column_ledger_issue_still_returns_to_the_column(self, db_session):
        """Items that never had lots — and every issuance written before the
        allocation record existed — must keep working exactly as before."""
        org = await _org(db_session)
        user = await _user(db_session, org)
        item = await _item(db_session, org, quantity=6)

        issuance, err = await _issue(db_session, org, user, item, 2)
        assert err is None
        assert issuance.lot_allocations is None

        ok, err = await _return(db_session, org, user, issuance)
        assert ok, err
        await db_session.refresh(item)
        assert item.quantity == 6


class TestQuarantinedPoolStockIsNotIssued:
    """`active` stays true on a newly quarantined item, and issuance checked
    only that — so the item edit form could record gear as damaged or retired
    and the scan/distribution paths would still hand it out."""

    @pytest.mark.parametrize(
        "status", [ItemStatus.IN_MAINTENANCE, ItemStatus.RETIRED, ItemStatus.LOST]
    )
    async def test_a_quarantined_status_refuses_issuance(self, db_session, status):
        org = await _org(db_session)
        user = await _user(db_session, org)
        item = await _item(db_session, org, quantity=10)
        item.status = status
        await db_session.flush()

        issuance, err = await _issue(db_session, org, user, item, 1)

        assert issuance is None
        assert "cannot be issued" in err

    @pytest.mark.parametrize(
        "condition",
        [ItemCondition.DAMAGED, ItemCondition.OUT_OF_SERVICE, ItemCondition.POOR],
    )
    async def test_an_unsafe_condition_refuses_issuance(self, db_session, condition):
        org = await _org(db_session)
        user = await _user(db_session, org)
        item = await _item(db_session, org, quantity=10)
        item.condition = condition
        await db_session.flush()

        issuance, err = await _issue(db_session, org, user, item, 1)

        assert issuance is None
        assert "cannot be issued" in err

    async def test_serviceable_stock_is_unaffected(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        item = await _item(db_session, org, quantity=10)

        issuance, err = await _issue(db_session, org, user, item, 1)

        assert err is None
        assert issuance is not None

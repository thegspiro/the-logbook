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

from app.models.inventory import InventoryItem, InventoryLot, TrackingType
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

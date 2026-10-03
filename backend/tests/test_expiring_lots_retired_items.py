"""A retired item's lots are not expiring stock (workflow review W47-4).

Retiring a medical supply took it off the supply list, but its lots stayed on
the Expiring stock tab and in the summary's expiring and expired counts, with
no row left to act on them from. The same query feeds the scheduled expiry
alert. The dashboard's own expiring-lot count already left retired items out.
"""

import uuid
from datetime import timedelta

import pytest

from app.models.inventory import InventoryItem, InventoryLot, TrackingType
from app.models.user import Organization
from app.services.inventory_service import InventoryService
from app.utils.org_timezone import org_today

pytestmark = pytest.mark.integration


async def _org(db):
    org = Organization(name="Expiry FD", slug=f"expiry-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _item_with_lot(db, org, name, *, active, expires_in_days):
    item = InventoryItem(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=name,
        tracking_type=TrackingType.POOL,
        quantity=0,
        active=active,
    )
    db.add(item)
    await db.flush()
    db.add(
        InventoryLot(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            inventory_item_id=item.id,
            quantity=3,
            expiration_date=org_today(org) + timedelta(days=expires_in_days),
        )
    )
    await db.flush()
    return item


async def test_a_retired_items_lots_are_left_out(db_session):
    org = await _org(db_session)
    await _item_with_lot(
        db_session, org, "Tourniquet (retired)", active=False, expires_in_days=5
    )
    await _item_with_lot(
        db_session,
        org,
        "Tourniquet (expired, retired)",
        active=False,
        expires_in_days=-5,
    )
    await _item_with_lot(db_session, org, "Tourniquet", active=True, expires_in_days=5)

    rows = await InventoryService(db_session).get_expiring_lots(
        org.id, 30, today=org_today(org)
    )

    assert [name for _lot, name in rows] == ["Tourniquet"]

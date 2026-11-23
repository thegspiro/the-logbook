"""Items that need inspecting and have never had one (workflow review W42-6).

`get_maintenance_due` lists items by `next_inspection_due`, which only a
completed inspection sets, so an item whose category requires maintenance had
no date and never reached the Maintenance page. `get_never_inspected` lists
those on their own; the owner chose that over counting them as due.
"""

import uuid
from datetime import date, timedelta

import pytest

from app.models.inventory import (
    InventoryCategory,
    InventoryItem,
    ItemType,
    TrackingType,
)
from app.models.user import Organization
from app.services.inventory_service import InventoryService

pytestmark = pytest.mark.integration


async def _org(db, name="Never Inspected FD"):
    org = Organization(name=name, slug=f"neverinsp-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _category(db, org, *, requires_maintenance: bool) -> InventoryCategory:
    category = InventoryCategory(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=f"cat-{uuid.uuid4().hex[:6]}",
        item_type=ItemType.PPE,
        requires_maintenance=requires_maintenance,
    )
    db.add(category)
    await db.flush()
    return category


async def _item(
    db,
    org,
    name,
    category=None,
    *,
    interval=None,
    last_inspection=None,
    next_due=None,
    active=True,
):
    item = InventoryItem(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        category_id=category.id if category else None,
        name=name,
        tracking_type=TrackingType.INDIVIDUAL,
        quantity=1,
        active=active,
        inspection_interval_days=interval,
        last_inspection_date=last_inspection,
        next_inspection_due=next_due,
    )
    db.add(item)
    await db.flush()
    return item


async def _names(db, org) -> list[str]:
    items = await InventoryService(db).get_never_inspected(org.id)
    return [item.name for item in items]


async def test_lists_items_that_need_an_inspection_and_have_none(db_session):
    org = await _org(db_session)
    turnout = await _category(db_session, org, requires_maintenance=True)
    plain = await _category(db_session, org, requires_maintenance=False)

    await _item(db_session, org, "Coat (category requires it)", turnout)
    await _item(db_session, org, "Radio (own interval)", plain, interval=365)
    await _item(db_session, org, "Uncategorized meter (own interval)", interval=90)

    assert await _names(db_session, org) == [
        "Coat (category requires it)",
        "Radio (own interval)",
        "Uncategorized meter (own interval)",
    ]


async def test_leaves_out_items_that_need_no_inspection_or_already_have_a_date(
    db_session,
):
    org = await _org(db_session)
    turnout = await _category(db_session, org, requires_maintenance=True)
    plain = await _category(db_session, org, requires_maintenance=False)

    # Nothing asks for an inspection.
    await _item(db_session, org, "Gloves", plain)
    await _item(db_session, org, "Zero interval", plain, interval=0)
    # Already inspected, or given a due date by hand -- the due list owns these.
    await _item(
        db_session,
        org,
        "Inspected coat",
        turnout,
        last_inspection=date.today() - timedelta(days=10),
        next_due=date.today() + timedelta(days=355),
    )
    await _item(
        db_session,
        org,
        "Hand-dated coat",
        turnout,
        next_due=date.today() + timedelta(days=30),
    )
    # Retired.
    await _item(db_session, org, "Inactive coat", turnout, active=False)

    assert await _names(db_session, org) == []


async def test_lists_only_the_callers_organization(db_session):
    org = await _org(db_session)
    other = await _org(db_session, name="Other FD")
    await _item(db_session, org, "Ours", interval=365)
    await _item(db_session, other, "Theirs", interval=365)

    assert await _names(db_session, org) == ["Ours"]


async def test_respects_the_limit(db_session):
    org = await _org(db_session)
    for n in range(3):
        await _item(db_session, org, f"Meter {n}", interval=30)

    items = await InventoryService(db_session).get_never_inspected(org.id, limit=2)

    assert [item.name for item in items] == ["Meter 0", "Meter 1"]

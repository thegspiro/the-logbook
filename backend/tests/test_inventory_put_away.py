"""Put-away: filing scanned items under a storage area.

Asserts against MySQL what a shelf scan may and may not change: items take the
shelf and the room it is in, an item a member holds or whose record says it is
gone is left alone with a reason, and nothing outside the caller's
organization is touched — neither the area nor the items.
"""

import uuid

import pytest
from sqlalchemy import text

from app.models.inventory import (
    InventoryItem,
    ItemStatus,
    StorageArea,
    StorageLocationType,
)
from app.models.location import Location
from app.services.inventory_service import InventoryService

pytestmark = pytest.mark.integration


async def _make_org(db, name: str) -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": name, "slug": f"{name}-{org_id[:8]}"},
    )
    await db.flush()
    return org_id


async def _area(db, org_id, name, *, parent=None, location=None):
    area = StorageArea(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name=name,
        storage_type=list(StorageLocationType)[0],
        parent_id=parent.id if parent else None,
        location_id=location.id if location else None,
        barcode=f"SA-{uuid.uuid4().hex[:6]}",
    )
    db.add(area)
    await db.flush()
    return area


async def _item(
    db, org_id, name, *, status=ItemStatus.AVAILABLE, active=True, area=None
):
    item = InventoryItem(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name=name,
        quantity=1,
        status=status,
        active=active,
        storage_area_id=area.id if area else None,
    )
    db.add(item)
    await db.flush()
    return item


async def _stored(db, item_id):
    row = await db.execute(
        text("SELECT storage_area_id, location_id FROM inventory_items WHERE id = :id"),
        {"id": item_id},
    )
    return tuple(row.one())


async def test_items_take_the_shelf_and_the_room_it_inherits(db_session):
    org = await _make_org(db_session, "putaway")
    room = Location(id=str(uuid.uuid4()), organization_id=org, name="Supply room")
    db_session.add(room)
    await db_session.flush()
    rack = await _area(db_session, org, "Rack A", location=room)
    shelf = await _area(db_session, org, "Shelf 2", parent=rack)
    item = await _item(db_session, org, "Gloves")

    result = await InventoryService(db_session).put_away_items(
        uuid.UUID(shelf.id), [uuid.UUID(item.id)], uuid.UUID(org)
    )

    assert result["moved"] == [item.id]
    assert await _stored(db_session, item.id) == (shelf.id, room.id)


async def test_held_or_gone_items_are_skipped_with_a_reason(db_session):
    org = await _make_org(db_session, "putaway-skip")
    shelf = await _area(db_session, org, "Shelf 1")
    held = await _item(db_session, org, "Radio", status=ItemStatus.ASSIGNED)
    out = await _item(db_session, org, "Drill", status=ItemStatus.CHECKED_OUT)
    lost = await _item(db_session, org, "Axe", status=ItemStatus.LOST)
    retired = await _item(db_session, org, "Old hose", active=False)
    fine = await _item(db_session, org, "Saw", status=ItemStatus.IN_MAINTENANCE)

    result = await InventoryService(db_session).put_away_items(
        uuid.UUID(shelf.id),
        [uuid.UUID(i.id) for i in (held, out, lost, retired, fine)],
        uuid.UUID(org),
    )

    reasons = {s["name"]: s["reason"] for s in result["skipped"]}
    assert reasons == {
        "Radio": "assigned to a member — return it first",
        "Drill": "checked out — check it in first",
        "Axe": "marked lost — update its status first",
        "Old hose": "retired",
    }
    assert result["moved"] == [fine.id]
    for skipped in (held, out, lost, retired):
        assert (await _stored(db_session, skipped.id))[0] is None


async def test_nothing_outside_the_organization_is_touched(db_session):
    org = await _make_org(db_session, "putaway-mine")
    other = await _make_org(db_session, "putaway-theirs")
    shelf = await _area(db_session, org, "Shelf 1")
    their_shelf = await _area(db_session, other, "Their shelf")
    theirs = await _item(db_session, other, "Their radio")
    service = InventoryService(db_session)

    result = await service.put_away_items(
        uuid.UUID(shelf.id), [uuid.UUID(theirs.id)], uuid.UUID(org)
    )
    assert result["moved"] == []
    assert result["not_found"] == 1
    assert (await _stored(db_session, theirs.id))[0] is None

    # Another organization's shelf is not found at all.
    mine = await _item(db_session, org, "My radio")
    assert (
        await service.put_away_items(
            uuid.UUID(their_shelf.id), [uuid.UUID(mine.id)], uuid.UUID(org)
        )
        is None
    )
    assert (await _stored(db_session, mine.id))[0] is None


async def test_an_item_already_on_the_shelf_is_reported_not_rewritten(db_session):
    org = await _make_org(db_session, "putaway-here")
    shelf = await _area(db_session, org, "Shelf 1")
    item = await _item(db_session, org, "Gloves", area=shelf)

    result = await InventoryService(db_session).put_away_items(
        uuid.UUID(shelf.id), [uuid.UUID(item.id), uuid.UUID(item.id)], uuid.UUID(org)
    )

    assert result["already_here"] == [item.id]
    assert result["moved"] == []

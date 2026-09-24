"""Storage-area barcode labels, through the shared label module registry.

Asserts against MySQL what the builder reads and writes: the labels name the
area and its parents, only the caller's organization is labelled, and an area
made before barcodes were mandatory is given one from the same ``SA-`` series
rather than printed with a code nothing can look up.
"""

import uuid

import pytest
from sqlalchemy import text

from app.models.inventory import StorageArea, StorageLocationType
from app.models.location import Location
from app.services import label_service as ls

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


async def _area(db, org_id, name, *, parent=None, location=None, label=None, barcode):
    area = StorageArea(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name=name,
        label=label,
        storage_type=list(StorageLocationType)[0],
        parent_id=parent.id if parent else None,
        location_id=location.id if location else None,
        barcode=barcode,
    )
    db.add(area)
    await db.flush()
    return area


def _builder():
    _, builder = ls.MODULE_LABELS["storage_areas"]
    return builder


async def test_labels_name_the_area_and_where_it_is(db_session):
    org = await _make_org(db_session, "sa-labels")
    station = Location(id=str(uuid.uuid4()), organization_id=org, name="Station 1")
    db_session.add(station)
    await db_session.flush()
    rig = await _area(
        db_session, org, "Engine 1", location=station, barcode="SA-000001"
    )
    bay = await _area(
        db_session, org, "Driver side", parent=rig, label="L1", barcode="SA-000002"
    )

    specs, assigned = await _builder()(db_session, org, [bay.id], None)

    assert assigned == 0
    assert len(specs) == 1
    assert specs[0].name == "L1 · Driver side"
    assert specs[0].barcode_value == "SA-000002"
    assert specs[0].extra == "Station 1 › Engine 1"


async def test_labels_come_back_in_the_order_requested(db_session):
    # The print page pairs each preview with the id at the same position.
    org = await _make_org(db_session, "sa-order")
    first = await _area(db_session, org, "Zebra shelf", barcode="SA-000020")
    second = await _area(db_session, org, "Alpha shelf", barcode="SA-000021")

    specs, _ = await _builder()(db_session, org, [first.id, second.id, first.id], None)

    assert [s.barcode_value for s in specs] == ["SA-000020", "SA-000021"]


async def test_another_organizations_area_is_not_labelled(db_session):
    org = await _make_org(db_session, "sa-mine")
    other = await _make_org(db_session, "sa-theirs")
    mine = await _area(db_session, org, "Shelf A", barcode="SA-000010")
    theirs = await _area(db_session, other, "Shelf B", barcode="SA-000011")

    specs, _ = await _builder()(db_session, org, [mine.id, theirs.id], None)

    assert [s.barcode_value for s in specs] == ["SA-000010"]


async def test_an_area_without_a_barcode_gets_the_next_in_the_series(db_session):
    org = await _make_org(db_session, "sa-legacy")
    legacy = await _area(db_session, org, "Old rack", barcode=None)

    specs, assigned = await _builder()(db_session, org, [legacy.id], None)

    assert assigned == 1
    stored = (
        await db_session.execute(
            text("SELECT barcode FROM storage_areas WHERE id = :id"), {"id": legacy.id}
        )
    ).scalar_one()
    assert stored
    assert stored.startswith("SA-")
    # The label carries exactly what was stored, so it scans back to the area.
    assert specs[0].barcode_value == stored

"""Sightings beyond the NFC tap, against the real database (owner decisions of
2026-11-01 on Items Not Seen):

* W44-2 — creating or importing an item counts as seeing it, on every path
  that creates one;
* "Count it" — a barcode put-away counts as seeing each item it filed;
* W44-4 — the report names an item's storage area only while that area is
  active, as the item page does;
* W44-3 — Tag Items in Bulk carries each item's barcode.

What is at stake is what MySQL stores and which row the report then picks, so
a mocked session would only assert the calls as written.
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import select, text

from app.api.v1.endpoints.inventory import put_away_items as put_away_endpoint
from app.models.inventory import (
    InventoryItem,
    InventoryNfcScan,
    InventoryNfcScanAction,
    ItemStatus,
    StorageArea,
    StorageLocationType,
)
from app.schemas.inventory import PutAwayRequest
from app.services.inventory_last_seen_service import InventoryLastSeenService
from app.services.inventory_nfc_service import InventoryNfcService
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


async def _make_user(db, org_id: str) -> str:
    user_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Quinn', 'Tester', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"qm-{user_id[:8]}",
            "em": f"qm-{user_id[:8]}@test.com",
        },
    )
    await db.flush()
    return user_id


async def _area(db, org_id: str, name: str, *, label=None, active=True):
    area = StorageArea(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name=name,
        label=label,
        storage_type=list(StorageLocationType)[0],
        is_active=active,
    )
    db.add(area)
    await db.flush()
    return area


async def _item(db, org_id: str, name: str, *, area=None, status=None, barcode=None):
    item = InventoryItem(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name=name,
        quantity=1,
        status=status or ItemStatus.AVAILABLE,
        active=True,
        storage_area_id=area.id if area else None,
        barcode=barcode,
    )
    db.add(item)
    await db.flush()
    return item


async def _sightings(db, item_id: str):
    result = await db.execute(
        select(InventoryNfcScan)
        .where(InventoryNfcScan.item_id == str(item_id))
        .order_by(InventoryNfcScan.scanned_at, InventoryNfcScan.id)
    )
    return list(result.scalars().all())


@pytest.fixture
async def org(db_session):
    org_id = await _make_org(db_session, "sightings")
    user_id = await _make_user(db_session, org_id)
    return SimpleNamespace(id=org_id, user=user_id)


async def _not_seen(db, org_id, *, days=30, now=None):
    report = await InventoryLastSeenService(db).not_seen(org_id, days=days, now=now)
    return {row["name"]: row for row in report["items"]}


class TestCreationCountsAsSeen:
    async def test_create_item_records_a_creation_sighting(self, db_session, org):
        shelf = await _area(db_session, org.id, "Shelf 1")
        item, error = await InventoryService(db_session).create_item(
            org.id, {"name": "Halligan", "storage_area_id": shelf.id}, org.user
        )
        assert error is None

        rows = await _sightings(db_session, item.id)
        assert [(r.action, r.scanned_by, r.storage_area_id) for r in rows] == [
            (InventoryNfcScanAction.CREATED, org.user, shelf.id)
        ]
        # Freshly created: not listed as unseen.
        assert "Halligan" not in await _not_seen(db_session, org.id)

    async def test_the_report_names_creation_once_it_goes_stale(self, db_session, org):
        item, _ = await InventoryService(db_session).create_item(
            org.id, {"name": "Pike Pole"}, org.user
        )
        later = datetime.now(timezone.utc) + timedelta(days=45)
        row = (await _not_seen(db_session, org.id, now=later))["Pike Pole"]
        assert row["last_seen_source"] == "created"
        assert row["last_seen_at"] is not None
        assert row["days_since_seen"] in (44, 45)

    async def test_bulk_create_records_one_sighting_per_item(self, db_session, org):
        created, skipped = await InventoryService(db_session).create_items_bulk(
            org.id, [{"name": "Gauze"}, {"name": "Tape"}], org.user
        )
        assert skipped == []
        for item in created:
            rows = await _sightings(db_session, item.id)
            assert [r.action for r in rows] == [InventoryNfcScanAction.CREATED]

    async def test_size_variants_record_one_sighting_per_item(self, db_session, org):
        items, _group, _skipped = await InventoryService(
            db_session
        ).create_size_variants(
            organization_id=uuid.UUID(org.id),
            created_by=uuid.UUID(org.user),
            base_name="Station Shirt",
            sizes=["s", "m"],
            quantity_per_variant=2,
        )
        assert len(items) == 2
        for item in items:
            rows = await _sightings(db_session, item.id)
            assert [r.action for r in rows] == [InventoryNfcScanAction.CREATED]

    async def test_a_failed_create_records_nothing(self, db_session, org):
        await InventoryService(db_session).create_item(
            org.id, {"name": "Axe", "serial_number": "DUP-1"}, org.user
        )
        item, error = await InventoryService(db_session).create_item(
            org.id, {"name": "Axe 2", "serial_number": "DUP-1"}, org.user
        )
        assert item is None
        assert error
        count = (
            await db_session.execute(
                select(InventoryNfcScan.id)
                .join(InventoryItem, InventoryItem.id == InventoryNfcScan.item_id)
                .where(InventoryItem.name == "Axe 2")
            )
        ).all()
        assert count == []

    async def test_an_item_from_before_the_decision_still_reads_never(
        self, db_session, org
    ):
        """Not backfilled: only new items start as seen."""
        await _item(db_session, org.id, "Legacy Hose")
        row = (await _not_seen(db_session, org.id))["Legacy Hose"]
        assert row["last_seen_at"] is None
        assert row["last_seen_source"] is None


class TestBarcodePutAwayCountsAsSeen:
    async def test_moved_and_already_there_items_are_sighted(self, db_session, org):
        shelf_a = await _area(db_session, org.id, "Shelf A")
        shelf_b = await _area(db_session, org.id, "Shelf B")
        mover = await _item(db_session, org.id, "Radio", area=shelf_a)
        stayer = await _item(db_session, org.id, "Light", area=shelf_b)
        held = await _item(
            db_session, org.id, "Issued Coat", status=ItemStatus.ASSIGNED
        )

        result = await InventoryService(db_session).put_away_items(
            shelf_b.id,
            [mover.id, stayer.id, held.id],
            org.id,
            barcode_scanned_by=org.user,
        )
        assert result["moved"] == [mover.id]
        assert result["already_here"] == [stayer.id]

        (moved,) = await _sightings(db_session, mover.id)
        assert moved.action == InventoryNfcScanAction.BARCODE_PUT_AWAY
        assert (moved.storage_area_id, moved.from_storage_area_id) == (
            shelf_b.id,
            shelf_a.id,
        )
        assert moved.scanned_by == org.user
        assert moved.tag_id is None
        (stayed,) = await _sightings(db_session, stayer.id)
        assert stayed.action == InventoryNfcScanAction.BARCODE_PUT_AWAY
        assert stayed.from_storage_area_id == shelf_b.id
        # Skipped, as the NFC put-away refuses it before logging the tap.
        assert await _sightings(db_session, held.id) == []

        rows = await _not_seen(db_session, org.id)
        assert "Radio" not in rows
        assert "Light" not in rows

    async def test_the_report_names_the_barcode_put_away(self, db_session, org):
        shelf = await _area(db_session, org.id, "Shelf A")
        item = await _item(db_session, org.id, "Helmet")
        await InventoryService(db_session).put_away_items(
            shelf.id, [item.id], org.id, barcode_scanned_by=org.user
        )
        later = datetime.now(timezone.utc) + timedelta(days=40)
        row = (await _not_seen(db_session, org.id, now=later))["Helmet"]
        assert row["last_seen_source"] == "barcode_put_away"

    async def test_a_retry_moves_nothing_and_only_refreshes_last_seen(
        self, db_session, org
    ):
        shelf = await _area(db_session, org.id, "Shelf A")
        item = await _item(db_session, org.id, "Helmet")
        service = InventoryService(db_session)
        await service.put_away_items(
            shelf.id, [item.id], org.id, barcode_scanned_by=org.user
        )
        again = await service.put_away_items(
            shelf.id, [item.id], org.id, barcode_scanned_by=org.user
        )
        assert again["moved"] == []
        assert again["already_here"] == [item.id]
        rows = await _sightings(db_session, item.id)
        # Two sightings of the same shelf; the report reads only the latest.
        assert {(r.action, r.storage_area_id) for r in rows} == {
            (InventoryNfcScanAction.BARCODE_PUT_AWAY, shelf.id)
        }
        report = await InventoryLastSeenService(db_session).not_seen(
            org.id, days=1, now=datetime.now(timezone.utc) + timedelta(days=2)
        )
        assert [r["name"] for r in report["items"]] == ["Helmet"]

    async def test_without_a_scanner_nothing_is_sighted(self, db_session, org):
        """The NFC put-away and the audit move share put_away_items and log
        their own tap; the shared move must not log a second one."""
        shelf = await _area(db_session, org.id, "Shelf A")
        item = await _item(db_session, org.id, "Helmet")
        await InventoryService(db_session).put_away_items(shelf.id, [item.id], org.id)
        assert await _sightings(db_session, item.id) == []

    async def test_the_nfc_put_away_logs_exactly_one_tap(self, db_session, org):
        shelf = await _area(db_session, org.id, "Shelf A")
        item = await _item(db_session, org.id, "Helmet")
        await InventoryNfcService(db_session).put_away(
            organization_id=org.id,
            item_id=item.id,
            storage_area_id=shelf.id,
            scanned_by=org.user,
        )
        rows = await _sightings(db_session, item.id)
        assert [r.action for r in rows] == [InventoryNfcScanAction.PUT_AWAY]

    async def test_the_endpoint_records_the_scanner(self, db_session, org):
        shelf = await _area(db_session, org.id, "Shelf A")
        item = await _item(db_session, org.id, "Helmet")
        user = SimpleNamespace(id=org.user, organization_id=org.id, username="qm")
        await put_away_endpoint(
            area_id=uuid.UUID(shelf.id),
            request=PutAwayRequest(item_ids=[uuid.UUID(item.id)]),
            db=db_session,
            current_user=user,
        )
        (row,) = await _sightings(db_session, item.id)
        assert row.action == InventoryNfcScanAction.BARCODE_PUT_AWAY
        assert row.scanned_by == org.user


class TestDeletedAreasAreNotNamed:
    async def test_not_seen_names_only_an_active_area(self, db_session, org):
        gone = await _area(db_session, org.id, "Temp Bin", active=False)
        kept = await _area(db_session, org.id, "Rack A", label="R1")
        await _item(db_session, org.id, "Trauma Shears", area=gone)
        await _item(db_session, org.id, "SCBA", area=kept)
        rows = await _not_seen(db_session, org.id)
        assert rows["Trauma Shears"]["storage_area_name"] is None
        # Named as the item page names it: "Name (Label)".
        assert rows["SCBA"]["storage_area_name"] == "Rack A (R1)"

    async def test_tag_in_bulk_names_only_an_active_area(self, db_session, org):
        gone = await _area(db_session, org.id, "Temp Bin", active=False)
        await _item(db_session, org.id, "Trauma Shears", area=gone)
        (row,) = await InventoryNfcService(db_session).list_untagged_items(org.id)
        assert row["storage_area_name"] is None


class TestTagInBulkShowsTheBarcode:
    async def test_same_named_items_carry_their_own_barcode(self, db_session, org):
        await _item(db_session, org.id, "Shears", barcode="INV-000101")
        await _item(db_session, org.id, "Shears", barcode="INV-000102")
        await _item(db_session, org.id, "Shears")
        rows = await InventoryNfcService(db_session).list_untagged_items(org.id)
        assert sorted(r["barcode"] or "" for r in rows) == [
            "",
            "INV-000101",
            "INV-000102",
        ]

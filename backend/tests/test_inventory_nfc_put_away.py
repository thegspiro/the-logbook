"""NFC phase 2, against the real database: storage-area tags, put-away, and
the staff tap log.

What is at stake is in what MySQL stores — that the one-target check really
holds, that a move writes both the item and the log, that nothing crosses an
organization — so a mocked session would only assert the queries as written.
"""

import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.models.inventory import (
    InventoryItem,
    InventoryNfcScan,
    InventoryNfcScanAction,
    InventoryNfcTagStatus,
)
from app.models.nfc_tag import NfcCredentialType
from app.services.inventory_nfc_service import (
    InventoryNfcService,
    InventoryNfcTagNotFound,
)

pytestmark = pytest.mark.integration

ITEM_SERIAL = "04:a2:24:5b:7c:11:80"
SHELF_SERIAL = "04:99:88:77:66:55:44"


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


async def _make_user(db, org_id: str, first: str) -> str:
    user_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, 'Tester', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"{first}-{user_id[:8]}",
            "fn": first,
            "em": f"{first}-{user_id[:8]}@test.com",
        },
    )
    await db.flush()
    return user_id


async def _make_location(db, org_id: str, name: str) -> str:
    loc_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO locations (id, organization_id, name) "
            "VALUES (:id, :org, :name)"
        ),
        {"id": loc_id, "org": org_id, "name": name},
    )
    await db.flush()
    return loc_id


async def _make_area(
    db, org_id: str, name: str, *, location_id=None, active: bool = True
) -> str:
    area_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO storage_areas "
            "(id, organization_id, name, storage_type, location_id, is_active) "
            "VALUES (:id, :org, :name, 'shelf', :loc, :active)"
        ),
        {
            "id": area_id,
            "org": org_id,
            "name": name,
            "loc": location_id,
            "active": active,
        },
    )
    await db.flush()
    return area_id


async def _make_item(
    db, org_id: str, name: str, *, status: str = "available", area_id=None
) -> str:
    item_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO inventory_items "
            "(id, organization_id, name, `condition`, status, tracking_type, "
            "quantity, quantity_issued, active, storage_area_id) "
            "VALUES (:id, :org, :name, 'good', :status, 'individual', "
            "1, 0, 1, :area)"
        ),
        {
            "id": item_id,
            "org": org_id,
            "name": name,
            "status": status,
            "area": area_id,
        },
    )
    await db.flush()
    return item_id


async def _item(db, item_id: str) -> InventoryItem:
    db.expire_all()
    return (
        await db.execute(select(InventoryItem).where(InventoryItem.id == item_id))
    ).scalar_one()


async def _scans(db, item_id: str):
    return list(
        (
            await db.execute(
                select(InventoryNfcScan).where(InventoryNfcScan.item_id == item_id)
            )
        )
        .scalars()
        .all()
    )


@pytest.fixture
async def org(db_session):
    return await _make_org(db_session, "nfc2-org")


@pytest.fixture
async def other_org(db_session):
    return await _make_org(db_session, "nfc2-other")


@pytest.fixture
def service(db_session):
    return InventoryNfcService(db_session)


async def _link(service, org_id, uid, **target):
    return await service.link_tag(
        organization_id=org_id,
        tag_uid=uid,
        credential_type=NfcCredentialType.SERIAL,
        label=None,
        linked_by=None,
        **target,
    )


class TestStorageAreaTags:
    async def test_a_shelf_can_carry_a_tag(self, db_session, service, org):
        area = await _make_area(db_session, org, "Shelf B")
        await _link(service, org, SHELF_SERIAL, storage_area_id=area)
        tags = await service.list_storage_area_tags(area, org)
        assert len(tags) == 1
        assert tags[0]["storage_area_id"] == area
        assert tags[0]["item_id"] is None

    async def test_a_tag_on_an_item_cannot_also_go_on_a_shelf(
        self, db_session, service, org
    ):
        item = await _make_item(db_session, org, "Helmet 4")
        area = await _make_area(db_session, org, "Shelf C")
        await _link(service, org, ITEM_SERIAL, item_id=item)
        with pytest.raises(ValueError, match='already linked to "Helmet 4"'):
            await _link(service, org, ITEM_SERIAL, storage_area_id=area)

    async def test_a_shelf_tag_names_its_shelf_when_reused(
        self, db_session, service, org
    ):
        item = await _make_item(db_session, org, "Radio 9")
        area = await _make_area(db_session, org, "Bin 12")
        await _link(service, org, SHELF_SERIAL, storage_area_id=area)
        with pytest.raises(ValueError, match='already linked to "Bin 12"'):
            await _link(service, org, SHELF_SERIAL, item_id=item)

    async def test_linking_needs_exactly_one_target(self, service, org):
        with pytest.raises(ValueError, match="exactly one"):
            await _link(service, org, SHELF_SERIAL)

    async def test_a_shelf_in_another_organization_cannot_be_tagged(
        self, db_session, service, org, other_org
    ):
        theirs = await _make_area(db_session, other_org, "Their shelf")
        with pytest.raises(LookupError):
            await _link(service, org, SHELF_SERIAL, storage_area_id=theirs)

    async def test_the_database_refuses_a_tag_naming_nothing(self, db_session, org):
        """The check constraint, not only the service, holds the invariant.

        DBAPIError rather than IntegrityError: MariaDB reports a failed CHECK
        as an OperationalError (4025) where MySQL uses its own code, and both
        are DBAPIErrors."""

        async def insert_tag_naming_nothing():
            async with db_session.begin_nested():
                await db_session.execute(
                    text(
                        "INSERT INTO inventory_nfc_tags "
                        "(id, organization_id, uid_hash, uid_preview) "
                        "VALUES (:id, :org, :h, 'ABCD')"
                    ),
                    {"id": str(uuid.uuid4()), "org": org, "h": "x" * 64},
                )

        with pytest.raises(DBAPIError, match="one_target"):
            await insert_tag_naming_nothing()


class TestResolveAny:
    async def test_a_shelf_tag_resolves_to_the_shelf(self, db_session, service, org):
        area = await _make_area(db_session, org, "Shelf D")
        await _link(service, org, SHELF_SERIAL, storage_area_id=area)
        resolved = await service.resolve_any(org, (None, SHELF_SERIAL))
        assert resolved.storage_area is not None
        assert resolved.storage_area.id == area
        assert resolved.item is None

    async def test_the_item_scanner_is_told_a_shelf_is_not_an_item(
        self, db_session, service, org
    ):
        area = await _make_area(db_session, org, "Shelf E")
        await _link(service, org, SHELF_SERIAL, storage_area_id=area)
        with pytest.raises(InventoryNfcTagNotFound, match="storage area"):
            await service.resolve(org, (None, SHELF_SERIAL))

    async def test_an_inactive_shelf_names_nothing(self, db_session, service, org):
        area = await _make_area(db_session, org, "Old shelf", active=False)
        await _link(service, org, SHELF_SERIAL, storage_area_id=area)
        with pytest.raises(InventoryNfcTagNotFound, match="no longer active"):
            await service.resolve_any(org, (None, SHELF_SERIAL))

    async def test_a_lost_shelf_tag_names_nothing(self, db_session, service, org):
        area = await _make_area(db_session, org, "Shelf F")
        tag = await _link(service, org, SHELF_SERIAL, storage_area_id=area)
        await service.update_tag(tag["id"], org, {"status": InventoryNfcTagStatus.LOST})
        with pytest.raises(InventoryNfcTagNotFound, match="lost"):
            await service.resolve_any(org, (None, SHELF_SERIAL))


class TestPutAway:
    async def test_the_item_moves_and_its_room_follows_the_shelf(
        self, db_session, service, org
    ):
        room = await _make_location(db_session, org, "App bay")
        old = await _make_area(db_session, org, "Old shelf")
        new = await _make_area(db_session, org, "Shelf 3", location_id=room)
        item = await _make_item(db_session, org, "Thermal camera", area_id=old)
        user = await _make_user(db_session, org, "Pat")

        result = await service.put_away(
            organization_id=org, item_id=item, storage_area_id=new, scanned_by=user
        )

        assert result["moved"] is True
        assert result["from_storage_area_name"] == "Old shelf"
        stored = await _item(db_session, item)
        assert stored.storage_area_id == new
        assert stored.location_id == room

        [scan] = await _scans(db_session, item)
        assert scan.action == InventoryNfcScanAction.PUT_AWAY
        assert scan.storage_area_id == new
        assert scan.from_storage_area_id == old
        assert scan.scanned_by == user

    async def test_a_shelf_with_no_room_leaves_the_room_alone(
        self, db_session, service, org
    ):
        room = await _make_location(db_session, org, "Quartermaster")
        area = await _make_area(db_session, org, "Loose bin")
        item = await _make_item(db_session, org, "Gloves")
        await db_session.execute(
            text("UPDATE inventory_items SET location_id = :r WHERE id = :i"),
            {"r": room, "i": item},
        )
        await service.put_away(
            organization_id=org, item_id=item, storage_area_id=area, scanned_by=None
        )
        stored = await _item(db_session, item)
        assert stored.location_id == room
        assert stored.storage_area_id == area

    async def test_putting_away_where_it_already_is_is_logged_not_moved(
        self, db_session, service, org
    ):
        area = await _make_area(db_session, org, "Shelf 4")
        item = await _make_item(db_session, org, "Hose", area_id=area)
        result = await service.put_away(
            organization_id=org, item_id=item, storage_area_id=area, scanned_by=None
        )
        assert result["moved"] is False
        assert len(await _scans(db_session, item)) == 1

    @pytest.mark.parametrize(
        ("status", "message"),
        [
            ("assigned", "return it first"),
            ("checked_out", "check it in first"),
            ("lost", "update its status first"),
            ("stolen", "update its status first"),
            ("retired", "retired"),
        ],
    )
    async def test_the_barcode_put_away_rule_refuses_it(
        self, db_session, service, org, status, message
    ):
        area = await _make_area(db_session, org, "Shelf 5")
        item = await _make_item(db_session, org, "Pager", status=status)
        with pytest.raises(ValueError, match=message):
            await service.put_away(
                organization_id=org,
                item_id=item,
                storage_area_id=area,
                scanned_by=None,
            )
        assert await _scans(db_session, item) == []

    async def test_the_room_comes_from_the_nearest_shelf_above_with_one(
        self, db_session, service, org
    ):
        """The shared rule: a bin inside a cabinet lists under the cabinet's
        room when the bin itself names none."""
        room = await _make_location(db_session, org, "Stores")
        cabinet = await _make_area(db_session, org, "Cabinet 2", location_id=room)
        bin_ = await _make_area(db_session, org, "Bin 7")
        await db_session.execute(
            text("UPDATE storage_areas SET parent_id = :p WHERE id = :b"),
            {"p": cabinet, "b": bin_},
        )
        item = await _make_item(db_session, org, "Batteries")
        await service.put_away(
            organization_id=org, item_id=item, storage_area_id=bin_, scanned_by=None
        )
        stored = await _item(db_session, item)
        assert stored.storage_area_id == bin_
        assert stored.location_id == room

    async def test_nothing_crosses_an_organization(
        self, db_session, service, org, other_org
    ):
        mine_item = await _make_item(db_session, org, "Mine")
        mine_area = await _make_area(db_session, org, "My shelf")
        their_item = await _make_item(db_session, other_org, "Theirs")
        their_area = await _make_area(db_session, other_org, "Their shelf")
        with pytest.raises(LookupError):
            await service.put_away(
                organization_id=org,
                item_id=mine_item,
                storage_area_id=their_area,
                scanned_by=None,
            )
        with pytest.raises(LookupError):
            await service.put_away(
                organization_id=org,
                item_id=their_item,
                storage_area_id=mine_area,
                scanned_by=None,
            )

    async def test_a_claimed_tag_from_another_item_is_not_recorded(
        self, db_session, service, org
    ):
        area = await _make_area(db_session, org, "Shelf 6")
        item = await _make_item(db_session, org, "Light")
        other = await _make_item(db_session, org, "Other light")
        other_tag = await _link(service, org, ITEM_SERIAL, item_id=other)
        await service.put_away(
            organization_id=org,
            item_id=item,
            storage_area_id=area,
            scanned_by=None,
            item_tag_id=other_tag["id"],
        )
        [scan] = await _scans(db_session, item)
        assert scan.tag_id is None


class TestTapLog:
    async def test_newest_first_with_names_and_places(self, db_session, service, org):
        user = await _make_user(db_session, org, "Robin")
        a = await _make_area(db_session, org, "Shelf A")
        b = await _make_area(db_session, org, "Shelf B")
        item = await _make_item(db_session, org, "SCBA 2")
        tag = await _link(service, org, ITEM_SERIAL, item_id=item)
        await service.record_scan(
            organization_id=org,
            item_id=item,
            action=InventoryNfcScanAction.LOOKUP,
            scanned_by=user,
            tag_id=tag["id"],
        )
        await service.put_away(
            organization_id=org, item_id=item, storage_area_id=a, scanned_by=user
        )
        await service.put_away(
            organization_id=org, item_id=item, storage_area_id=b, scanned_by=user
        )
        # Same-second timestamps tie; make the order unambiguous.
        await db_session.execute(
            text(
                "UPDATE inventory_nfc_scans SET scanned_at = CASE action "
                "WHEN 'lookup' THEN '2026-09-01 10:00:00' "
                "ELSE IF(storage_area_id = :a, '2026-09-01 11:00:00', "
                "'2026-09-01 12:00:00') END WHERE item_id = :i"
            ),
            {"a": a, "i": item},
        )
        db_session.expire_all()

        log = await service.list_item_scans(item, org)
        assert [row["storage_area_name"] for row in log] == [
            "Shelf B",
            "Shelf A",
            None,
        ]
        assert log[0]["from_storage_area_name"] == "Shelf A"
        assert log[2]["tag_uid_preview"] == "1180"
        assert {row["scanned_by_name"] for row in log} == {"Robin Tester"}

    async def test_the_trail_outlives_an_unlinked_tag(self, db_session, service, org):
        item = await _make_item(db_session, org, "Nozzle")
        tag = await _link(service, org, ITEM_SERIAL, item_id=item)
        await service.record_scan(
            organization_id=org,
            item_id=item,
            action=InventoryNfcScanAction.LOOKUP,
            scanned_by=None,
            tag_id=tag["id"],
        )
        await service.unlink_tag(tag["id"], org)
        db_session.expire_all()
        [row] = await service.list_item_scans(item, org)
        assert row["tag_uid_preview"] is None

    async def test_another_organizations_log_is_not_readable(
        self, db_session, service, org, other_org
    ):
        theirs = await _make_item(db_session, other_org, "Theirs")
        with pytest.raises(LookupError):
            await service.list_item_scans(theirs, org)

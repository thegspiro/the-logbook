"""The inventory NFC tag register, against the real database.

What is at stake is in what MySQL returns: that the register lists every kind
of tag and only this department's, that a tag never borrows another
department's target name through a join, that the last-tap time is the tag's
own, and that a move stays inside its kind and its organization.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text

from app.models.apparatus import CheckTemplateCompartment, EquipmentCheckTemplate
from app.models.inventory import (
    InventoryNfcScan,
    InventoryNfcScanAction,
    InventoryNfcTag,
    InventoryNfcTagStatus,
)
from app.models.nfc_tag import NfcCredentialType
from app.services.inventory_nfc_register_service import InventoryNfcRegisterService
from app.services.inventory_nfc_service import InventoryNfcService

pytestmark = pytest.mark.integration

ITEM_TAG = "04:a2:24:5b:7c:11:80"
SPARE_TAG = "04:a2:24:5b:7c:11:81"
SHELF_TAG = "04:c4:46:7d:9e:33:a2"
COMPARTMENT_TAG = "04:d5:57:8e:af:44:b3"


async def _make_org(db, name: str) -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone, settings) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC', '{}')"
        ),
        {"id": org_id, "name": name, "slug": f"{name}-{org_id[:8]}"},
    )
    await db.flush()
    return org_id


async def _make_item(db, org_id: str, name: str) -> str:
    item_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO inventory_items "
            "(id, organization_id, name, `condition`, status, tracking_type, "
            "quantity, quantity_issued, active) "
            "VALUES (:id, :org, :name, 'good', 'available', 'individual', "
            "1, 0, 1)"
        ),
        {"id": item_id, "org": org_id, "name": name},
    )
    await db.flush()
    return item_id


async def _make_area(db, org_id: str, name: str) -> str:
    area_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO storage_areas "
            "(id, organization_id, name, storage_type, is_active) "
            "VALUES (:id, :org, :name, 'shelf', 1)"
        ),
        {"id": area_id, "org": org_id, "name": name},
    )
    await db.flush()
    return area_id


async def _make_compartment(db, org_id: str, template: str, name: str) -> str:
    tmpl = EquipmentCheckTemplate(
        organization_id=org_id, name=template, check_timing="start_of_shift"
    )
    db.add(tmpl)
    await db.flush()
    compartment = CheckTemplateCompartment(template_id=tmpl.id, name=name)
    db.add(compartment)
    await db.flush()
    return str(compartment.id)


async def _link(db, org_id: str, uid: str, **target) -> str:
    tag = await InventoryNfcService(db).link_tag(
        organization_id=org_id,
        tag_uid=uid,
        credential_type=NfcCredentialType.SERIAL,
        label=target.pop("label", None),
        linked_by=None,
        **target,
    )
    return str(tag["id"])


@pytest.fixture
async def org(db_session):
    return await _make_org(db_session, "nfc-register")


@pytest.fixture
async def other_org(db_session):
    return await _make_org(db_session, "nfc-register-other")


@pytest.fixture
def register(db_session):
    return InventoryNfcRegisterService(db_session)


@pytest.fixture
async def tagged(db_session, org):
    """One tag of each kind, in one department."""
    helmet = await _make_item(db_session, org, "Helmet 12")
    shelf = await _make_area(db_session, org, "Bay shelf A")
    cab = await _make_compartment(db_session, org, "Engine 1 morning", "Cab")
    return {
        "helmet": helmet,
        "shelf": shelf,
        "cab": cab,
        "item_tag": await _link(
            db_session, org, ITEM_TAG, item_id=helmet, label="Inside brim"
        ),
        "shelf_tag": await _link(db_session, org, SHELF_TAG, storage_area_id=shelf),
        "compartment_tag": await _link(
            db_session, org, COMPARTMENT_TAG, check_compartment_id=cab
        ),
    }


class TestListing:
    async def test_lists_every_kind_by_what_it_names(self, register, org, tagged):
        items, total = await register.list_tags(org)
        assert total == 3
        assert [(row["kind"], row["target_name"]) for row in items] == [
            ("storage_area", "Bay shelf A"),
            ("compartment", "Cab"),
            ("item", "Helmet 12"),
        ]
        compartment = next(row for row in items if row["kind"] == "compartment")
        assert compartment["template_name"] == "Engine 1 morning"

    async def test_lists_only_this_departments_tags(
        self, db_session, register, org, other_org, tagged
    ):
        theirs = await _make_item(db_session, other_org, "Their helmet")
        await _link(db_session, other_org, SPARE_TAG, item_id=theirs)

        items, total = await register.list_tags(org)
        assert total == 3
        assert "Their helmet" not in {row["target_name"] for row in items}

    async def test_a_tag_never_borrows_another_departments_name(
        self, db_session, register, org, other_org
    ):
        # A row whose target id points across the tenant boundary — which no
        # write path allows — must still not surface that department's name.
        theirs = await _make_item(db_session, other_org, "Their helmet")
        db_session.add(
            InventoryNfcTag(
                organization_id=org,
                item_id=theirs,
                uid_hash="f" * 64,
                uid_preview="FFFF",
                credential_type=NfcCredentialType.SERIAL,
                status=InventoryNfcTagStatus.ACTIVE,
            )
        )
        await db_session.flush()

        items, _ = await register.list_tags(org)
        assert [row["target_name"] for row in items] == [None]

    @pytest.mark.parametrize(
        ("kind", "expected"),
        [
            ("item", "Helmet 12"),
            ("storage_area", "Bay shelf A"),
            ("compartment", "Cab"),
        ],
    )
    async def test_filters_by_kind(self, register, org, tagged, kind, expected):
        items, total = await register.list_tags(org, kind=kind)
        assert total == 1
        assert items[0]["target_name"] == expected

    async def test_filters_by_status(self, db_session, register, org, tagged):
        await InventoryNfcService(db_session).update_tag(
            tagged["shelf_tag"], org, {"status": InventoryNfcTagStatus.LOST}
        )
        items, total = await register.list_tags(org, status=InventoryNfcTagStatus.LOST)
        assert total == 1
        assert items[0]["id"] == tagged["shelf_tag"]

    @pytest.mark.parametrize(
        ("search", "expected"),
        [("helmet", "Helmet 12"), ("brim", "Helmet 12"), ("engine 1", "Cab")],
    )
    async def test_searches_target_label_and_checklist(
        self, register, org, tagged, search, expected
    ):
        items, total = await register.list_tags(org, search=search)
        assert total == 1
        assert items[0]["target_name"] == expected

    async def test_a_percent_sign_is_searched_literally(self, register, org, tagged):
        _, total = await register.list_tags(org, search="%")
        assert total == 0

    async def test_last_tap_is_the_tags_own(self, db_session, register, org, tagged):
        spare = await _link(db_session, org, SPARE_TAG, item_id=tagged["helmet"])
        earlier = datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc)
        for tag_id, when in (
            (tagged["item_tag"], earlier),
            (tagged["item_tag"], earlier + timedelta(days=2)),
        ):
            db_session.add(
                InventoryNfcScan(
                    organization_id=org,
                    item_id=tagged["helmet"],
                    tag_id=tag_id,
                    action=InventoryNfcScanAction.LOOKUP,
                    scanned_at=when,
                )
            )
        await db_session.flush()

        items, _ = await register.list_tags(org, kind="item")
        by_id = {row["id"]: row["last_scanned_at"] for row in items}
        assert by_id[tagged["item_tag"]].replace(tzinfo=timezone.utc) == earlier + (
            timedelta(days=2)
        )
        assert by_id[spare] is None

    async def test_pages(self, register, org, tagged):
        items, total = await register.list_tags(org, limit=2, offset=2)
        assert total == 3
        assert [row["target_name"] for row in items] == ["Helmet 12"]


class TestBulkStatus:
    async def test_marks_tags_and_reports_unknown_ids(
        self, db_session, register, org, other_org, tagged
    ):
        theirs = await _make_item(db_session, other_org, "Their helmet")
        their_tag = await _link(db_session, other_org, SPARE_TAG, item_id=theirs)

        updated, failed = await register.bulk_update_status(
            org,
            [tagged["item_tag"], tagged["compartment_tag"], their_tag],
            InventoryNfcTagStatus.LOST,
        )
        assert {t["id"] for t in updated} == {
            tagged["item_tag"],
            tagged["compartment_tag"],
        }
        assert failed == [{"id": their_tag, "detail": "NFC tag not found"}]
        theirs_now = (
            await db_session.execute(
                select(InventoryNfcTag.status).where(InventoryNfcTag.id == their_tag)
            )
        ).scalar_one()
        assert theirs_now == InventoryNfcTagStatus.ACTIVE


class TestBulkStatusByKind:
    async def test_a_disallowed_kind_is_reported_and_left_alone(
        self, db_session, register, org, tagged
    ):
        updated, failed = await register.bulk_update_status(
            org,
            [tagged["item_tag"], tagged["compartment_tag"]],
            InventoryNfcTagStatus.LOST,
            ("compartment",),
        )
        assert [t["id"] for t in updated] == [tagged["compartment_tag"]]
        assert failed == [
            {
                "id": tagged["item_tag"],
                "detail": "You do not have permission to manage this tag.",
            }
        ]
        item_status = (
            await db_session.execute(
                select(InventoryNfcTag.status).where(
                    InventoryNfcTag.id == tagged["item_tag"]
                )
            )
        ).scalar_one()
        assert item_status == InventoryNfcTagStatus.ACTIVE


class TestMove:
    async def test_an_item_tag_moves_to_another_item(
        self, db_session, register, org, tagged
    ):
        other_helmet = await _make_item(db_session, org, "Helmet 13")
        before, after = await register.move_tag(
            tagged["item_tag"], org, item_id=other_helmet
        )
        assert before["item_id"] == tagged["helmet"]
        assert after["item_id"] == other_helmet
        assert after["uid_preview"] == before["uid_preview"]

    async def test_a_compartment_tag_moves_to_another_compartment(
        self, db_session, register, org, tagged
    ):
        rear = await _make_compartment(db_session, org, "Engine 2 morning", "Rear")
        _, after = await register.move_tag(
            tagged["compartment_tag"], org, check_compartment_id=rear
        )
        assert after["check_compartment_id"] == rear

    async def test_a_tag_cannot_change_kind(self, register, org, tagged):
        with pytest.raises(ValueError, match="same kind"):
            await register.move_tag(
                tagged["item_tag"], org, storage_area_id=tagged["shelf"]
            )

    async def test_a_tag_cannot_move_onto_its_own_target(self, register, org, tagged):
        with pytest.raises(ValueError, match="already on"):
            await register.move_tag(
                tagged["shelf_tag"], org, storage_area_id=tagged["shelf"]
            )

    @pytest.mark.parametrize("kind", ["item", "storage_area", "compartment"])
    async def test_a_tag_cannot_move_into_another_department(
        self, db_session, register, org, other_org, tagged, kind
    ):
        if kind == "item":
            target = {"item_id": await _make_item(db_session, other_org, "Theirs")}
            tag_id = tagged["item_tag"]
        elif kind == "storage_area":
            target = {"storage_area_id": await _make_area(db_session, other_org, "X")}
            tag_id = tagged["shelf_tag"]
        else:
            target = {
                "check_compartment_id": await _make_compartment(
                    db_session, other_org, "Their check", "Cab"
                )
            }
            tag_id = tagged["compartment_tag"]
        with pytest.raises(LookupError):
            await register.move_tag(tag_id, org, **target)

    async def test_another_departments_tag_cannot_be_moved(
        self, db_session, register, org, other_org
    ):
        theirs = await _make_item(db_session, other_org, "Their helmet")
        their_tag = await _link(db_session, other_org, SPARE_TAG, item_id=theirs)
        mine = await _make_item(db_session, org, "My helmet")
        with pytest.raises(LookupError):
            await register.move_tag(their_tag, org, item_id=mine)


class TestMoveTargets:
    async def test_items_are_this_departments_active_ones(
        self, db_session, register, org, other_org
    ):
        await _make_item(db_session, org, "Helmet 12")
        retired = await _make_item(db_session, org, "Helmet 99")
        await db_session.execute(
            text("UPDATE inventory_items SET active = 0 WHERE id = :id"),
            {"id": retired},
        )
        await _make_item(db_session, other_org, "Helmet 50")
        targets = await register.move_targets(org, "item", "helmet")
        assert [t["name"] for t in targets] == ["Helmet 12"]

    async def test_storage_areas_are_this_departments(
        self, db_session, register, org, other_org
    ):
        await _make_area(db_session, org, "Bay shelf A")
        await _make_area(db_session, other_org, "Bay shelf B")
        targets = await register.move_targets(org, "storage_area", "bay")
        assert [t["name"] for t in targets] == ["Bay shelf A"]

    async def test_compartments_carry_their_checklist(
        self, db_session, register, org, other_org
    ):
        await _make_compartment(db_session, org, "Engine 1 morning", "Cab")
        await _make_compartment(db_session, other_org, "Engine 1 morning", "Cab")
        targets = await register.move_targets(org, "compartment", "engine")
        assert [(t["name"], t["detail"]) for t in targets] == [
            ("Cab", "Engine 1 morning")
        ]

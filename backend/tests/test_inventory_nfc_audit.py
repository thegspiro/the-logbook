"""NFC phase 3, against the real database: shelf audits, the untagged list
and the not-seen report.

What is at stake is what MySQL stores and returns — which items an audit
expects, that confirming it moves only what was chosen, that nothing crosses an
organization, and which event the report picks as "last seen" — so a mocked
session would only assert the queries as written.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text

from app.models.inventory import (
    CheckOutRecord,
    InventoryItem,
    InventoryNfcAuditResult,
    InventoryNfcScan,
    InventoryNfcScanAction,
    InventoryNfcTagStatus,
    ItemAssignment,
    ItemIssuance,
)
from app.models.nfc_tag import NfcCredentialType
from app.services.inventory_last_seen_service import InventoryLastSeenService
from app.services.inventory_nfc_service import InventoryNfcService

pytestmark = pytest.mark.integration

NOW = datetime(2026, 9, 24, 12, 0, tzinfo=timezone.utc)


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


async def _area_of(db, item_id: str):
    db.expire_all()
    return (
        await db.execute(
            select(InventoryItem.storage_area_id).where(InventoryItem.id == item_id)
        )
    ).scalar_one()


def _results(audit) -> dict:
    return {line["item_name"]: line["result"] for line in audit["items"]}


@pytest.fixture
async def shelf(db_session):
    org = await _make_org(db_session, "audit-org")
    qm = await _make_user(db_session, org, "Quinn")
    shelf_a = await _make_area(db_session, org, "Shelf A")
    shelf_b = await _make_area(db_session, org, "Shelf B")
    items = {
        "helmet": await _make_item(db_session, org, "Helmet", area_id=shelf_a),
        "radio": await _make_item(db_session, org, "Radio", area_id=shelf_a),
        "light": await _make_item(db_session, org, "Light", area_id=shelf_b),
        "issued": await _make_item(
            db_session, org, "Issued Coat", status="assigned", area_id=shelf_a
        ),
        "retired": await _make_item(
            db_session, org, "Old Mask", status="retired", area_id=shelf_a
        ),
    }
    return {"org": org, "qm": qm, "a": shelf_a, "b": shelf_b, "items": items}


class TestCreateAudit:
    async def test_found_missing_and_unexpected(self, db_session, shelf):
        items = shelf["items"]
        audit = await InventoryNfcService(db_session).create_audit(
            organization_id=shelf["org"],
            storage_area_id=shelf["a"],
            tapped=[(items["helmet"], None), (items["light"], None)],
            audited_by=shelf["qm"],
        )
        assert _results(audit) == {
            "Helmet": InventoryNfcAuditResult.FOUND,
            "Radio": InventoryNfcAuditResult.MISSING,
            "Light": InventoryNfcAuditResult.UNEXPECTED,
        }
        assert (audit["expected_count"], audit["found_count"]) == (2, 1)
        assert (audit["missing_count"], audit["unexpected_count"]) == (1, 1)
        assert audit["audited_by_name"] == "Quinn Tester"
        light = next(i for i in audit["items"] if i["item_name"] == "Light")
        assert light["recorded_storage_area_name"] == "Shelf B"

    async def test_items_recorded_elsewhere_by_status_are_not_expected(
        self, db_session, shelf
    ):
        """An assigned coat and a retired mask still point at the shelf, but
        their status already says they are not on it — reporting them missing
        would be noise on every audit."""
        audit = await InventoryNfcService(db_session).create_audit(
            organization_id=shelf["org"],
            storage_area_id=shelf["a"],
            tapped=[],
            audited_by=shelf["qm"],
        )
        assert set(_results(audit)) == {"Helmet", "Radio"}

    async def test_tapping_an_assigned_item_on_the_shelf_is_unexpected(
        self, db_session, shelf
    ):
        audit = await InventoryNfcService(db_session).create_audit(
            organization_id=shelf["org"],
            storage_area_id=shelf["a"],
            tapped=[(shelf["items"]["issued"], None)],
            audited_by=shelf["qm"],
        )
        assert _results(audit)["Issued Coat"] == InventoryNfcAuditResult.UNEXPECTED

    async def test_the_audit_moves_nothing(self, db_session, shelf):
        await InventoryNfcService(db_session).create_audit(
            organization_id=shelf["org"],
            storage_area_id=shelf["a"],
            tapped=[(shelf["items"]["light"], None)],
            audited_by=shelf["qm"],
        )
        assert await _area_of(db_session, shelf["items"]["light"]) == shelf["b"]

    async def test_every_tap_is_logged_as_an_audit_on_the_shelf(
        self, db_session, shelf
    ):
        service = InventoryNfcService(db_session)
        helmet = shelf["items"]["helmet"]
        tag = await service.link_tag(
            organization_id=shelf["org"],
            item_id=helmet,
            tag_uid="04:a2:24:5b:7c:11:80",
            credential_type=NfcCredentialType.SERIAL,
            label=None,
            linked_by=shelf["qm"],
        )
        await service.create_audit(
            organization_id=shelf["org"],
            storage_area_id=shelf["a"],
            tapped=[(helmet, tag["id"]), (shelf["items"]["light"], tag["id"])],
            audited_by=shelf["qm"],
        )
        scans = (
            (
                await db_session.execute(
                    select(InventoryNfcScan).where(
                        InventoryNfcScan.organization_id == shelf["org"]
                    )
                )
            )
            .scalars()
            .all()
        )
        by_item = {s.item_id: s for s in scans}
        assert set(by_item) == {helmet, shelf["items"]["light"]}
        assert all(s.action == InventoryNfcScanAction.AUDIT for s in scans)
        assert all(s.storage_area_id == shelf["a"] for s in scans)
        assert by_item[helmet].tag_id == tag["id"]
        # The tag is on the helmet, not the light: the log must not claim it.
        assert by_item[shelf["items"]["light"]].tag_id is None

    async def test_another_organizations_items_are_ignored(self, db_session, shelf):
        other = await _make_org(db_session, "other-org")
        foreign = await _make_item(db_session, other, "Foreign Helmet")
        audit = await InventoryNfcService(db_session).create_audit(
            organization_id=shelf["org"],
            storage_area_id=shelf["a"],
            tapped=[(foreign, None)],
            audited_by=shelf["qm"],
        )
        assert "Foreign Helmet" not in _results(audit)
        assert audit["unexpected_count"] == 0

    async def test_another_organizations_shelf_is_not_found(self, db_session, shelf):
        other = await _make_org(db_session, "other-org")
        foreign_area = await _make_area(db_session, other, "Their Shelf")
        with pytest.raises(LookupError):
            await InventoryNfcService(db_session).create_audit(
                organization_id=shelf["org"],
                storage_area_id=foreign_area,
                tapped=[],
                audited_by=shelf["qm"],
            )

    async def test_an_inactive_shelf_is_refused(self, db_session, shelf):
        closed = await _make_area(db_session, shelf["org"], "Closed", active=False)
        with pytest.raises(ValueError, match="no longer active"):
            await InventoryNfcService(db_session).create_audit(
                organization_id=shelf["org"],
                storage_area_id=closed,
                tapped=[],
                audited_by=shelf["qm"],
            )


class TestApplyAudit:
    async def _audit(self, db_session, shelf, tapped):
        return await InventoryNfcService(db_session).create_audit(
            organization_id=shelf["org"],
            storage_area_id=shelf["a"],
            tapped=[(i, None) for i in tapped],
            audited_by=shelf["qm"],
        )

    async def test_moves_the_chosen_unexpected_item(self, db_session, shelf):
        light = shelf["items"]["light"]
        audit = await self._audit(db_session, shelf, [light])
        applied = await InventoryNfcService(db_session).apply_audit(
            audit_id=audit["id"],
            organization_id=shelf["org"],
            item_ids=[light],
            applied_by=shelf["qm"],
        )
        assert await _area_of(db_session, light) == shelf["a"]
        assert applied["moved_item_ids"] == [light]
        assert applied["skipped"] == []
        assert applied["applied_by_name"] == "Quinn Tester"
        assert applied["applied_at"] is not None
        line = next(i for i in applied["items"] if i["item_id"] == light)
        assert line["moved"] is True

    async def test_an_assigned_item_is_skipped_with_the_reason(self, db_session, shelf):
        issued = shelf["items"]["issued"]
        audit = await self._audit(db_session, shelf, [issued])
        applied = await InventoryNfcService(db_session).apply_audit(
            audit_id=audit["id"],
            organization_id=shelf["org"],
            item_ids=[issued],
            applied_by=shelf["qm"],
        )
        assert applied["moved_item_ids"] == []
        assert applied["skipped"][0]["reason"].startswith("assigned")
        assert applied["applied_at"] is None

    @pytest.mark.parametrize("which", ["helmet", "radio"])
    async def test_found_and_missing_lines_cannot_be_applied(
        self, db_session, shelf, which
    ):
        """Missing items are only listed: confirming an audit can never mark
        one lost, or move it anywhere."""
        audit = await self._audit(db_session, shelf, [shelf["items"]["helmet"]])
        with pytest.raises(ValueError, match="Only items this audit found"):
            await InventoryNfcService(db_session).apply_audit(
                audit_id=audit["id"],
                organization_id=shelf["org"],
                item_ids=[shelf["items"][which]],
                applied_by=shelf["qm"],
            )

    async def test_a_moved_line_cannot_be_applied_twice(self, db_session, shelf):
        light = shelf["items"]["light"]
        audit = await self._audit(db_session, shelf, [light])
        service = InventoryNfcService(db_session)
        await service.apply_audit(
            audit_id=audit["id"],
            organization_id=shelf["org"],
            item_ids=[light],
            applied_by=shelf["qm"],
        )
        with pytest.raises(ValueError, match="Only items this audit found"):
            await service.apply_audit(
                audit_id=audit["id"],
                organization_id=shelf["org"],
                item_ids=[light],
                applied_by=shelf["qm"],
            )

    async def test_another_organizations_audit_is_not_found(self, db_session, shelf):
        audit = await self._audit(db_session, shelf, [shelf["items"]["light"]])
        other = await _make_org(db_session, "other-org")
        with pytest.raises(LookupError):
            await InventoryNfcService(db_session).apply_audit(
                audit_id=audit["id"],
                organization_id=other,
                item_ids=[shelf["items"]["light"]],
                applied_by=None,
            )


class TestListAudits:
    async def test_newest_first_and_filtered_by_shelf(self, db_session, shelf):
        service = InventoryNfcService(db_session)
        first = await service.create_audit(
            organization_id=shelf["org"],
            storage_area_id=shelf["a"],
            tapped=[],
            audited_by=shelf["qm"],
        )
        second = await service.create_audit(
            organization_id=shelf["org"],
            storage_area_id=shelf["b"],
            tapped=[],
            audited_by=shelf["qm"],
        )
        listed = await service.list_audits(shelf["org"])
        assert {a["id"] for a in listed} == {first["id"], second["id"]}
        only_a = await service.list_audits(shelf["org"], storage_area_id=shelf["a"])
        assert [a["id"] for a in only_a] == [first["id"]]
        other = await _make_org(db_session, "other-org")
        assert await service.list_audits(other) == []


class TestUntagged:
    async def test_lists_active_items_without_a_working_tag(self, db_session, shelf):
        service = InventoryNfcService(db_session)
        items = shelf["items"]
        await service.link_tag(
            organization_id=shelf["org"],
            item_id=items["helmet"],
            tag_uid="04:a2:24:5b:7c:11:80",
            credential_type=NfcCredentialType.SERIAL,
            label=None,
            linked_by=None,
        )
        lost = await service.link_tag(
            organization_id=shelf["org"],
            item_id=items["radio"],
            tag_uid="04:99:88:77:66:55:44",
            credential_type=NfcCredentialType.SERIAL,
            label=None,
            linked_by=None,
        )
        await service.update_tag(
            lost["id"], shelf["org"], {"status": InventoryNfcTagStatus.LOST}
        )
        names = [i["name"] for i in await service.list_untagged_items(shelf["org"])]
        # Retired items excluded; everything else without an active tag.
        assert names == ["Issued Coat", "Light", "Radio"]

    async def test_search_is_literal(self, db_session, shelf):
        service = InventoryNfcService(db_session)
        assert await service.list_untagged_items(shelf["org"], search="%") == []
        found = await service.list_untagged_items(shelf["org"], search="rad")
        assert [i["name"] for i in found] == ["Radio"]
        assert found[0]["storage_area_name"] == "Shelf A"


class TestNotSeen:
    async def test_picks_the_latest_event_and_its_source(self, db_session, shelf):
        org, qm, items = shelf["org"], shelf["qm"], shelf["items"]
        long_ago = NOW - timedelta(days=400)
        db_session.add_all(
            [
                ItemAssignment(
                    organization_id=org,
                    item_id=items["helmet"],
                    user_id=qm,
                    assigned_date=long_ago,
                    returned_date=NOW - timedelta(days=200),
                ),
                CheckOutRecord(
                    organization_id=org,
                    item_id=items["radio"],
                    user_id=qm,
                    checked_out_at=NOW - timedelta(days=10),
                ),
                ItemIssuance(
                    organization_id=org,
                    item_id=items["issued"],
                    user_id=qm,
                    issued_at=long_ago,
                ),
                InventoryNfcScan(
                    organization_id=org,
                    item_id=items["issued"],
                    action=InventoryNfcScanAction.LOOKUP,
                    scanned_at=NOW - timedelta(days=300),
                ),
            ]
        )
        await db_session.flush()

        report = await InventoryLastSeenService(db_session).not_seen(
            org, days=180, now=NOW
        )
        rows = {r["name"]: r for r in report["items"]}
        # Radio was checked out ten days ago; the mask is retired.
        assert set(rows) == {"Helmet", "Issued Coat", "Light"}
        assert rows["Helmet"]["last_seen_source"] == "return"
        assert rows["Helmet"]["days_since_seen"] == 200
        assert rows["Issued Coat"]["last_seen_source"] == "nfc_tap"
        assert rows["Light"]["last_seen_at"] is None
        # Never seen first, then the longest unseen.
        assert [r["name"] for r in report["items"]] == [
            "Light",
            "Issued Coat",
            "Helmet",
        ]
        assert report["total"] == 3

    async def test_limit_cuts_items_but_not_total(self, db_session, shelf):
        report = await InventoryLastSeenService(db_session).not_seen(
            shelf["org"], days=30, limit=1, now=NOW
        )
        assert len(report["items"]) == 1
        assert report["total"] == 4

    async def test_another_organizations_events_do_not_count(self, db_session, shelf):
        other = await _make_org(db_session, "other-org")
        db_session.add(
            InventoryNfcScan(
                # A row claiming this org's item under another org's id must not
                # mark the item seen.
                organization_id=other,
                item_id=shelf["items"]["light"],
                action=InventoryNfcScanAction.LOOKUP,
                scanned_at=NOW,
            )
        )
        await db_session.flush()
        report = await InventoryLastSeenService(db_session).not_seen(
            shelf["org"], days=30, now=NOW
        )
        light = next(r for r in report["items"] if r["name"] == "Light")
        assert light["last_seen_at"] is None

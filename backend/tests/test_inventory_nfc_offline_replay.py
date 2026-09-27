"""NFC phase 4d, against the real database: taps made offline, applied later.

The phone queues raw reads; these check that the server turns them into the
same moves and audits the screens make online, in order, that one bad tap does
not undo the rest, and that an audit resent after a lost response is saved
once.
"""

import uuid

import pytest
from sqlalchemy import func, select, text

from app.models.inventory import (
    InventoryItem,
    InventoryNfcAudit,
    InventoryNfcAuditResult,
    InventoryNfcScan,
    InventoryNfcScanAction,
    InventoryNfcTagStatus,
)
from app.models.nfc_tag import NfcCredentialType
from app.services.inventory_nfc_service import InventoryNfcService

pytestmark = pytest.mark.integration

SHELF_A = "04:a1:00:00:00:00:01"
SHELF_B = "04:a1:00:00:00:00:02"
HELMET = "04:b2:00:00:00:00:01"
RADIO = "04:b2:00:00:00:00:02"
ISSUED = "04:b2:00:00:00:00:03"
UNLINKED = "04:ff:ff:ff:ff:ff:ff"


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


async def _make_area(db, org_id: str, name: str, *, active: bool = True) -> str:
    area_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO storage_areas "
            "(id, organization_id, name, storage_type, is_active) "
            "VALUES (:id, :org, :name, 'shelf', :active)"
        ),
        {"id": area_id, "org": org_id, "name": name, "active": active},
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


def _read(serial: str) -> dict:
    return {"code": None, "serial_number": serial, "storage_area_id": None}


def _pick(area_id: str) -> dict:
    return {"code": None, "serial_number": None, "storage_area_id": area_id}


@pytest.fixture
async def org(db_session):
    return await _make_org(db_session, "nfc-offline")


@pytest.fixture
def service(db_session):
    return InventoryNfcService(db_session)


@pytest.fixture
async def stock(db_session, service, org):
    """Two tagged shelves; a helmet and a radio on no shelf; an issued item."""
    ids = {
        "shelf_a": await _make_area(db_session, org, "Shelf A"),
        "shelf_b": await _make_area(db_session, org, "Shelf B"),
        "helmet": await _make_item(db_session, org, "Helmet 4"),
        "radio": await _make_item(db_session, org, "Radio 7"),
        "issued": await _make_item(db_session, org, "Coat 9", status="assigned"),
    }
    for serial, target in (
        (SHELF_A, {"storage_area_id": ids["shelf_a"]}),
        (SHELF_B, {"storage_area_id": ids["shelf_b"]}),
        (HELMET, {"item_id": ids["helmet"]}),
        (RADIO, {"item_id": ids["radio"]}),
        (ISSUED, {"item_id": ids["issued"]}),
    ):
        await service.link_tag(
            organization_id=org,
            tag_uid=serial,
            credential_type=NfcCredentialType.SERIAL,
            label=None,
            linked_by=None,
            **target,
        )
    return ids


class TestPutAwayReplay:
    async def test_shelf_first_puts_every_item_after_it_on_the_shelf(
        self, db_session, service, org, stock
    ):
        result = await service.replay_put_away(
            organization_id=org,
            scanned_by=None,
            taps=[_read(SHELF_A), _read(HELMET), _read(RADIO)],
        )

        assert [r["outcome"] for r in result["results"]] == [
            "shelf_opened",
            "moved",
            "moved",
        ]
        assert result["moved_count"] == 2
        assert await _area_of(db_session, stock["helmet"]) == stock["shelf_a"]
        assert await _area_of(db_session, stock["radio"]) == stock["shelf_a"]

    async def test_item_first_moves_once_and_leaves_the_shelf_closed(
        self, db_session, service, org, stock
    ):
        result = await service.replay_put_away(
            organization_id=org,
            scanned_by=None,
            taps=[_read(HELMET), _read(SHELF_B), _read(RADIO)],
        )

        assert [r["outcome"] for r in result["results"]] == [
            "held",
            "moved",
            "held",
        ]
        assert await _area_of(db_session, stock["helmet"]) == stock["shelf_b"]
        assert await _area_of(db_session, stock["radio"]) is None
        assert result["held_item_name"] == "Radio 7"

    async def test_it_continues_from_the_shelf_open_when_signal_went(
        self, db_session, service, org, stock
    ):
        result = await service.replay_put_away(
            organization_id=org,
            scanned_by=None,
            taps=[_read(RADIO)],
            open_storage_area_id=stock["shelf_b"],
        )
        assert result["results"][0]["outcome"] == "moved"
        assert await _area_of(db_session, stock["radio"]) == stock["shelf_b"]

    async def test_it_continues_from_an_item_held_when_signal_went(
        self, db_session, service, org, stock
    ):
        result = await service.replay_put_away(
            organization_id=org,
            scanned_by=None,
            taps=[_pick(stock["shelf_a"])],
            held_item_id=stock["helmet"],
        )
        assert result["results"][0]["outcome"] == "moved"
        assert await _area_of(db_session, stock["helmet"]) == stock["shelf_a"]

    async def test_a_bad_tap_is_reported_and_the_rest_still_apply(
        self, db_session, service, org, stock
    ):
        result = await service.replay_put_away(
            organization_id=org,
            scanned_by=None,
            taps=[_read(SHELF_A), _read(UNLINKED), _read(ISSUED), _read(HELMET)],
        )

        steps = result["results"]
        assert [s["outcome"] for s in steps] == [
            "shelf_opened",
            "unread",
            "refused",
            "moved",
        ]
        assert "not linked" in steps[1]["message"]
        assert steps[2]["item_name"] == "Coat 9"
        assert result["unread_count"] == 1
        assert result["refused_count"] == 1
        assert await _area_of(db_session, stock["helmet"]) == stock["shelf_a"]
        assert await _area_of(db_session, stock["issued"]) is None

    async def test_a_second_tap_on_the_same_shelf_is_already_there(
        self, service, org, stock
    ):
        result = await service.replay_put_away(
            organization_id=org,
            scanned_by=None,
            taps=[_read(SHELF_A), _read(HELMET), _read(HELMET)],
        )
        assert [r["outcome"] for r in result["results"]][1:] == [
            "moved",
            "already_there",
        ]

    async def test_moves_are_logged_as_put_aways(self, db_session, service, org, stock):
        await service.replay_put_away(
            organization_id=org,
            scanned_by=None,
            taps=[_read(SHELF_A), _read(HELMET)],
        )
        scans = (
            (
                await db_session.execute(
                    select(InventoryNfcScan).where(
                        InventoryNfcScan.item_id == stock["helmet"]
                    )
                )
            )
            .scalars()
            .all()
        )
        assert [s.action for s in scans] == [InventoryNfcScanAction.PUT_AWAY]
        assert scans[0].storage_area_id == stock["shelf_a"]

    async def test_another_departments_shelf_or_item_is_not_found(
        self, db_session, service, org, stock
    ):
        other = await _make_org(db_session, "nfc-offline-other")
        theirs = await _make_area(db_session, other, "Their shelf")
        result = await service.replay_put_away(
            organization_id=org,
            scanned_by=None,
            taps=[_pick(theirs), _read(HELMET)],
            held_item_id=await _make_item(db_session, other, "Their helmet"),
        )
        assert result["results"][0]["outcome"] == "refused"
        # The foreign held item was dropped, so the helmet is held, not moved.
        assert result["results"][1]["outcome"] == "held"


class TestAuditReplay:
    async def _replay(self, service, org, **kwargs):
        return await service.replay_audit(
            organization_id=org,
            audited_by=None,
            client_submission_id=kwargs.pop("client_id", f"sub-{uuid.uuid4().hex}"),
            storage_area_id=kwargs.pop("storage_area_id", None),
            tapped=kwargs.pop("tapped", []),
            taps=kwargs.pop("taps", []),
        )

    async def test_the_first_shelf_tapped_is_the_one_audited(
        self, db_session, service, org, stock
    ):
        await _make_item(db_session, org, "Axe 2", area_id=stock["shelf_a"])
        result = await self._replay(
            service, org, taps=[_read(HELMET), _read(SHELF_A), _read(RADIO)]
        )

        audit = result["audit"]
        assert result["created"] is True
        assert audit["storage_area_id"] == stock["shelf_a"]
        by_name = {line["item_name"]: line["result"] for line in audit["items"]}
        assert by_name == {
            "Axe 2": InventoryNfcAuditResult.MISSING,
            "Helmet 4": InventoryNfcAuditResult.UNEXPECTED,
            "Radio 7": InventoryNfcAuditResult.UNEXPECTED,
        }

    async def test_items_identified_before_signal_went_count_too(
        self, db_session, service, org, stock
    ):
        axe = await _make_item(db_session, org, "Axe 2", area_id=stock["shelf_a"])
        result = await self._replay(
            service,
            org,
            storage_area_id=stock["shelf_a"],
            tapped=[(axe, None)],
            taps=[_read(HELMET)],
        )
        assert result["audit"]["found_count"] == 1
        assert result["audit"]["unexpected_count"] == 1

    async def test_unread_and_other_shelf_taps_are_counted_and_ignored(
        self, service, org, stock
    ):
        result = await self._replay(
            service,
            org,
            storage_area_id=stock["shelf_a"],
            taps=[_read(UNLINKED), _read(SHELF_B), _read(SHELF_A), _read(HELMET)],
        )
        assert result["unread_count"] == 1
        assert result["other_shelf_count"] == 1
        assert result["audit"]["storage_area_id"] == stock["shelf_a"]

    async def test_no_shelf_means_nothing_is_saved_and_says_why(
        self, db_session, service, org, stock
    ):
        result = await self._replay(service, org, taps=[_read(HELMET)])
        assert result["audit"] is None
        assert "No shelf" in result["not_saved_reason"]
        count = (
            await db_session.execute(
                select(func.count())
                .select_from(InventoryNfcAudit)
                .where(InventoryNfcAudit.organization_id == org)
            )
        ).scalar_one()
        assert count == 0

    async def test_an_inactive_chosen_shelf_is_not_audited(
        self, db_session, service, org, stock
    ):
        closed = await _make_area(db_session, org, "Old shelf", active=False)
        result = await self._replay(service, org, storage_area_id=closed)
        assert result["audit"] is None
        assert "no longer active" in result["not_saved_reason"]

    async def test_a_resend_returns_the_audit_already_saved(
        self, db_session, service, org, stock
    ):
        first = await self._replay(
            service, org, client_id="phone-abc-123", taps=[_read(SHELF_A)]
        )
        again = await self._replay(
            service, org, client_id="phone-abc-123", taps=[_read(SHELF_A)]
        )

        assert again["created"] is False
        assert again["audit"]["id"] == first["audit"]["id"]
        count = (
            await db_session.execute(
                select(func.count())
                .select_from(InventoryNfcAudit)
                .where(InventoryNfcAudit.organization_id == org)
            )
        ).scalar_one()
        assert count == 1

    async def test_the_same_submission_id_in_another_department_is_separate(
        self, db_session, service, org, stock
    ):
        other = await _make_org(db_session, "nfc-offline-audit-other")
        their_shelf = await _make_area(db_session, other, "Their shelf")
        mine = await self._replay(
            service, org, client_id="phone-shared-1", storage_area_id=stock["shelf_a"]
        )
        theirs = await self._replay(
            service, other, client_id="phone-shared-1", storage_area_id=their_shelf
        )
        assert theirs["created"] is True
        assert theirs["audit"]["id"] != mine["audit"]["id"]

    async def test_a_lost_tag_is_unread(self, service, org, stock):
        tags = await service.list_item_tags(stock["helmet"], org)
        await service.update_tag(
            tags[0]["id"], org, {"status": InventoryNfcTagStatus.LOST}
        )
        result = await self._replay(
            service, org, storage_area_id=stock["shelf_a"], taps=[_read(HELMET)]
        )
        assert result["unread_count"] == 1
        assert result["audit"]["unexpected_count"] == 0

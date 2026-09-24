"""Printed-label tracking on inventory items.

An item leaves the "needs a label" worklist only when a quartermaster confirms
its label printed, and returns to it when the value its label encodes changes
— the label on the shelf then no longer scans to the item. The DB half asserts
what MySQL actually stores through the listener; the unit half pins the value
the listener and the label PDF must agree on.
"""

import uuid

import pytest
from sqlalchemy import select, text

from app.models.inventory import InventoryItem
from app.services.inventory_service import InventoryService
from app.utils.label_renderer import printable_label_value


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
            "VALUES (:id, :org, :un, 'Quarter', 'Master', :em, 'hashed', 'active')"
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


async def _make_item(db, org_id: str, **identifiers) -> InventoryItem:
    item = InventoryItem(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name=f"item-{uuid.uuid4().hex[:6]}",
        quantity=1,
        active=True,
        **identifiers,
    )
    db.add(item)
    await db.flush()
    return item


async def _stored(db, item_id: str) -> tuple:
    row = await db.execute(
        text(
            "SELECT label_printed_at, label_printed_by "
            "FROM inventory_items WHERE id = :id"
        ),
        {"id": item_id},
    )
    return tuple(row.one())


@pytest.mark.unit
class TestPrintableLabelValue:
    def test_prefers_barcode_then_asset_tag_then_serial(self):
        assert printable_label_value("INV-1", "AT-1", "SN-1") == "INV-1"
        assert printable_label_value(None, "AT-1", "SN-1") == "AT-1"
        assert printable_label_value("", None, "SN-1") == "SN-1"

    def test_skips_an_identifier_code128_cannot_carry_whole(self):
        # A partly non-ASCII barcode is never truncated onto a label; the next
        # stored identifier is what prints.
        assert printable_label_value("INV-12火", "AT-42", None) == "AT-42"

    def test_empty_when_nothing_is_printable(self):
        assert printable_label_value(None, "  ", "火") == ""


@pytest.mark.integration
class TestMarkLabelsPrinted:
    async def test_marks_only_the_callers_items_that_can_carry_a_label(
        self, db_session
    ):
        org = await _make_org(db_session, "labels-a")
        other_org = await _make_org(db_session, "labels-b")
        user = await _make_user(db_session, org)
        labelled = await _make_item(db_session, org, barcode="INV-0001")
        unprintable = await _make_item(db_session, org)
        foreign = await _make_item(db_session, other_org, barcode="INV-0002")

        marked = await InventoryService(db_session).mark_labels_printed(
            item_ids=[
                uuid.UUID(labelled.id),
                uuid.UUID(labelled.id),
                uuid.UUID(unprintable.id),
                uuid.UUID(foreign.id),
            ],
            organization_id=uuid.UUID(org),
            user_id=uuid.UUID(user),
        )

        assert marked == 1
        printed_at, printed_by = await _stored(db_session, labelled.id)
        assert printed_at is not None
        assert printed_by == user
        # Another org's id is ignored, not marked: the permission gate does not
        # scope the object (CLAUDE.md pitfall #14b).
        assert await _stored(db_session, foreign.id) == (None, None)
        assert await _stored(db_session, unprintable.id) == (None, None)

    async def test_the_list_filters_on_the_mark(self, db_session):
        org = await _make_org(db_session, "labels-filter")
        user = await _make_user(db_session, org)
        done = await _make_item(db_session, org, barcode="INV-0010")
        todo = await _make_item(db_session, org, barcode="INV-0011")
        service = InventoryService(db_session)
        await service.mark_labels_printed(
            item_ids=[uuid.UUID(done.id)],
            organization_id=uuid.UUID(org),
            user_id=uuid.UUID(user),
        )

        needs, needs_total = await service.get_items(
            organization_id=uuid.UUID(org), label_printed=False
        )
        printed, printed_total = await service.get_items(
            organization_id=uuid.UUID(org), label_printed=True
        )
        _, everything = await service.get_items(organization_id=uuid.UUID(org))

        assert [i.id for i in needs] == [todo.id]
        assert needs_total == 1
        assert [i.id for i in printed] == [done.id]
        assert printed_total == 1
        assert everything == 2


@pytest.mark.integration
class TestLabelValueChangeClearsTheMark:
    async def _marked_item(self, db, **identifiers) -> InventoryItem:
        org = await _make_org(db, f"labels-{uuid.uuid4().hex[:6]}")
        user = await _make_user(db, org)
        item = await _make_item(db, org, **identifiers)
        await InventoryService(db).mark_labels_printed(
            item_ids=[uuid.UUID(item.id)],
            organization_id=uuid.UUID(org),
            user_id=uuid.UUID(user),
        )
        assert (await _stored(db, item.id))[0] is not None
        return item

    async def test_a_new_barcode_clears_it(self, db_session):
        item = await self._marked_item(db_session, barcode="INV-0100")
        item.barcode = "INV-0101"
        await db_session.commit()
        assert await _stored(db_session, item.id) == (None, None)

    async def test_an_identifier_the_label_does_not_carry_keeps_it(self, db_session):
        item = await self._marked_item(db_session, barcode="INV-0200", asset_tag="A1")
        item.asset_tag = "A2"
        item.name = "Renamed"
        await db_session.commit()
        assert (await _stored(db_session, item.id))[0] is not None

    async def test_the_fallback_identifier_the_label_carries_clears_it(
        self, db_session
    ):
        item = await self._marked_item(db_session, asset_tag="AT-300")
        item.asset_tag = "AT-301"
        await db_session.commit()
        assert await _stored(db_session, item.id) == (None, None)

    async def test_the_pdf_barcode_auto_fill_clears_it(self, db_session):
        # Labelled by asset tag, then the print path assigns a sequential
        # barcode: the next label carries the barcode, so the old one is stale.
        item = await self._marked_item(db_session, asset_tag="AT-400")
        await InventoryService(db_session).build_label_specs(
            [item.id], item.organization_id, persist=True
        )
        refreshed = (
            await db_session.execute(
                select(InventoryItem.barcode).where(InventoryItem.id == item.id)
            )
        ).scalar_one()
        assert refreshed
        assert await _stored(db_session, item.id) == (None, None)

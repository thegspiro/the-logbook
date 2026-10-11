"""
INV-17: "Complete work" closes an item's open maintenance record instead of
creating a second, completed one beside it.

The screen asks for the item's open records (``open_only``), picks the
earliest (or the one the officer chooses) and completes it through
``update_maintenance_record``. These pin the two backend halves that flow
relies on: the open-record listing, and a completion that updates the item
once under a row lock.
"""

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import event, select

from app.models.inventory import (
    InventoryItem,
    ItemCondition,
    ItemStatus,
    MaintenanceRecord,
    MaintenanceType,
)
from app.models.user import Organization
from app.services.inventory_service import InventoryService

pytestmark = pytest.mark.integration


async def _make_org(db):
    org = Organization(name="Maint FD", slug=f"maint-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _make_item(db, org):
    item = InventoryItem(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="SCBA Mask",
        active=True,
        status=ItemStatus.IN_MAINTENANCE,
        condition=ItemCondition.DAMAGED,
    )
    db.add(item)
    await db.flush()
    return item


async def _make_record(db, org, item, **kwargs):
    record = MaintenanceRecord(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        item_id=item.id,
        maintenance_type=kwargs.pop("maintenance_type", MaintenanceType.REPAIR),
        is_completed=kwargs.pop("is_completed", False),
        **kwargs,
    )
    db.add(record)
    await db.flush()
    return record


class TestOpenOnlyListing:
    async def test_returns_only_open_records_earliest_first(self, db_session):
        org = await _make_org(db_session)
        item = await _make_item(db_session, org)
        today = date(2026, 10, 1)
        later = await _make_record(
            db_session, org, item, scheduled_date=today + timedelta(days=5)
        )
        earliest = await _make_record(db_session, org, item, scheduled_date=today)
        undated = await _make_record(db_session, org, item)
        await _make_record(
            db_session, org, item, is_completed=True, completed_date=today
        )

        records = await InventoryService(db_session).get_item_maintenance_history(
            item.id, org.id, open_only=True
        )

        assert [r.id for r in records] == [earliest.id, later.id, undated.id]

    async def test_open_records_survive_a_long_completed_history(self, db_session):
        """Sorted by completed_date desc, the open (NULL-dated) record falls
        past the page limit; open_only must still find it."""
        org = await _make_org(db_session)
        item = await _make_item(db_session, org)
        for offset in range(5):
            await _make_record(
                db_session,
                org,
                item,
                is_completed=True,
                completed_date=date(2026, 1, 1) + timedelta(days=offset),
            )
        open_record = await _make_record(db_session, org, item)
        service = InventoryService(db_session)

        full = await service.get_item_maintenance_history(item.id, org.id, limit=3)
        open_only = await service.get_item_maintenance_history(
            item.id, org.id, limit=3, open_only=True
        )

        assert open_record.id not in [r.id for r in full]
        assert [r.id for r in open_only] == [open_record.id]

    async def test_another_departments_records_are_not_listed(self, db_session):
        org = await _make_org(db_session)
        other = await _make_org(db_session)
        item = await _make_item(db_session, other)
        await _make_record(db_session, other, item)

        records = await InventoryService(db_session).get_item_maintenance_history(
            item.id, org.id, open_only=True
        )

        assert records == []


class TestClosingTheOpenRecord:
    async def test_completing_closes_the_record_and_creates_no_other(self, db_session):
        org = await _make_org(db_session)
        item = await _make_item(db_session, org)
        record = await _make_record(db_session, org, item, description="Replace strap")

        updated, error = await InventoryService(db_session).update_maintenance_record(
            record.id,
            item.id,
            org.id,
            {
                "is_completed": True,
                "completed_date": date(2026, 10, 2),
                "condition_after": ItemCondition.GOOD,
                "vendor_name": "Bench tech",
                "notes": "Work performed: new strap fitted",
            },
        )

        assert error is None
        assert updated.is_completed is True
        assert updated.description == "Replace strap"
        rows = (
            (
                await db_session.execute(
                    select(MaintenanceRecord).where(
                        MaintenanceRecord.item_id == item.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1
        open_left = await InventoryService(db_session).get_item_maintenance_history(
            item.id, org.id, open_only=True
        )
        assert open_left == []
        await db_session.refresh(item)
        assert item.condition == ItemCondition.GOOD
        # Completion never silently returns gear to service.
        assert item.status == ItemStatus.IN_MAINTENANCE

    async def test_the_record_row_is_locked(self, db_session):
        org = await _make_org(db_session)
        item = await _make_item(db_session, org)
        record = await _make_record(db_session, org, item)
        statements = []

        def capture(_conn, _cursor, statement, *_args):
            statements.append(statement)

        engine = db_session.bind.sync_engine
        event.listen(engine, "before_cursor_execute", capture)
        try:
            _, error = await InventoryService(db_session).update_maintenance_record(
                record.id, item.id, org.id, {"notes": "x"}
            )
        finally:
            event.remove(engine, "before_cursor_execute", capture)

        assert error is None
        assert any(
            "maintenance_records" in s and "FOR UPDATE" in s for s in statements
        ), statements

    async def test_a_second_completion_does_not_reapply_to_the_item(self, db_session):
        """The lock reads the committed is_completed, so an officer completing a
        record someone already closed does not rewrite the item's condition."""
        org = await _make_org(db_session)
        item = await _make_item(db_session, org)
        record = await _make_record(db_session, org, item)
        service = InventoryService(db_session)
        # The session holds the record as open; another writer completes it.
        await service.get_item_maintenance_history(item.id, org.id)
        await db_session.execute(
            MaintenanceRecord.__table__.update()
            .where(MaintenanceRecord.__table__.c.id == record.id)
            .values(
                is_completed=True,
                completed_date=date(2026, 10, 1),
                updated_at=datetime.now(timezone.utc),
            )
        )

        _, error = await service.update_maintenance_record(
            record.id,
            item.id,
            org.id,
            {"is_completed": True, "condition_after": ItemCondition.FAIR},
        )

        assert error is None
        await db_session.refresh(item)
        assert item.condition == ItemCondition.DAMAGED

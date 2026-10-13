"""
INV-17: "Complete work" closes an item's open maintenance record instead of
creating a second, completed one beside it.

The screen asks for the item's open records (``open_only``), picks the
earliest (or the one the officer chooses) and completes it through
``update_maintenance_record``. These pin the two backend halves that flow
relies on: the open-record listing, and a completion that updates the item
once under a row lock.

"Record inspection" does the same for a scheduled inspection (owner decision
2026-10-12), so the PATCH completion of an inspection must leave the item
exactly where creating a completed inspection does.
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


async def _make_coat(db, org):
    """An in-service item on an annual inspection interval."""
    item = InventoryItem(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Turnout Coat",
        active=True,
        status=ItemStatus.AVAILABLE,
        condition=ItemCondition.GOOD,
        inspection_interval_days=365,
        last_inspection_date=date(2025, 4, 1),
        next_inspection_due=date(2026, 4, 1),
    )
    db.add(item)
    await db.flush()
    return item


def _item_state(item):
    return (
        item.last_inspection_date,
        item.next_inspection_due,
        item.status,
        item.condition,
    )


class TestClosingAScheduledInspection:
    """INV-17 follow-on (owner decision 2026-10-12): "Record inspection" closes
    the item's open scheduled inspection through the PATCH path. The item must
    end up exactly where recording a new, completed inspection leaves it."""

    async def test_open_only_lists_open_inspections_for_the_screen_to_pick(
        self, db_session
    ):
        org = await _make_org(db_session)
        other = await _make_org(db_session)
        item = await _make_coat(db_session, org)
        inspection = await _make_record(
            db_session,
            org,
            item,
            maintenance_type=MaintenanceType.ROUTINE_INSPECTION,
            scheduled_date=date(2026, 4, 1),
        )
        repair = await _make_record(
            db_session, org, item, scheduled_date=date(2026, 5, 1)
        )
        await _make_record(
            db_session,
            org,
            item,
            maintenance_type=MaintenanceType.INSPECTION,
            is_completed=True,
            completed_date=date(2025, 4, 1),
            passed=True,
        )
        foreign_item = await _make_coat(db_session, other)
        await _make_record(
            db_session,
            other,
            foreign_item,
            maintenance_type=MaintenanceType.INSPECTION,
        )
        service = InventoryService(db_session)

        records = await service.get_item_maintenance_history(
            item.id, org.id, open_only=True
        )
        foreign = await service.get_item_maintenance_history(
            foreign_item.id, org.id, open_only=True
        )

        assert [r.id for r in records] == [inspection.id, repair.id]
        assert foreign == []

    @pytest.mark.parametrize("passed", [True, False])
    async def test_closing_moves_the_item_exactly_as_creating_does(
        self, db_session, passed
    ):
        org = await _make_org(db_session)
        created_item = await _make_coat(db_session, org)
        closed_item = await _make_coat(db_session, org)
        service = InventoryService(db_session)
        completed = date(2026, 3, 28)

        _, error = await service.create_maintenance_record(
            created_item.id,
            org.id,
            {
                "maintenance_type": "routine_inspection",
                "is_completed": True,
                "completed_date": completed,
                "passed": passed,
                "condition_after": ItemCondition.GOOD,
                "description": "Annual inspection",
            },
            None,
        )
        assert error is None
        scheduled = await _make_record(
            db_session,
            org,
            closed_item,
            maintenance_type=MaintenanceType.ROUTINE_INSPECTION,
            scheduled_date=date(2026, 4, 1),
            description="Annual NFPA 1851 inspection",
        )

        closed, error = await service.update_maintenance_record(
            scheduled.id,
            closed_item.id,
            org.id,
            {
                "is_completed": True,
                "completed_date": completed,
                "passed": passed,
                "condition_after": ItemCondition.GOOD,
                "notes": "Inspection findings: liner intact",
            },
        )

        assert error is None
        assert closed.is_completed is True
        assert closed.passed is passed
        assert closed.description == "Annual NFPA 1851 inspection"
        await db_session.refresh(created_item)
        await db_session.refresh(closed_item)
        assert _item_state(closed_item) == _item_state(created_item)
        assert closed_item.last_inspection_date == completed
        assert closed_item.next_inspection_due == date(2027, 3, 28)
        expected_status = ItemStatus.AVAILABLE if passed else ItemStatus.IN_MAINTENANCE
        assert closed_item.status == expected_status

    async def test_a_failed_inspection_takes_the_item_out_of_service(self, db_session):
        """The PATCH path never applied the create path's failed-inspection
        quarantine, so closing a scheduled inspection as failed would have left
        a coat that failed its NFPA 1851 inspection available to issue."""
        org = await _make_org(db_session)
        item = await _make_coat(db_session, org)
        scheduled = await _make_record(
            db_session,
            org,
            item,
            maintenance_type=MaintenanceType.INSPECTION,
            scheduled_date=date(2026, 4, 1),
        )

        _, error = await InventoryService(db_session).update_maintenance_record(
            scheduled.id,
            item.id,
            org.id,
            {
                "is_completed": True,
                "completed_date": date(2026, 3, 28),
                "passed": False,
            },
        )

        assert error is None
        await db_session.refresh(item)
        assert item.status == ItemStatus.IN_MAINTENANCE
        assert item.condition == ItemCondition.OUT_OF_SERVICE

    async def test_an_inspection_cannot_be_closed_without_a_result(self, db_session):
        org = await _make_org(db_session)
        item = await _make_coat(db_session, org)
        scheduled = await _make_record(
            db_session,
            org,
            item,
            maintenance_type=MaintenanceType.INSPECTION,
            scheduled_date=date(2026, 4, 1),
        )

        updated, error = await InventoryService(db_session).update_maintenance_record(
            scheduled.id,
            item.id,
            org.id,
            {"is_completed": True, "completed_date": date(2026, 3, 28)},
        )

        assert updated is None
        assert error == "A pass/fail result is required for inspections"
        await db_session.refresh(scheduled)
        await db_session.refresh(item)
        assert scheduled.is_completed is False
        assert item.last_inspection_date == date(2025, 4, 1)

    async def test_an_inspection_cannot_be_closed_without_a_date(self, db_session):
        org = await _make_org(db_session)
        item = await _make_coat(db_session, org)
        scheduled = await _make_record(
            db_session,
            org,
            item,
            maintenance_type=MaintenanceType.INSPECTION,
            scheduled_date=date(2026, 4, 1),
        )

        updated, error = await InventoryService(db_session).update_maintenance_record(
            scheduled.id, item.id, org.id, {"is_completed": True, "passed": True}
        )

        assert updated is None
        assert error == "Completion date is required for completed work"

"""
A temporary assignment can be chosen on assign and on distribute.

Before this, `ItemAssignmentCreate` accepted ``assignment_type`` but nothing
validated the return date that defines a temporary assignment, and
``distribute_items`` hardcoded ``AssignmentType.PERMANENT`` for every
individually tracked item it assigned. The schemas now require a future return
date for a temporary assignment (and refuse one on a permanent assignment), and
the distribute flow accepts a ``temporary_assignment`` operation that stores
both the type and the date.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.inventory import AssignmentType, ItemAssignment, ItemStatus
from app.schemas.inventory import BatchScanItem, ItemAssignmentCreate
from app.services.inventory_service import InventoryService


def _uid() -> str:
    return str(uuid.uuid4())


def _future(days: int = 7) -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=days)


@pytest.mark.unit
class TestAssignmentCreateValidation:
    def test_permanent_needs_no_date(self):
        body = ItemAssignmentCreate(item_id=uuid.uuid4(), user_id=uuid.uuid4())
        assert body.assignment_type == "permanent"
        assert body.expected_return_date is None

    def test_temporary_requires_a_return_date(self):
        with pytest.raises(ValidationError, match="expected_return_date is required"):
            ItemAssignmentCreate(
                item_id=uuid.uuid4(),
                user_id=uuid.uuid4(),
                assignment_type="temporary",
            )

    def test_temporary_return_date_must_be_in_the_future(self):
        with pytest.raises(ValidationError, match="must be in the future"):
            ItemAssignmentCreate(
                item_id=uuid.uuid4(),
                user_id=uuid.uuid4(),
                assignment_type="temporary",
                expected_return_date=datetime.now(timezone.utc) - timedelta(hours=1),
            )

    def test_temporary_with_future_date_is_accepted(self):
        due = _future()
        body = ItemAssignmentCreate(
            item_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            assignment_type="temporary",
            expected_return_date=due,
        )
        assert body.expected_return_date == due

    def test_permanent_refuses_a_return_date(self):
        with pytest.raises(ValidationError, match="only to a temporary assignment"):
            ItemAssignmentCreate(
                item_id=uuid.uuid4(),
                user_id=uuid.uuid4(),
                assignment_type="permanent",
                expected_return_date=_future(),
            )


@pytest.mark.unit
class TestBatchScanItemValidation:
    def test_temporary_assignment_requires_a_date(self):
        with pytest.raises(ValidationError, match="expected_return_at is required"):
            BatchScanItem(code="X", operation="temporary_assignment")

    def test_temporary_assignment_date_must_be_future(self):
        with pytest.raises(ValidationError, match="must be in the future"):
            BatchScanItem(
                code="X",
                operation="temporary_assignment",
                expected_return_at=datetime.now(timezone.utc) - timedelta(days=1),
            )

    def test_temporary_assignment_with_date_is_accepted(self):
        scan = BatchScanItem(
            code="X", operation="temporary_assignment", expected_return_at=_future()
        )
        assert scan.operation == "temporary_assignment"


@pytest.fixture
async def org_and_member(db_session: AsyncSession):
    org_id = _uid()
    user_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Temp Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"temp-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) VALUES (:id, :org, :un, 'Pat', 'Lee', "
            ":em, 'hashed', 'active')"
        ),
        {"id": user_id, "org": org_id, "un": f"pl{user_id[:6]}", "em": "pl@test.com"},
    )
    await db_session.flush()
    return org_id, user_id


async def _item(svc: InventoryService, org_id: str, user_id: str, barcode: str):
    item, err = await svc.create_item(
        organization_id=uuid.UUID(org_id),
        item_data={
            "name": f"SCBA {barcode}",
            "barcode": barcode,
            "condition": "good",
            "status": "available",
        },
        created_by=uuid.UUID(user_id),
    )
    assert err is None
    return item


@pytest.mark.integration
class TestDistributeTemporaryAssignment:
    async def test_temporary_assignment_stores_type_and_date(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        svc = InventoryService(db_session)
        item = await _item(svc, org_id, user_id, "TMP-1")
        due = _future(3)

        result = await svc.distribute_items(
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            performed_by=uuid.UUID(user_id),
            items=[
                {
                    "code": "TMP-1",
                    "operation": "temporary_assignment",
                    "expected_return_at": due,
                }
            ],
        )

        assert result["successful"] == 1
        assert result["results"][0]["action"] == "temporary_assignment"
        assignment = (
            await db_session.execute(
                select(ItemAssignment).where(ItemAssignment.item_id == item.id)
            )
        ).scalar_one()
        assert assignment.assignment_type == AssignmentType.TEMPORARY
        stored = assignment.expected_return_date
        if stored.tzinfo is None:
            stored = stored.replace(tzinfo=timezone.utc)
        assert abs((stored - due).total_seconds()) < 1
        refreshed = await svc.get_item_by_id(uuid.UUID(item.id), uuid.UUID(org_id))
        assert refreshed.status == ItemStatus.ASSIGNED

    async def test_permanent_assignment_stays_permanent_with_no_date(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        svc = InventoryService(db_session)
        item = await _item(svc, org_id, user_id, "PERM-1")

        result = await svc.distribute_items(
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            performed_by=uuid.UUID(user_id),
            # A stray date on a permanent row must not leak onto the record.
            items=[
                {
                    "code": "PERM-1",
                    "operation": "permanent_assignment",
                    "expected_return_at": _future(),
                }
            ],
        )

        assert result["successful"] == 1
        assert result["results"][0]["action"] == "permanent_assignment"
        assignment = (
            await db_session.execute(
                select(ItemAssignment).where(ItemAssignment.item_id == item.id)
            )
        ).scalar_one()
        assert assignment.assignment_type == AssignmentType.PERMANENT
        assert assignment.expected_return_date is None

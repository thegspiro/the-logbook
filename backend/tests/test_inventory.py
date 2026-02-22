"""
Integration tests for the inventory module.

Covers:
  - Category management (create, get, list)
  - Item CRUD (create, update, retire) with validation
  - Assignment (assign, unassign)
  - Pool issuance (issue, return)
  - Checkout / check-in
  - Batch checkout / return
  - Maintenance records + next_inspection_due
  - State validation (invalid combos rejected)
  - Retire pre-checks (can't retire assigned/checked-out)
  - Category requires_* enforcement
"""

import pytest
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.inventory_service import InventoryService
from app.models.inventory import (
    InventoryCategory,
    InventoryItem,
    ItemAssignment,
    CheckOutRecord,
    ItemIssuance,
    MaintenanceRecord,
    ItemType,
    ItemCondition,
    ItemStatus,
    TrackingType,
    AssignmentType,
)


# ── Helpers ──────────────────────────────────────────────────────────

def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def setup_org_and_user(db_session: AsyncSession):
    """Create a minimal organization and user for inventory tests."""
    org_id = _uid()
    user_id = _uid()
    user2_id = _uid()

    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, :otype, :slug, :tz)"
        ),
        {"id": org_id, "name": "Test Dept", "otype": "fire_department", "slug": f"test-{org_id[:8]}", "tz": "UTC"},
    )
    for uid, uname, fn, ln in [
        (user_id, "jsmith", "John", "Smith"),
        (user2_id, "jdoe", "Jane", "Doe"),
    ]:
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, last_name, email, "
                "password_hash, status) VALUES (:id, :org, :un, :fn, :ln, :em, :pw, 'active')"
            ),
            {
                "id": uid, "org": org_id, "un": uname,
                "fn": fn, "ln": ln,
                "em": f"{uname}@test.com", "pw": "hashed",
            },
        )
    await db_session.flush()
    return org_id, user_id, user2_id


# ── Category Tests ───────────────────────────────────────────────────

class TestCategoryManagement:

    @pytest.mark.asyncio
    async def test_create_and_list_categories(self, db_session, setup_org_and_user):
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        cat, err = await svc.create_category(
            organization_id=uuid.UUID(org_id),
            category_data={
                "name": "Bunker Gear",
                "item_type": "ppe",
                "requires_serial_number": True,
                "requires_maintenance": True,
            },
        )
        assert err is None
        assert cat is not None
        assert cat.name == "Bunker Gear"
        assert cat.requires_serial_number is True

        cats = await svc.get_categories(uuid.UUID(org_id))
        assert any(c.id == cat.id for c in cats)

    @pytest.mark.asyncio
    async def test_get_category_by_id(self, db_session, setup_org_and_user):
        org_id, _, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        cat, _ = await svc.create_category(
            organization_id=uuid.UUID(org_id),
            category_data={"name": "Radios", "item_type": "electronics"},
        )
        fetched = await svc.get_category_by_id(uuid.UUID(cat.id), uuid.UUID(org_id))
        assert fetched is not None
        assert fetched.name == "Radios"


# ── Item CRUD Tests ──────────────────────────────────────────────────

class TestItemCRUD:

    @pytest.mark.asyncio
    async def test_create_item(self, db_session, setup_org_and_user):
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        item, err = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={
                "name": "SCBA Unit #1",
                "serial_number": "SN-001",
                "condition": "excellent",
                "status": "available",
                "tracking_type": "individual",
                "quantity": 1,
            },
            created_by=uuid.UUID(user_id),
        )
        assert err is None
        assert item is not None
        assert item.name == "SCBA Unit #1"
        assert item.status == ItemStatus.AVAILABLE

    @pytest.mark.asyncio
    async def test_update_item(self, db_session, setup_org_and_user):
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        item, _ = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={"name": "Hose", "condition": "good", "status": "available"},
            created_by=uuid.UUID(user_id),
        )

        updated, err = await svc.update_item(
            item_id=uuid.UUID(item.id),
            organization_id=uuid.UUID(org_id),
            update_data={"name": "Attack Hose", "storage_location": "Bay 1"},
        )
        assert err is None
        assert updated.name == "Attack Hose"
        assert updated.storage_location == "Bay 1"

    @pytest.mark.asyncio
    async def test_retire_item(self, db_session, setup_org_and_user):
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        item, _ = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={"name": "Old Radio", "condition": "poor", "status": "available"},
            created_by=uuid.UUID(user_id),
        )

        success, err = await svc.retire_item(uuid.UUID(item.id), uuid.UUID(org_id), notes="End of life")
        assert success is True
        assert err is None

        refreshed = await svc.get_item_by_id(uuid.UUID(item.id), uuid.UUID(org_id))
        assert refreshed.status == ItemStatus.RETIRED
        assert refreshed.condition == ItemCondition.RETIRED
        assert refreshed.active is False


# ── State Validation Tests ───────────────────────────────────────────

class TestStateValidation:

    @pytest.mark.asyncio
    async def test_reject_invalid_status_condition_combo(self, db_session, setup_org_and_user):
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        # Can't create a RETIRED item with condition GOOD
        item, err = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={"name": "Bad Combo", "condition": "good", "status": "retired"},
            created_by=uuid.UUID(user_id),
        )
        assert item is None
        assert "condition" in err.lower() or "state" in err.lower()

    @pytest.mark.asyncio
    async def test_retire_blocked_when_assigned(self, db_session, setup_org_and_user):
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        item, _ = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={"name": "Assigned Helmet", "condition": "good", "status": "available"},
            created_by=uuid.UUID(user_id),
        )

        # Assign it
        await svc.assign_item_to_user(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            assigned_by=uuid.UUID(user_id),
        )

        # Should block retirement
        success, err = await svc.retire_item(uuid.UUID(item.id), uuid.UUID(org_id))
        assert success is False
        assert "assigned" in err.lower() or "unassign" in err.lower()

    @pytest.mark.asyncio
    async def test_retire_blocked_when_checked_out(self, db_session, setup_org_and_user):
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        item, _ = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={"name": "Checked Out Tool", "condition": "good", "status": "available"},
            created_by=uuid.UUID(user_id),
        )

        await svc.checkout_item(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            checked_out_by=uuid.UUID(user_id),
        )

        success, err = await svc.retire_item(uuid.UUID(item.id), uuid.UUID(org_id))
        assert success is False
        assert "checkout" in err.lower() or "check" in err.lower()


# ── Category Requires_* Enforcement ──────────────────────────────────

class TestCategoryRequirements:

    @pytest.mark.asyncio
    async def test_reject_item_without_required_serial(self, db_session, setup_org_and_user):
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        cat, _ = await svc.create_category(
            organization_id=uuid.UUID(org_id),
            category_data={"name": "SCBA", "item_type": "ppe", "requires_serial_number": True},
        )

        item, err = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={
                "name": "SCBA No Serial",
                "category_id": cat.id,
                "condition": "good",
                "status": "available",
            },
            created_by=uuid.UUID(user_id),
        )
        assert item is None
        assert "serial number" in err.lower()

    @pytest.mark.asyncio
    async def test_accept_item_with_required_serial(self, db_session, setup_org_and_user):
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        cat, _ = await svc.create_category(
            organization_id=uuid.UUID(org_id),
            category_data={"name": "SCBA2", "item_type": "ppe", "requires_serial_number": True},
        )

        item, err = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={
                "name": "SCBA With Serial",
                "category_id": cat.id,
                "serial_number": "SN-12345",
                "condition": "good",
                "status": "available",
            },
            created_by=uuid.UUID(user_id),
        )
        assert err is None
        assert item is not None


# ── Assignment Tests ─────────────────────────────────────────────────

class TestAssignment:

    @pytest.mark.asyncio
    async def test_assign_and_unassign(self, db_session, setup_org_and_user):
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        item, _ = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={"name": "Coat", "condition": "good", "status": "available"},
            created_by=uuid.UUID(user_id),
        )

        assignment, err = await svc.assign_item_to_user(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            assigned_by=uuid.UUID(user_id),
            reason="New member issue",
        )
        assert err is None
        assert assignment is not None

        # Item should now be ASSIGNED
        refreshed = await svc.get_item_by_id(uuid.UUID(item.id), uuid.UUID(org_id))
        assert refreshed.status == ItemStatus.ASSIGNED

        # Unassign
        success, err = await svc.unassign_item(
            item_id=uuid.UUID(item.id),
            organization_id=uuid.UUID(org_id),
            returned_by=uuid.UUID(user_id),
        )
        assert err is None

        refreshed = await svc.get_item_by_id(uuid.UUID(item.id), uuid.UUID(org_id))
        assert refreshed.status == ItemStatus.AVAILABLE

    @pytest.mark.asyncio
    async def test_cannot_assign_unavailable_item(self, db_session, setup_org_and_user):
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        item, _ = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={"name": "Broken Tool", "condition": "damaged", "status": "in_maintenance"},
            created_by=uuid.UUID(user_id),
        )

        _, err = await svc.assign_item_to_user(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            assigned_by=uuid.UUID(user_id),
        )
        assert err is not None
        assert "not available" in err.lower()


# ── Checkout / Check-in Tests ────────────────────────────────────────

class TestCheckoutCheckin:

    @pytest.mark.asyncio
    async def test_checkout_and_checkin(self, db_session, setup_org_and_user):
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        item, _ = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={"name": "Axe", "condition": "good", "status": "available"},
            created_by=uuid.UUID(user_id),
        )

        checkout, err = await svc.checkout_item(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            checked_out_by=uuid.UUID(user_id),
        )
        assert err is None
        assert checkout is not None

        # Item should be checked out
        refreshed = await svc.get_item_by_id(uuid.UUID(item.id), uuid.UUID(org_id))
        assert refreshed.status == ItemStatus.CHECKED_OUT

        # Check in
        success, err = await svc.checkin_item(
            checkout_id=uuid.UUID(checkout.id),
            organization_id=uuid.UUID(org_id),
            checked_in_by=uuid.UUID(user_id),
            return_condition=ItemCondition.GOOD,
        )
        assert err is None

        refreshed = await svc.get_item_by_id(uuid.UUID(item.id), uuid.UUID(org_id))
        assert refreshed.status == ItemStatus.AVAILABLE

    @pytest.mark.asyncio
    async def test_cannot_checkout_unavailable(self, db_session, setup_org_and_user):
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        item, _ = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={"name": "Assigned Item", "condition": "good", "status": "available"},
            created_by=uuid.UUID(user_id),
        )

        # Checkout first
        await svc.checkout_item(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            checked_out_by=uuid.UUID(user_id),
        )

        # Second checkout should fail
        _, err = await svc.checkout_item(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            checked_out_by=uuid.UUID(user_id),
        )
        assert err is not None
        assert "not available" in err.lower()


# ── Pool Issuance Tests ──────────────────────────────────────────────

class TestPoolIssuance:

    @pytest.mark.asyncio
    async def test_issue_and_return_pool(self, db_session, setup_org_and_user):
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        item, _ = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={
                "name": "Gloves",
                "condition": "good",
                "status": "available",
                "tracking_type": "pool",
                "quantity": 50,
                "unit_of_measure": "pair",
            },
            created_by=uuid.UUID(user_id),
        )

        issuance, err = await svc.issue_from_pool(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            issued_by=uuid.UUID(user_id),
            quantity=5,
            reason="Initial issue",
        )
        assert err is None
        assert issuance is not None
        assert issuance.quantity_issued == 5

        # Verify pool quantity updated
        refreshed = await svc.get_item_by_id(uuid.UUID(item.id), uuid.UUID(org_id))
        assert refreshed.quantity_issued == 5

        # Return
        success, err = await svc.return_to_pool(
            issuance_id=uuid.UUID(issuance.id),
            organization_id=uuid.UUID(org_id),
            returned_by=uuid.UUID(user_id),
        )
        assert err is None

    @pytest.mark.asyncio
    async def test_issue_exceeds_stock(self, db_session, setup_org_and_user):
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        item, _ = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={
                "name": "Limited Gloves",
                "condition": "good",
                "status": "available",
                "tracking_type": "pool",
                "quantity": 3,
            },
            created_by=uuid.UUID(user_id),
        )

        _, err = await svc.issue_from_pool(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            issued_by=uuid.UUID(user_id),
            quantity=10,
        )
        assert err is not None
        assert "insufficient" in err.lower() or "stock" in err.lower() or "available" in err.lower()


# ── Batch Operations ─────────────────────────────────────────────────

class TestBatchOperations:

    @pytest.mark.asyncio
    async def test_batch_checkout(self, db_session, setup_org_and_user):
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        items_data = []
        for i in range(3):
            item, _ = await svc.create_item(
                organization_id=uuid.UUID(org_id),
                item_data={
                    "name": f"Batch Item {i}",
                    "barcode": f"BC-{i:04d}",
                    "condition": "good",
                    "status": "available",
                },
                created_by=uuid.UUID(user_id),
            )
            items_data.append({"code": f"BC-{i:04d}", "quantity": 1})

        result = await svc.batch_checkout(
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            performed_by=uuid.UUID(user_id),
            items=items_data,
        )

        assert result["total_scanned"] == 3
        assert result["successful"] == 3
        assert result["failed"] == 0

    @pytest.mark.asyncio
    async def test_batch_checkout_partial_failure(self, db_session, setup_org_and_user):
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        item, _ = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={
                "name": "Real Item",
                "barcode": "BC-REAL",
                "condition": "good",
                "status": "available",
            },
            created_by=uuid.UUID(user_id),
        )

        result = await svc.batch_checkout(
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            performed_by=uuid.UUID(user_id),
            items=[
                {"code": "BC-REAL", "quantity": 1},
                {"code": "BC-NONEXISTENT", "quantity": 1},
            ],
        )

        assert result["total_scanned"] == 2
        assert result["successful"] == 1
        assert result["failed"] == 1


# ── Maintenance Tests ────────────────────────────────────────────────

class TestMaintenance:

    @pytest.mark.asyncio
    async def test_maintenance_sets_next_inspection(self, db_session, setup_org_and_user):
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        item, _ = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={
                "name": "Ladder",
                "condition": "good",
                "status": "available",
                "inspection_interval_days": 365,
            },
            created_by=uuid.UUID(user_id),
        )

        today = date.today()
        record, err = await svc.create_maintenance_record(
            item_id=uuid.UUID(item.id),
            organization_id=uuid.UUID(org_id),
            maintenance_data={
                "maintenance_type": "inspection",
                "is_completed": True,
                "completed_date": today.isoformat(),
                "condition_after": "good",
                "performed_by": user_id,
            },
        )
        assert err is None

        refreshed = await svc.get_item_by_id(uuid.UUID(item.id), uuid.UUID(org_id))
        assert refreshed.next_inspection_due is not None
        expected = today + timedelta(days=365)
        assert refreshed.next_inspection_due == expected


# ── Lookup Tests ─────────────────────────────────────────────────────

class TestLookup:

    @pytest.mark.asyncio
    async def test_lookup_by_barcode(self, db_session, setup_org_and_user):
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        item, _ = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={
                "name": "Radio",
                "barcode": "BC-RADIO-001",
                "condition": "good",
                "status": "available",
            },
            created_by=uuid.UUID(user_id),
        )

        result = await svc.lookup_by_code("BC-RADIO-001", uuid.UUID(org_id))
        assert result is not None
        found_item, matched_field, matched_value = result
        assert found_item.id == item.id
        assert matched_field == "barcode"

    @pytest.mark.asyncio
    async def test_lookup_not_found(self, db_session, setup_org_and_user):
        org_id, _, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        result = await svc.lookup_by_code("NONEXISTENT", uuid.UUID(org_id))
        assert result is None


# ── Members Inventory Summary Tests ──────────────────────────────────

class TestMembersInventorySummary:

    @pytest.mark.asyncio
    async def test_summary_counts(self, db_session, setup_org_and_user):
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        # Create and assign an item
        item, _ = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={"name": "Assigned Helmet", "condition": "good", "status": "available"},
            created_by=uuid.UUID(user_id),
        )
        await svc.assign_item_to_user(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            assigned_by=uuid.UUID(user_id),
        )

        members = await svc.get_members_inventory_summary(uuid.UUID(org_id))
        user_summary = next((m for m in members if m["user_id"] == user_id), None)
        assert user_summary is not None
        assert user_summary["permanent_count"] >= 1
        assert user_summary["total_items"] >= 1

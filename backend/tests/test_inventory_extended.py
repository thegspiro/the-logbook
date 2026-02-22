"""
Extended integration tests for the inventory module.

Covers previously untested areas:
  - Departure clearance lifecycle (initiate, resolve, complete)
  - Notification service netting logic
  - Batch return with invalid conditions
  - Category update
  - Pool item quantity validation
  - Barcode label generation
  - Batch checkout/return edge cases
"""

import pytest
import uuid
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch, MagicMock
from io import BytesIO

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.inventory_service import InventoryService
from app.services.departure_clearance_service import DepartureClearanceService
from app.services.inventory_notification_service import InventoryNotificationService
from app.models.inventory import (
    InventoryCategory,
    InventoryItem,
    ItemAssignment,
    CheckOutRecord,
    ItemIssuance,
    MaintenanceRecord,
    InventoryNotificationQueue,
    DepartureClearance,
    DepartureClearanceItem,
    ItemType,
    ItemCondition,
    ItemStatus,
    TrackingType,
    AssignmentType,
    ClearanceStatus,
    ClearanceLineDisposition,
    InventoryActionType,
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


# ── Departure Clearance Tests ──────────────────────────────────────

class TestDepartureClearance:

    @pytest.mark.asyncio
    async def test_initiate_clearance_with_assigned_item(self, db_session, setup_org_and_user):
        """Initiating clearance snapshots assigned items into line items."""
        org_id, user_id, _ = await setup_org_and_user
        inv_svc = InventoryService(db_session)

        # Create and assign an item
        item, _ = await inv_svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={"name": "Helmet", "condition": "good", "status": "available", "barcode": "BC-HELM-001"},
            created_by=uuid.UUID(user_id),
        )
        await inv_svc.assign_item_to_user(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            assigned_by=uuid.UUID(user_id),
        )

        # Initiate clearance
        clr_svc = DepartureClearanceService(db_session)
        clearance, err = await clr_svc.initiate_clearance(
            user_id=user_id,
            organization_id=org_id,
            initiated_by=user_id,
            departure_type="dropped_voluntary",
            return_deadline_days=14,
            notes="Member is leaving",
        )

        assert err is None
        assert clearance is not None
        assert clearance.status == ClearanceStatus.INITIATED
        assert clearance.total_items == 1
        assert clearance.items_outstanding == 1
        assert clearance.items_cleared == 0
        assert clearance.departure_type == "dropped_voluntary"

    @pytest.mark.asyncio
    async def test_initiate_clearance_no_items(self, db_session, setup_org_and_user):
        """Initiating clearance when member has no items creates empty clearance."""
        org_id, user_id, _ = await setup_org_and_user
        clr_svc = DepartureClearanceService(db_session)

        clearance, err = await clr_svc.initiate_clearance(
            user_id=user_id,
            organization_id=org_id,
            initiated_by=user_id,
        )

        assert err is None
        assert clearance is not None
        assert clearance.total_items == 0
        assert clearance.items_outstanding == 0

    @pytest.mark.asyncio
    async def test_cannot_initiate_duplicate_clearance(self, db_session, setup_org_and_user):
        """Cannot create a second open clearance for the same member."""
        org_id, user_id, _ = await setup_org_and_user
        clr_svc = DepartureClearanceService(db_session)

        _, err1 = await clr_svc.initiate_clearance(
            user_id=user_id, organization_id=org_id, initiated_by=user_id,
        )
        assert err1 is None

        _, err2 = await clr_svc.initiate_clearance(
            user_id=user_id, organization_id=org_id, initiated_by=user_id,
        )
        assert err2 is not None
        assert "already exists" in err2.lower()

    @pytest.mark.asyncio
    async def test_resolve_line_item_returned(self, db_session, setup_org_and_user):
        """Resolving a line item as 'returned' unassigns the item."""
        org_id, user_id, _ = await setup_org_and_user
        inv_svc = InventoryService(db_session)

        # Create, assign, initiate clearance
        item, _ = await inv_svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={"name": "Coat", "condition": "good", "status": "available"},
            created_by=uuid.UUID(user_id),
        )
        await inv_svc.assign_item_to_user(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            assigned_by=uuid.UUID(user_id),
        )

        clr_svc = DepartureClearanceService(db_session)
        clearance, _ = await clr_svc.initiate_clearance(
            user_id=user_id, organization_id=org_id, initiated_by=user_id,
        )

        # Get the clearance with line items
        full_clearance = await clr_svc.get_clearance(str(clearance.id), org_id)
        assert len(full_clearance.line_items) == 1
        line_item = full_clearance.line_items[0]

        # Resolve as returned
        resolved, err = await clr_svc.resolve_line_item(
            clearance_item_id=str(line_item.id),
            clearance_id=str(clearance.id),
            organization_id=org_id,
            resolved_by=user_id,
            disposition="returned",
            return_condition="good",
        )

        assert err is None
        assert resolved is not None
        assert resolved.disposition == ClearanceLineDisposition.RETURNED

        # Verify the item is now unassigned
        refreshed = await inv_svc.get_item_by_id(uuid.UUID(item.id), uuid.UUID(org_id))
        assert refreshed.status == ItemStatus.AVAILABLE
        assert refreshed.assigned_to_user_id is None

    @pytest.mark.asyncio
    async def test_resolve_line_item_written_off(self, db_session, setup_org_and_user):
        """Resolving a line item as 'written_off' does NOT change inventory."""
        org_id, user_id, _ = await setup_org_and_user
        inv_svc = InventoryService(db_session)

        item, _ = await inv_svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={"name": "Lost Radio", "condition": "good", "status": "available"},
            created_by=uuid.UUID(user_id),
        )
        await inv_svc.assign_item_to_user(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            assigned_by=uuid.UUID(user_id),
        )

        clr_svc = DepartureClearanceService(db_session)
        clearance, _ = await clr_svc.initiate_clearance(
            user_id=user_id, organization_id=org_id, initiated_by=user_id,
        )
        full_clearance = await clr_svc.get_clearance(str(clearance.id), org_id)
        line_item = full_clearance.line_items[0]

        resolved, err = await clr_svc.resolve_line_item(
            clearance_item_id=str(line_item.id),
            clearance_id=str(clearance.id),
            organization_id=org_id,
            resolved_by=user_id,
            disposition="written_off",
            resolution_notes="Item is lost",
        )

        assert err is None
        assert resolved.disposition == ClearanceLineDisposition.WRITTEN_OFF

        # Item should STILL be assigned (written_off doesn't unassign)
        refreshed = await inv_svc.get_item_by_id(uuid.UUID(item.id), uuid.UUID(org_id))
        assert refreshed.status == ItemStatus.ASSIGNED

    @pytest.mark.asyncio
    async def test_cannot_resolve_already_resolved_item(self, db_session, setup_org_and_user):
        """Cannot resolve a line item that's already resolved."""
        org_id, user_id, _ = await setup_org_and_user
        inv_svc = InventoryService(db_session)

        item, _ = await inv_svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={"name": "Pants", "condition": "good", "status": "available"},
            created_by=uuid.UUID(user_id),
        )
        await inv_svc.assign_item_to_user(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            assigned_by=uuid.UUID(user_id),
        )

        clr_svc = DepartureClearanceService(db_session)
        clearance, _ = await clr_svc.initiate_clearance(
            user_id=user_id, organization_id=org_id, initiated_by=user_id,
        )
        full_clearance = await clr_svc.get_clearance(str(clearance.id), org_id)
        line_item = full_clearance.line_items[0]

        # Resolve once
        await clr_svc.resolve_line_item(
            clearance_item_id=str(line_item.id),
            clearance_id=str(clearance.id),
            organization_id=org_id,
            resolved_by=user_id,
            disposition="waived",
        )

        # Try to resolve again
        _, err = await clr_svc.resolve_line_item(
            clearance_item_id=str(line_item.id),
            clearance_id=str(clearance.id),
            organization_id=org_id,
            resolved_by=user_id,
            disposition="returned",
        )
        assert err is not None
        assert "already resolved" in err.lower()

    @pytest.mark.asyncio
    async def test_complete_clearance_all_resolved(self, db_session, setup_org_and_user):
        """Completing clearance when all items are resolved sets status to COMPLETED."""
        org_id, user_id, _ = await setup_org_and_user
        inv_svc = InventoryService(db_session)

        item, _ = await inv_svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={"name": "Boots", "condition": "good", "status": "available"},
            created_by=uuid.UUID(user_id),
        )
        await inv_svc.assign_item_to_user(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            assigned_by=uuid.UUID(user_id),
        )

        clr_svc = DepartureClearanceService(db_session)
        clearance, _ = await clr_svc.initiate_clearance(
            user_id=user_id, organization_id=org_id, initiated_by=user_id,
        )
        full_clearance = await clr_svc.get_clearance(str(clearance.id), org_id)
        line_item = full_clearance.line_items[0]

        # Resolve the line item
        await clr_svc.resolve_line_item(
            clearance_item_id=str(line_item.id),
            clearance_id=str(clearance.id),
            organization_id=org_id,
            resolved_by=user_id,
            disposition="returned",
            return_condition="good",
        )

        # Complete the clearance
        completed, err = await clr_svc.complete_clearance(
            clearance_id=str(clearance.id),
            organization_id=org_id,
            completed_by=user_id,
            notes="All clear",
        )

        assert err is None
        assert completed.status == ClearanceStatus.COMPLETED
        assert completed.completed_at is not None

    @pytest.mark.asyncio
    async def test_complete_clearance_pending_items_blocked(self, db_session, setup_org_and_user):
        """Cannot complete clearance with pending items unless force_close=True."""
        org_id, user_id, _ = await setup_org_and_user
        inv_svc = InventoryService(db_session)

        item, _ = await inv_svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={"name": "Gloves", "condition": "good", "status": "available"},
            created_by=uuid.UUID(user_id),
        )
        await inv_svc.assign_item_to_user(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            assigned_by=uuid.UUID(user_id),
        )

        clr_svc = DepartureClearanceService(db_session)
        clearance, _ = await clr_svc.initiate_clearance(
            user_id=user_id, organization_id=org_id, initiated_by=user_id,
        )

        # Try to complete without resolving
        _, err = await clr_svc.complete_clearance(
            clearance_id=str(clearance.id),
            organization_id=org_id,
            completed_by=user_id,
        )
        assert err is not None
        assert "pending" in err.lower()

    @pytest.mark.asyncio
    async def test_force_close_with_pending_items(self, db_session, setup_org_and_user):
        """Force closing with pending items sets status to CLOSED_INCOMPLETE."""
        org_id, user_id, _ = await setup_org_and_user
        inv_svc = InventoryService(db_session)

        item, _ = await inv_svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={"name": "Radio", "condition": "good", "status": "available"},
            created_by=uuid.UUID(user_id),
        )
        await inv_svc.assign_item_to_user(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            assigned_by=uuid.UUID(user_id),
        )

        clr_svc = DepartureClearanceService(db_session)
        clearance, _ = await clr_svc.initiate_clearance(
            user_id=user_id, organization_id=org_id, initiated_by=user_id,
        )

        completed, err = await clr_svc.complete_clearance(
            clearance_id=str(clearance.id),
            organization_id=org_id,
            completed_by=user_id,
            force_close=True,
            notes="Force closing",
        )

        assert err is None
        assert completed.status == ClearanceStatus.CLOSED_INCOMPLETE

    @pytest.mark.asyncio
    async def test_cannot_complete_already_closed(self, db_session, setup_org_and_user):
        """Cannot complete a clearance that is already closed."""
        org_id, user_id, _ = await setup_org_and_user
        clr_svc = DepartureClearanceService(db_session)

        clearance, _ = await clr_svc.initiate_clearance(
            user_id=user_id, organization_id=org_id, initiated_by=user_id,
        )

        # Complete it (no items, so we can complete directly)
        await clr_svc.complete_clearance(
            clearance_id=str(clearance.id),
            organization_id=org_id,
            completed_by=user_id,
        )

        # Try again
        _, err = await clr_svc.complete_clearance(
            clearance_id=str(clearance.id),
            organization_id=org_id,
            completed_by=user_id,
        )
        assert err is not None
        assert "already" in err.lower()

    @pytest.mark.asyncio
    async def test_get_clearance_for_user(self, db_session, setup_org_and_user):
        """Can retrieve active clearance for a specific user."""
        org_id, user_id, _ = await setup_org_and_user
        clr_svc = DepartureClearanceService(db_session)

        await clr_svc.initiate_clearance(
            user_id=user_id, organization_id=org_id, initiated_by=user_id,
        )

        clearance = await clr_svc.get_clearance_for_user(user_id, org_id)
        assert clearance is not None
        assert clearance.user_id == user_id

    @pytest.mark.asyncio
    async def test_list_clearances(self, db_session, setup_org_and_user):
        """List clearances returns results with member names."""
        org_id, user_id, user2_id = await setup_org_and_user
        clr_svc = DepartureClearanceService(db_session)

        await clr_svc.initiate_clearance(
            user_id=user_id, organization_id=org_id, initiated_by=user_id,
        )
        await clr_svc.initiate_clearance(
            user_id=user2_id, organization_id=org_id, initiated_by=user_id,
        )

        summaries, total = await clr_svc.list_clearances(org_id)
        assert total == 2
        assert len(summaries) == 2
        names = {s["member_name"] for s in summaries}
        assert "John Smith" in names
        assert "Jane Doe" in names

    @pytest.mark.asyncio
    async def test_resolve_invalid_disposition(self, db_session, setup_org_and_user):
        """Resolving with invalid disposition returns error."""
        org_id, user_id, _ = await setup_org_and_user
        inv_svc = InventoryService(db_session)

        item, _ = await inv_svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={"name": "Tool", "condition": "good", "status": "available"},
            created_by=uuid.UUID(user_id),
        )
        await inv_svc.assign_item_to_user(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            assigned_by=uuid.UUID(user_id),
        )

        clr_svc = DepartureClearanceService(db_session)
        clearance, _ = await clr_svc.initiate_clearance(
            user_id=user_id, organization_id=org_id, initiated_by=user_id,
        )
        full_clearance = await clr_svc.get_clearance(str(clearance.id), org_id)
        line_item = full_clearance.line_items[0]

        _, err = await clr_svc.resolve_line_item(
            clearance_item_id=str(line_item.id),
            clearance_id=str(clearance.id),
            organization_id=org_id,
            resolved_by=user_id,
            disposition="invalid_value",
        )
        assert err is not None
        assert "invalid" in err.lower()

    @pytest.mark.asyncio
    async def test_resolve_disposition_pending_blocked(self, db_session, setup_org_and_user):
        """Cannot set disposition back to pending."""
        org_id, user_id, _ = await setup_org_and_user
        inv_svc = InventoryService(db_session)

        item, _ = await inv_svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={"name": "Light", "condition": "good", "status": "available"},
            created_by=uuid.UUID(user_id),
        )
        await inv_svc.assign_item_to_user(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            assigned_by=uuid.UUID(user_id),
        )

        clr_svc = DepartureClearanceService(db_session)
        clearance, _ = await clr_svc.initiate_clearance(
            user_id=user_id, organization_id=org_id, initiated_by=user_id,
        )
        full_clearance = await clr_svc.get_clearance(str(clearance.id), org_id)
        line_item = full_clearance.line_items[0]

        _, err = await clr_svc.resolve_line_item(
            clearance_item_id=str(line_item.id),
            clearance_id=str(clearance.id),
            organization_id=org_id,
            resolved_by=user_id,
            disposition="pending",
        )
        assert err is not None
        assert "pending" in err.lower()

    @pytest.mark.asyncio
    async def test_clearance_with_checkout_and_issuance(self, db_session, setup_org_and_user):
        """Clearance snapshots checkouts and pool issuances too."""
        org_id, user_id, _ = await setup_org_and_user
        inv_svc = InventoryService(db_session)

        # Create individual item and check it out
        item1, _ = await inv_svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={"name": "Axe", "condition": "good", "status": "available"},
            created_by=uuid.UUID(user_id),
        )
        await inv_svc.checkout_item(
            item_id=uuid.UUID(item1.id),
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            checked_out_by=uuid.UUID(user_id),
        )

        # Create pool item and issue some
        item2, _ = await inv_svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={
                "name": "T-Shirts", "condition": "good", "status": "available",
                "tracking_type": "pool", "quantity": 20,
            },
            created_by=uuid.UUID(user_id),
        )
        await inv_svc.issue_from_pool(
            item_id=uuid.UUID(item2.id),
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            issued_by=uuid.UUID(user_id),
            quantity=3,
        )

        clr_svc = DepartureClearanceService(db_session)
        clearance, err = await clr_svc.initiate_clearance(
            user_id=user_id, organization_id=org_id, initiated_by=user_id,
        )

        assert err is None
        assert clearance.total_items == 2  # 1 checkout + 1 issuance

        full = await clr_svc.get_clearance(str(clearance.id), org_id)
        source_types = {li.source_type for li in full.line_items}
        assert "checkout" in source_types
        assert "issuance" in source_types


# ── Notification Service Netting Tests ─────────────────────────────

class TestNotificationNetting:
    """Test the netting logic directly (unit-style, no DB needed)."""

    def _make_record(self, item_id, action_type, quantity=1, item_name="Item"):
        """Create a mock notification queue record."""
        mock = MagicMock()
        mock.item_id = item_id
        mock.item_name = item_name
        mock.item_serial_number = None
        mock.item_asset_tag = None
        mock.action_type = action_type
        mock.quantity = quantity
        return mock

    def test_assign_then_unassign_nets_to_zero(self):
        """ASSIGNED + UNASSIGNED for same item = no notification."""
        svc = InventoryNotificationService.__new__(InventoryNotificationService)
        records = [
            self._make_record("item-1", InventoryActionType.ASSIGNED),
            self._make_record("item-1", InventoryActionType.UNASSIGNED),
        ]
        result = svc._net_actions(records)
        assert len(result) == 0

    def test_issue_partial_return_nets_remainder(self):
        """ISSUED(5) + RETURNED(3) for same item = net ISSUED(2)."""
        svc = InventoryNotificationService.__new__(InventoryNotificationService)
        records = [
            self._make_record("item-1", InventoryActionType.ISSUED, quantity=5),
            self._make_record("item-1", InventoryActionType.RETURNED, quantity=3),
        ]
        result = svc._net_actions(records)
        assert len(result) == 1
        assert result[0]["action_type"] == InventoryActionType.ISSUED
        assert result[0]["quantity"] == 2

    def test_checkout_then_checkin_nets_to_zero(self):
        """CHECKED_OUT + CHECKED_IN for same item = no notification."""
        svc = InventoryNotificationService.__new__(InventoryNotificationService)
        records = [
            self._make_record("item-1", InventoryActionType.CHECKED_OUT),
            self._make_record("item-1", InventoryActionType.CHECKED_IN),
        ]
        result = svc._net_actions(records)
        assert len(result) == 0

    def test_different_items_dont_net(self):
        """Actions on different items don't cancel each other."""
        svc = InventoryNotificationService.__new__(InventoryNotificationService)
        records = [
            self._make_record("item-1", InventoryActionType.ASSIGNED, item_name="Helmet"),
            self._make_record("item-2", InventoryActionType.UNASSIGNED, item_name="Coat"),
        ]
        result = svc._net_actions(records)
        assert len(result) == 2

    def test_multiple_issues_accumulate(self):
        """Multiple issues to same item accumulate quantity."""
        svc = InventoryNotificationService.__new__(InventoryNotificationService)
        records = [
            self._make_record("item-1", InventoryActionType.ISSUED, quantity=3),
            self._make_record("item-1", InventoryActionType.ISSUED, quantity=2),
        ]
        result = svc._net_actions(records)
        assert len(result) == 1
        assert result[0]["quantity"] == 5


# ── Notification Service Email Rendering Tests ─────────────────────

class TestNotificationRendering:

    def test_build_item_list_html_empty(self):
        """Empty items list returns empty string."""
        svc = InventoryNotificationService.__new__(InventoryNotificationService)
        assert svc._build_item_list_html([], "Test") == ""

    def test_build_item_list_html_with_items(self):
        """HTML rendering includes item names and action labels."""
        svc = InventoryNotificationService.__new__(InventoryNotificationService)
        items = [{
            "item_name": "Helmet",
            "item_serial_number": "SN-001",
            "item_asset_tag": None,
            "action_type": InventoryActionType.ASSIGNED,
            "quantity": 1,
        }]
        html = svc._build_item_list_html(items, "Items Issued")
        assert "Helmet" in html
        assert "SN-001" in html
        assert "Permanently Assigned" in html
        assert "Items Issued" in html

    def test_build_item_list_html_quantity_display(self):
        """Quantity > 1 shows (xN) in output."""
        svc = InventoryNotificationService.__new__(InventoryNotificationService)
        items = [{
            "item_name": "Gloves",
            "item_serial_number": None,
            "item_asset_tag": None,
            "action_type": InventoryActionType.ISSUED,
            "quantity": 5,
        }]
        html = svc._build_item_list_html(items, "Items")
        assert "(x5)" in html

    def test_build_item_list_text_empty(self):
        """Empty items list returns empty string for text format."""
        svc = InventoryNotificationService.__new__(InventoryNotificationService)
        assert svc._build_item_list_text([], "Test") == ""

    def test_build_item_list_text_with_items(self):
        """Text rendering includes item names and action labels."""
        svc = InventoryNotificationService.__new__(InventoryNotificationService)
        items = [{
            "item_name": "Radio",
            "item_serial_number": None,
            "item_asset_tag": "AT-100",
            "action_type": InventoryActionType.CHECKED_OUT,
            "quantity": 1,
        }]
        text = svc._build_item_list_text(items, "Items Checked Out")
        assert "Radio" in text
        assert "AT-100" in text
        assert "Checked Out" in text


# ── Batch Return Edge Cases ────────────────────────────────────────

class TestBatchReturnEdgeCases:

    @pytest.mark.asyncio
    async def test_batch_return_invalid_condition_rejected(self, db_session, setup_org_and_user):
        """Batch return with invalid condition string is rejected (not silently defaulted)."""
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        # Create and assign item
        item, _ = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={"name": "Tool", "barcode": "BC-TOOL-001", "condition": "good", "status": "available"},
            created_by=uuid.UUID(user_id),
        )
        await svc.assign_item_to_user(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            assigned_by=uuid.UUID(user_id),
        )

        result = await svc.batch_return(
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            performed_by=uuid.UUID(user_id),
            items=[{"code": "BC-TOOL-001", "return_condition": "totally_invalid", "quantity": 1}],
        )

        assert result["failed"] == 1
        assert result["successful"] == 0
        assert "invalid" in result["results"][0]["error"].lower()

    @pytest.mark.asyncio
    async def test_batch_return_item_not_held_by_user(self, db_session, setup_org_and_user):
        """Batch return fails for items not held by the specified user."""
        org_id, user_id, user2_id = await setup_org_and_user
        svc = InventoryService(db_session)

        # Create item assigned to user2
        item, _ = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={"name": "Wrench", "barcode": "BC-WRENCH", "condition": "good", "status": "available"},
            created_by=uuid.UUID(user_id),
        )
        await svc.assign_item_to_user(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(user2_id),
            organization_id=uuid.UUID(org_id),
            assigned_by=uuid.UUID(user_id),
        )

        # Try to return as user_id (not user2_id)
        result = await svc.batch_return(
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            performed_by=uuid.UUID(user_id),
            items=[{"code": "BC-WRENCH", "return_condition": "good", "quantity": 1}],
        )

        assert result["failed"] == 1
        assert "not assigned" in result["results"][0]["error"].lower()


# ── Category Update Tests ──────────────────────────────────────────

class TestCategoryUpdate:

    @pytest.mark.asyncio
    async def test_update_category_name(self, db_session, setup_org_and_user):
        """Can update a category's name."""
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        cat, _ = await svc.create_category(
            organization_id=uuid.UUID(org_id),
            category_data={"name": "Old Name", "item_type": "equipment"},
        )

        updated, err = await svc.update_category(
            category_id=uuid.UUID(cat.id),
            organization_id=uuid.UUID(org_id),
            update_data={"name": "New Name"},
        )

        assert err is None
        assert updated.name == "New Name"

    @pytest.mark.asyncio
    async def test_update_category_not_found(self, db_session, setup_org_and_user):
        """Updating a non-existent category returns error."""
        org_id, _, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        _, err = await svc.update_category(
            category_id=uuid.uuid4(),
            organization_id=uuid.UUID(org_id),
            update_data={"name": "Whatever"},
        )
        assert err is not None
        assert "not found" in err.lower()

    @pytest.mark.asyncio
    async def test_update_category_flags(self, db_session, setup_org_and_user):
        """Can update category boolean flags."""
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        cat, _ = await svc.create_category(
            organization_id=uuid.UUID(org_id),
            category_data={
                "name": "Tools",
                "item_type": "tool",
                "requires_serial_number": False,
                "requires_maintenance": False,
            },
        )

        updated, err = await svc.update_category(
            category_id=uuid.UUID(cat.id),
            organization_id=uuid.UUID(org_id),
            update_data={
                "requires_serial_number": True,
                "requires_maintenance": True,
                "low_stock_threshold": 5,
            },
        )

        assert err is None
        assert updated.requires_serial_number is True
        assert updated.requires_maintenance is True
        assert updated.low_stock_threshold == 5


# ── Pool Item Quantity Validation ──────────────────────────────────

class TestPoolItemValidation:

    @pytest.mark.asyncio
    async def test_pool_item_quantity_zero_rejected(self, db_session, setup_org_and_user):
        """Pool items with quantity 0 should be rejected."""
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        item, err = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={
                "name": "Empty Pool",
                "condition": "good",
                "status": "available",
                "tracking_type": "pool",
                "quantity": 0,
            },
            created_by=uuid.UUID(user_id),
        )
        assert item is None
        assert err is not None
        assert "quantity" in err.lower()


# ── Barcode Label Generation Tests ─────────────────────────────────

class TestBarcodeLabels:

    @pytest.mark.asyncio
    async def test_generate_sheet_labels(self, db_session, setup_org_and_user):
        """Sheet label generation returns a valid BytesIO PDF."""
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        items = []
        for i in range(3):
            item, _ = await svc.create_item(
                organization_id=uuid.UUID(org_id),
                item_data={
                    "name": f"Label Item {i}",
                    "barcode": f"LBL-{i:04d}",
                    "condition": "good",
                    "status": "available",
                },
                created_by=uuid.UUID(user_id),
            )
            items.append(item)

        pdf_buf = await svc.generate_barcode_labels(
            item_ids=[uuid.UUID(i.id) for i in items],
            organization_id=uuid.UUID(org_id),
            label_format="letter",
        )

        assert isinstance(pdf_buf, BytesIO)
        content = pdf_buf.read()
        assert len(content) > 0
        assert content[:5] == b"%PDF-"

    @pytest.mark.asyncio
    async def test_generate_thermal_labels(self, db_session, setup_org_and_user):
        """Thermal label generation (dymo_30252) returns valid PDF."""
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        item, _ = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={
                "name": "Thermal Label Test",
                "barcode": "THM-0001",
                "asset_tag": "AT-001",
                "serial_number": "SN-THM-001",
                "condition": "good",
                "status": "available",
            },
            created_by=uuid.UUID(user_id),
        )

        pdf_buf = await svc.generate_barcode_labels(
            item_ids=[uuid.UUID(item.id)],
            organization_id=uuid.UUID(org_id),
            label_format="dymo_30252",
        )

        assert isinstance(pdf_buf, BytesIO)
        content = pdf_buf.read()
        assert len(content) > 0
        assert content[:5] == b"%PDF-"

    @pytest.mark.asyncio
    async def test_generate_custom_labels(self, db_session, setup_org_and_user):
        """Custom dimensions label generation works."""
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        item, _ = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={
                "name": "Custom Label Test",
                "barcode": "CST-0001",
                "condition": "good",
                "status": "available",
            },
            created_by=uuid.UUID(user_id),
        )

        pdf_buf = await svc.generate_barcode_labels(
            item_ids=[uuid.UUID(item.id)],
            organization_id=uuid.UUID(org_id),
            label_format="custom",
            custom_width=3.0,
            custom_height=2.0,
        )

        assert isinstance(pdf_buf, BytesIO)
        content = pdf_buf.read()
        assert content[:5] == b"%PDF-"

    @pytest.mark.asyncio
    async def test_generate_labels_no_items_raises(self, db_session, setup_org_and_user):
        """Label generation with no valid items raises ValueError."""
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        with pytest.raises(ValueError, match="No valid items"):
            await svc.generate_barcode_labels(
                item_ids=[uuid.uuid4()],  # Non-existent ID
                organization_id=uuid.UUID(org_id),
            )

    @pytest.mark.asyncio
    async def test_generate_labels_invalid_format_raises(self, db_session, setup_org_and_user):
        """Label generation with invalid format raises ValueError."""
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        item, _ = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={
                "name": "Format Test",
                "barcode": "FMT-0001",
                "condition": "good",
                "status": "available",
            },
            created_by=uuid.UUID(user_id),
        )

        with pytest.raises(ValueError, match="Unknown label format"):
            await svc.generate_barcode_labels(
                item_ids=[uuid.UUID(item.id)],
                organization_id=uuid.UUID(org_id),
                label_format="nonexistent_format",
            )

    @pytest.mark.asyncio
    async def test_generate_labels_custom_without_dimensions_raises(self, db_session, setup_org_and_user):
        """Custom format without dimensions raises ValueError."""
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        item, _ = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={
                "name": "No Dims Test",
                "barcode": "NODIM-0001",
                "condition": "good",
                "status": "available",
            },
            created_by=uuid.UUID(user_id),
        )

        with pytest.raises(ValueError, match="custom_width and custom_height"):
            await svc.generate_barcode_labels(
                item_ids=[uuid.UUID(item.id)],
                organization_id=uuid.UUID(org_id),
                label_format="custom",
            )

    @pytest.mark.asyncio
    async def test_label_fallback_to_asset_tag(self, db_session, setup_org_and_user):
        """Labels use asset_tag when barcode is not set."""
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        item, _ = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={
                "name": "No Barcode Item",
                "asset_tag": "AT-FALLBACK",
                "condition": "good",
                "status": "available",
            },
            created_by=uuid.UUID(user_id),
        )

        # Should not raise - should use asset_tag as barcode value
        pdf_buf = await svc.generate_barcode_labels(
            item_ids=[uuid.UUID(item.id)],
            organization_id=uuid.UUID(org_id),
        )
        assert isinstance(pdf_buf, BytesIO)

    @pytest.mark.asyncio
    async def test_generate_all_thermal_formats(self, db_session, setup_org_and_user):
        """All predefined thermal formats generate valid PDFs."""
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        item, _ = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={
                "name": "Multi Format Test",
                "barcode": "MF-0001",
                "condition": "good",
                "status": "available",
            },
            created_by=uuid.UUID(user_id),
        )

        for fmt in ["dymo_30252", "dymo_30256", "dymo_30334", "rollo_4x6"]:
            pdf_buf = await svc.generate_barcode_labels(
                item_ids=[uuid.UUID(item.id)],
                organization_id=uuid.UUID(org_id),
                label_format=fmt,
            )
            content = pdf_buf.read()
            assert content[:5] == b"%PDF-", f"Format {fmt} did not produce valid PDF"


# ── Additional Batch Checkout Tests ────────────────────────────────

class TestBatchCheckoutExtended:

    @pytest.mark.asyncio
    async def test_batch_checkout_pool_items(self, db_session, setup_org_and_user):
        """Batch checkout issues pool items correctly."""
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        item, _ = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={
                "name": "Pool Item",
                "barcode": "BC-POOL-001",
                "condition": "good",
                "status": "available",
                "tracking_type": "pool",
                "quantity": 50,
            },
            created_by=uuid.UUID(user_id),
        )

        result = await svc.batch_checkout(
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            performed_by=uuid.UUID(user_id),
            items=[{"code": "BC-POOL-001", "quantity": 5}],
        )

        assert result["successful"] == 1
        assert result["results"][0]["action"] == "issued"

        # Verify quantity changed
        refreshed = await svc.get_item_by_id(uuid.UUID(item.id), uuid.UUID(org_id))
        assert refreshed.quantity_issued == 5

    @pytest.mark.asyncio
    async def test_batch_checkout_unavailable_item(self, db_session, setup_org_and_user):
        """Batch checkout fails for items in maintenance."""
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        item, _ = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={
                "name": "Broken",
                "barcode": "BC-BROKEN",
                "condition": "damaged",
                "status": "in_maintenance",
            },
            created_by=uuid.UUID(user_id),
        )

        result = await svc.batch_checkout(
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            performed_by=uuid.UUID(user_id),
            items=[{"code": "BC-BROKEN", "quantity": 1}],
        )

        assert result["failed"] == 1
        assert "not available" in result["results"][0]["error"].lower()

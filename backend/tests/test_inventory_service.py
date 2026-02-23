"""
Inventory Service Unit Tests

Tests for InventoryService business logic using mocked database sessions.

Covers:
  - State-validation logic (_validate_item_state)
  - Category requirement enforcement (_validate_category_requirements)
  - Create item validation paths (state, category, serial, pool quantity)
  - Create / update / rename categories
  - Serial number uniqueness checks
  - Update item validation paths (not found, invalid state, negative pool qty)
  - Retire item precondition checks (assigned, checked-out, pool issuances)
  - Checkout / check-in item logic
  - Assign / unassign availability checks
  - Pool issuance stock validation
  - Status transition matrix
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4, UUID
from datetime import datetime, timezone

from app.services.inventory_service import InventoryService
from app.models.inventory import (
    ItemStatus,
    ItemCondition,
    TrackingType,
    AssignmentType,
)


# ============================================
# Fixtures
# ============================================

@pytest.fixture
def mock_db():
    """Create a mock async database session."""
    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    db.refresh = AsyncMock()
    db.execute = AsyncMock()
    return db


@pytest.fixture
def service(mock_db):
    """Create an InventoryService with a mocked db."""
    return InventoryService(mock_db)


@pytest.fixture
def org_id():
    return str(uuid4())


@pytest.fixture
def user_id():
    return str(uuid4())


# ============================================
# State Validation Tests
# ============================================

class TestValidateItemState:
    """Tests for _validate_item_state static method."""

    def test_valid_available_good(self):
        result = InventoryService._validate_item_state(
            ItemStatus.AVAILABLE, ItemCondition.GOOD
        )
        assert result is None

    def test_valid_assigned_excellent(self):
        result = InventoryService._validate_item_state(
            ItemStatus.ASSIGNED, ItemCondition.EXCELLENT, assigned_to_user_id="user-123"
        )
        assert result is None

    def test_retired_requires_retired_condition(self):
        result = InventoryService._validate_item_state(
            ItemStatus.RETIRED, ItemCondition.GOOD
        )
        assert result is not None
        assert "retired" in result.lower()

    def test_retired_with_retired_condition_is_valid(self):
        result = InventoryService._validate_item_state(
            ItemStatus.RETIRED, ItemCondition.RETIRED
        )
        assert result is None

    def test_assigned_requires_user(self):
        result = InventoryService._validate_item_state(
            ItemStatus.ASSIGNED, ItemCondition.GOOD, assigned_to_user_id=None
        )
        assert result is not None
        assert "assigned user" in result.lower() or "requires" in result.lower()

    def test_assigned_with_user_is_valid(self):
        result = InventoryService._validate_item_state(
            ItemStatus.ASSIGNED, ItemCondition.GOOD, assigned_to_user_id="user-123"
        )
        assert result is None

    def test_checked_out_any_condition(self):
        """Checked-out items accept any non-retired condition."""
        result = InventoryService._validate_item_state(
            ItemStatus.CHECKED_OUT, ItemCondition.FAIR
        )
        assert result is None

    def test_in_maintenance_any_condition(self):
        result = InventoryService._validate_item_state(
            ItemStatus.IN_MAINTENANCE, ItemCondition.DAMAGED
        )
        assert result is None

    def test_lost_any_condition(self):
        result = InventoryService._validate_item_state(
            ItemStatus.LOST, ItemCondition.POOR
        )
        assert result is None


# ============================================
# Category Requirement Validation Tests
# ============================================

class TestValidateCategoryRequirements:

    @pytest.mark.asyncio
    async def test_no_category_id_passes(self, service):
        """Items without a category skip validation."""
        result = await service._validate_category_requirements(
            {"name": "Test"}, "org-123"
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_category_not_found_passes(self, service):
        """If category doesn't exist, skip validation."""
        service.get_category_by_id = AsyncMock(return_value=None)
        result = await service._validate_category_requirements(
            {"name": "Test", "category_id": str(uuid4())}, "org-123"
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_requires_serial_number_fails_when_missing(self, service):
        """Category requiring serial number rejects items without one."""
        mock_category = MagicMock()
        mock_category.name = "Radios"
        mock_category.requires_serial_number = True
        mock_category.requires_maintenance = False
        service.get_category_by_id = AsyncMock(return_value=mock_category)

        result = await service._validate_category_requirements(
            {"name": "Test Radio", "category_id": str(uuid4())}, "org-123"
        )
        assert result is not None
        assert "serial number" in result.lower()

    @pytest.mark.asyncio
    async def test_requires_serial_number_passes_when_present(self, service):
        mock_category = MagicMock()
        mock_category.name = "Radios"
        mock_category.requires_serial_number = True
        mock_category.requires_maintenance = False
        service.get_category_by_id = AsyncMock(return_value=mock_category)

        result = await service._validate_category_requirements(
            {"name": "Test Radio", "category_id": str(uuid4()), "serial_number": "SN-001"}, "org-123"
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_requires_maintenance_fails_when_no_interval(self, service):
        mock_category = MagicMock()
        mock_category.name = "SCBA"
        mock_category.requires_serial_number = False
        mock_category.requires_maintenance = True
        service.get_category_by_id = AsyncMock(return_value=mock_category)

        result = await service._validate_category_requirements(
            {"name": "SCBA Tank", "category_id": str(uuid4())}, "org-123"
        )
        assert result is not None
        assert "inspection interval" in result.lower()

    @pytest.mark.asyncio
    async def test_requires_maintenance_passes_with_interval(self, service):
        mock_category = MagicMock()
        mock_category.name = "SCBA"
        mock_category.requires_serial_number = False
        mock_category.requires_maintenance = True
        service.get_category_by_id = AsyncMock(return_value=mock_category)

        result = await service._validate_category_requirements(
            {
                "name": "SCBA Tank",
                "category_id": str(uuid4()),
                "inspection_interval_days": 90,
            },
            "org-123",
        )
        assert result is None


# ============================================
# Create Item Tests
# ============================================

class TestCreateItem:

    @pytest.mark.asyncio
    async def test_create_item_success(self, service, mock_db, org_id, user_id):
        """Successfully creating a basic item."""
        service._validate_category_requirements = AsyncMock(return_value=None)
        service._check_serial_number_unique = AsyncMock(return_value=None)

        item, error = await service.create_item(
            organization_id=org_id,
            item_data={
                "name": "Halligan Bar",
                "status": "available",
                "condition": "good",
                "tracking_type": "individual",
            },
            created_by=user_id,
        )
        assert error is None
        mock_db.add.assert_called_once()
        mock_db.commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_create_pool_item_requires_quantity(self, service, org_id, user_id):
        """Pool items with quantity < 1 are rejected."""
        service._validate_category_requirements = AsyncMock(return_value=None)

        item, error = await service.create_item(
            organization_id=org_id,
            item_data={
                "name": "Gloves",
                "tracking_type": "pool",
                "quantity": 0,
                "status": "available",
                "condition": "good",
            },
            created_by=user_id,
        )
        assert error is not None
        assert "quantity" in error.lower()

    @pytest.mark.asyncio
    async def test_create_item_duplicate_serial_rejected(self, service, org_id, user_id):
        """Items with duplicate serial numbers within the org are rejected."""
        service._validate_category_requirements = AsyncMock(return_value=None)
        service._check_serial_number_unique = AsyncMock(
            return_value="Serial number 'SN-001' is already in use"
        )

        item, error = await service.create_item(
            organization_id=org_id,
            item_data={
                "name": "Radio",
                "serial_number": "SN-001",
                "status": "available",
                "condition": "good",
            },
            created_by=user_id,
        )
        assert error is not None
        assert "serial number" in error.lower()

    @pytest.mark.asyncio
    async def test_create_item_invalid_state_rejected(self, service, org_id, user_id):
        """Items with invalid status/condition combos are rejected."""
        service._validate_category_requirements = AsyncMock(return_value=None)
        service._check_serial_number_unique = AsyncMock(return_value=None)

        item, error = await service.create_item(
            organization_id=org_id,
            item_data={
                "name": "Broken Ladder",
                "status": "retired",
                "condition": "good",  # Invalid: retired requires retired condition
            },
            created_by=user_id,
        )
        assert error is not None
        assert "retired" in error.lower() or "invalid" in error.lower()

    @pytest.mark.asyncio
    async def test_create_item_category_validation_fails(self, service, org_id, user_id):
        """When category requirements fail, creation is rejected."""
        service._validate_category_requirements = AsyncMock(
            return_value="Category 'Radios' requires a serial number"
        )

        item, error = await service.create_item(
            organization_id=org_id,
            item_data={
                "name": "Radio",
                "category_id": str(uuid4()),
                "status": "available",
                "condition": "good",
            },
            created_by=user_id,
        )
        assert error is not None
        assert "serial number" in error.lower()

    @pytest.mark.asyncio
    async def test_create_item_db_exception_rolls_back(self, service, mock_db, org_id, user_id):
        """Database exceptions cause rollback and return error."""
        service._validate_category_requirements = AsyncMock(return_value=None)
        service._check_serial_number_unique = AsyncMock(return_value=None)
        mock_db.commit = AsyncMock(side_effect=Exception("DB connection lost"))

        item, error = await service.create_item(
            organization_id=org_id,
            item_data={
                "name": "Test Item",
                "status": "available",
                "condition": "good",
            },
            created_by=user_id,
        )
        assert error is not None
        assert "DB connection lost" in error
        mock_db.rollback.assert_called_once()


# ============================================
# Create Category Tests
# ============================================

class TestCreateCategory:

    @pytest.mark.asyncio
    async def test_create_category_success(self, service, mock_db, org_id, user_id):
        """Successfully creating a category."""
        category, error = await service.create_category(
            organization_id=org_id,
            category_data={
                "name": "PPE",
                "item_type": "ppe",
                "requires_serial_number": False,
                "requires_maintenance": True,
            },
            created_by=user_id,
        )
        assert error is None
        mock_db.add.assert_called_once()
        mock_db.commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_create_category_renames_metadata(self, service, mock_db, org_id, user_id):
        """Metadata key is renamed to extra_data to avoid SQLAlchemy conflict."""
        category, error = await service.create_category(
            organization_id=org_id,
            category_data={
                "name": "Tools",
                "item_type": "tool",
                "metadata": {"custom_field": "value"},
            },
            created_by=user_id,
        )
        assert error is None

    @pytest.mark.asyncio
    async def test_create_category_db_error(self, service, mock_db, org_id, user_id):
        """Database exception returns error and rolls back."""
        mock_db.commit = AsyncMock(side_effect=Exception("Unique constraint"))

        category, error = await service.create_category(
            organization_id=org_id,
            category_data={"name": "Duplicate", "item_type": "other"},
            created_by=user_id,
        )
        assert error is not None
        assert "Unique constraint" in error
        mock_db.rollback.assert_called_once()


# ============================================
# Update Category Tests
# ============================================

class TestUpdateCategory:

    @pytest.mark.asyncio
    async def test_update_category_not_found(self, service, org_id):
        """Updating a non-existent category returns error."""
        service.get_category_by_id = AsyncMock(return_value=None)

        category, error = await service.update_category(
            category_id=str(uuid4()),
            organization_id=org_id,
            update_data={"name": "Updated"},
        )
        assert category is None
        assert error == "Category not found"

    @pytest.mark.asyncio
    async def test_update_category_success(self, service, mock_db, org_id):
        """Successfully updating a category."""
        mock_category = MagicMock()
        mock_category.name = "Old Name"
        service.get_category_by_id = AsyncMock(return_value=mock_category)

        category, error = await service.update_category(
            category_id=str(uuid4()),
            organization_id=org_id,
            update_data={"name": "New Name"},
        )
        assert error is None
        assert mock_category.name == "New Name"


# ============================================
# Serial Number Uniqueness Tests
# ============================================

class TestSerialNumberUniqueness:

    @pytest.mark.asyncio
    async def test_empty_serial_number_passes(self, service):
        """Empty serial numbers bypass the uniqueness check."""
        result = await service._check_serial_number_unique("", "org-123")
        assert result is None

    @pytest.mark.asyncio
    async def test_unique_serial_passes(self, service, mock_db):
        """A unique serial number returns None (valid)."""
        mock_result = MagicMock()
        mock_result.scalar.return_value = 0
        mock_db.execute.return_value = mock_result

        result = await service._check_serial_number_unique("SN-UNIQUE", "org-123")
        assert result is None

    @pytest.mark.asyncio
    async def test_duplicate_serial_fails(self, service, mock_db):
        """A duplicate serial number returns an error string."""
        mock_result = MagicMock()
        mock_result.scalar.return_value = 1
        mock_db.execute.return_value = mock_result

        result = await service._check_serial_number_unique("SN-DUPE", "org-123")
        assert result is not None
        assert "already in use" in result.lower()


# ============================================
# Helper: mock InventoryItem
# ============================================

def _make_item(**overrides) -> MagicMock:
    """Build a MagicMock that mimics an InventoryItem with sensible defaults."""
    defaults = {
        "id": str(uuid4()),
        "organization_id": str(uuid4()),
        "name": "Test Item",
        "status": ItemStatus.AVAILABLE,
        "condition": ItemCondition.GOOD,
        "active": True,
        "tracking_type": TrackingType.INDIVIDUAL,
        "quantity": 1,
        "quantity_issued": 0,
        "assigned_to_user_id": None,
        "assigned_date": None,
        "serial_number": None,
        "inspection_interval_days": None,
        "storage_location": None,
        "status_notes": None,
        "category_id": None,
    }
    defaults.update(overrides)
    item = MagicMock()
    for k, v in defaults.items():
        setattr(item, k, v)
    return item


# ============================================
# Update Item Validation Tests
# ============================================

class TestUpdateItem:

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_update_item_not_found(self, service, mock_db):
        """update_item should return error when item does not exist."""
        service.get_item_by_id = AsyncMock(return_value=None)
        service._get_item_locked = AsyncMock(return_value=None)

        result, err = await service.update_item(
            item_id=uuid4(),
            organization_id=uuid4(),
            update_data={"name": "New Name"},
        )
        assert result is None
        assert "not found" in err.lower()

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_update_item_invalid_state_change(self, service, mock_db):
        """update_item should reject invalid status/condition combo."""
        item = _make_item(status=ItemStatus.AVAILABLE, condition=ItemCondition.GOOD)
        service.get_item_by_id = AsyncMock(return_value=item)
        service._get_item_locked = AsyncMock(return_value=item)

        result, err = await service.update_item(
            item_id=UUID(item.id),
            organization_id=UUID(item.organization_id),
            update_data={"status": "retired", "condition": "good"},
        )
        assert result is None
        assert err is not None

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_update_pool_item_negative_quantity(self, service, mock_db):
        """update_item should reject negative quantity for pool items."""
        item = _make_item(tracking_type=TrackingType.POOL, quantity=10)
        service._get_item_locked = AsyncMock(return_value=item)

        result, err = await service.update_item(
            item_id=UUID(item.id),
            organization_id=UUID(item.organization_id),
            update_data={"quantity": -5},
        )
        assert result is None
        assert "negative" in err.lower()

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_update_item_success(self, service, mock_db):
        """update_item should succeed with valid data."""
        item = _make_item()
        service.get_item_by_id = AsyncMock(return_value=item)

        result, err = await service.update_item(
            item_id=UUID(item.id),
            organization_id=UUID(item.organization_id),
            update_data={"name": "Updated Name", "storage_location": "Bay 2"},
        )
        assert err is None
        assert item.name == "Updated Name"
        assert item.storage_location == "Bay 2"
        mock_db.commit.assert_awaited_once()

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_update_item_duplicate_serial_rejected(self, service, mock_db):
        """update_item should reject changing to a duplicate serial number."""
        item = _make_item(serial_number="SN-OLD")
        service.get_item_by_id = AsyncMock(return_value=item)
        service._check_serial_number_unique = AsyncMock(
            return_value="Serial number 'SN-DUP' is already in use"
        )

        result, err = await service.update_item(
            item_id=UUID(item.id),
            organization_id=UUID(item.organization_id),
            update_data={"serial_number": "SN-DUP"},
        )
        assert result is None
        assert "already in use" in err.lower()


# ============================================
# Retire Item Tests
# ============================================

class TestRetireItem:

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_retire_item_not_found(self, service, mock_db):
        """retire_item should return error if item does not exist."""
        service.get_item_by_id = AsyncMock(return_value=None)

        success, err = await service.retire_item(uuid4(), uuid4())
        assert success is False
        assert "not found" in err.lower()

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_retire_item_blocked_when_assigned(self, service, mock_db):
        """retire_item should block if item is currently assigned to a user."""
        item = _make_item(assigned_to_user_id=str(uuid4()))
        service.get_item_by_id = AsyncMock(return_value=item)

        success, err = await service.retire_item(UUID(item.id), UUID(item.organization_id))
        assert success is False
        assert "assigned" in err.lower() or "unassign" in err.lower()

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_retire_item_blocked_when_checked_out(self, service, mock_db):
        """retire_item should block if item has active checkouts."""
        item = _make_item(assigned_to_user_id=None)
        service.get_item_by_id = AsyncMock(return_value=item)

        # db.execute returns count=1 for active checkouts
        mock_result = MagicMock()
        mock_result.scalar.return_value = 1
        mock_db.execute = AsyncMock(return_value=mock_result)

        success, err = await service.retire_item(UUID(item.id), UUID(item.organization_id))
        assert success is False
        assert "checkout" in err.lower() or "check" in err.lower()

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_retire_pool_item_blocked_with_unreturned_issuances(self, service, mock_db):
        """retire_item should block a POOL item that has unreturned issuances."""
        item = _make_item(assigned_to_user_id=None, tracking_type=TrackingType.POOL)
        service.get_item_by_id = AsyncMock(return_value=item)

        # First execute: active checkouts = 0; second: active issuances = 1
        co_result = MagicMock()
        co_result.scalar.return_value = 0
        iss_result = MagicMock()
        iss_result.scalar.return_value = 1
        mock_db.execute = AsyncMock(side_effect=[co_result, iss_result])

        success, err = await service.retire_item(UUID(item.id), UUID(item.organization_id))
        assert success is False
        assert "issuance" in err.lower() or "pool" in err.lower()

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_retire_item_success(self, service, mock_db):
        """retire_item should succeed and update status/condition/active."""
        item = _make_item(assigned_to_user_id=None, tracking_type=TrackingType.INDIVIDUAL)
        service.get_item_by_id = AsyncMock(return_value=item)

        # active checkouts count = 0
        mock_result = MagicMock()
        mock_result.scalar.return_value = 0
        mock_db.execute = AsyncMock(return_value=mock_result)

        with patch("app.core.audit.log_audit_event", new_callable=AsyncMock):
            success, err = await service.retire_item(
                UUID(item.id), UUID(item.organization_id), notes="End of life"
            )

        assert success is True
        assert err is None
        assert item.status == ItemStatus.RETIRED
        assert item.condition == ItemCondition.RETIRED
        assert item.active is False
        assert item.status_notes == "End of life"
        mock_db.commit.assert_awaited_once()

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_retire_item_db_exception_rolls_back(self, service, mock_db):
        """retire_item should rollback on database error."""
        item = _make_item(assigned_to_user_id=None)
        service.get_item_by_id = AsyncMock(return_value=item)

        # active checkouts count = 0
        mock_result = MagicMock()
        mock_result.scalar.return_value = 0
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.commit = AsyncMock(side_effect=Exception("DB error"))

        with patch("app.core.audit.log_audit_event", new_callable=AsyncMock):
            success, err = await service.retire_item(UUID(item.id), UUID(item.organization_id))

        assert success is False
        assert "DB error" in err
        mock_db.rollback.assert_awaited_once()


# ============================================
# Checkout Item Tests
# ============================================

class TestCheckoutItem:

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_checkout_item_not_found(self, service, mock_db):
        """checkout_item should return error if item does not exist."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute = AsyncMock(return_value=mock_result)

        checkout, err = await service.checkout_item(
            item_id=uuid4(), user_id=uuid4(),
            organization_id=uuid4(), checked_out_by=uuid4()
        )
        assert checkout is None
        assert "not found" in err.lower()

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_checkout_item_not_available(self, service, mock_db):
        """checkout_item should reject items that are not AVAILABLE."""
        item = _make_item(status=ItemStatus.CHECKED_OUT)
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = item
        mock_db.execute = AsyncMock(return_value=mock_result)

        checkout, err = await service.checkout_item(
            item_id=UUID(item.id), user_id=uuid4(),
            organization_id=UUID(item.organization_id), checked_out_by=uuid4()
        )
        assert checkout is None
        assert "not available" in err.lower()

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_checkout_item_success(self, service, mock_db):
        """checkout_item should succeed for an AVAILABLE item."""
        item = _make_item(status=ItemStatus.AVAILABLE, condition=ItemCondition.GOOD)
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = item
        mock_db.execute = AsyncMock(return_value=mock_result)

        with patch.object(service, "_queue_inventory_notification", new_callable=AsyncMock):
            checkout, err = await service.checkout_item(
                item_id=UUID(item.id), user_id=uuid4(),
                organization_id=UUID(item.organization_id), checked_out_by=uuid4()
            )
        assert err is None
        assert item.status == ItemStatus.CHECKED_OUT
        mock_db.add.assert_called_once()
        mock_db.commit.assert_awaited_once()

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_checkout_assigned_item_rejected(self, service, mock_db):
        """checkout_item should reject items with ASSIGNED status."""
        item = _make_item(status=ItemStatus.ASSIGNED)
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = item
        mock_db.execute = AsyncMock(return_value=mock_result)

        checkout, err = await service.checkout_item(
            item_id=UUID(item.id), user_id=uuid4(),
            organization_id=UUID(item.organization_id), checked_out_by=uuid4()
        )
        assert checkout is None
        assert "not available" in err.lower()

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_checkout_in_maintenance_rejected(self, service, mock_db):
        """checkout_item should reject items in IN_MAINTENANCE status."""
        item = _make_item(status=ItemStatus.IN_MAINTENANCE)
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = item
        mock_db.execute = AsyncMock(return_value=mock_result)

        checkout, err = await service.checkout_item(
            item_id=UUID(item.id), user_id=uuid4(),
            organization_id=UUID(item.organization_id), checked_out_by=uuid4()
        )
        assert checkout is None
        assert "not available" in err.lower()


# ============================================
# Check-in Item Tests
# ============================================

class TestCheckinItem:

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_checkin_record_not_found(self, service, mock_db):
        """checkin_item should return error if checkout record not found."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute = AsyncMock(return_value=mock_result)

        success, err = await service.checkin_item(
            checkout_id=uuid4(), organization_id=uuid4(),
            checked_in_by=uuid4(), return_condition=ItemCondition.GOOD
        )
        assert success is False
        assert "not found" in err.lower()

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_checkin_already_returned(self, service, mock_db):
        """checkin_item should reject if item was already checked in."""
        checkout_record = MagicMock()
        checkout_record.is_returned = True

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = checkout_record
        mock_db.execute = AsyncMock(return_value=mock_result)

        success, err = await service.checkin_item(
            checkout_id=uuid4(), organization_id=uuid4(),
            checked_in_by=uuid4(), return_condition=ItemCondition.GOOD
        )
        assert success is False
        assert "already" in err.lower()

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_checkin_success(self, service, mock_db):
        """checkin_item should update checkout record and item status."""
        checkout_record = MagicMock()
        checkout_record.is_returned = False
        checkout_record.item_id = str(uuid4())
        checkout_record.user_id = str(uuid4())

        item = _make_item(status=ItemStatus.CHECKED_OUT)

        # First execute returns checkout record, subsequent calls for item lock
        co_result = MagicMock()
        co_result.scalar_one_or_none.return_value = checkout_record

        service._get_item_locked = AsyncMock(return_value=item)
        mock_db.execute = AsyncMock(return_value=co_result)

        with patch.object(service, "_queue_inventory_notification", new_callable=AsyncMock):
            success, err = await service.checkin_item(
                checkout_id=uuid4(), organization_id=uuid4(),
                checked_in_by=uuid4(), return_condition=ItemCondition.GOOD
            )
        assert err is None
        assert item.status == ItemStatus.AVAILABLE
        assert item.condition == ItemCondition.GOOD
        assert checkout_record.is_returned is True


# ============================================
# Assign / Unassign Item Tests
# ============================================

class TestAssignItem:

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_assign_item_not_found(self, service, mock_db):
        """assign_item_to_user should return error if item does not exist."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute = AsyncMock(return_value=mock_result)

        assignment, err = await service.assign_item_to_user(
            item_id=uuid4(), user_id=uuid4(),
            organization_id=uuid4(), assigned_by=uuid4()
        )
        assert assignment is None
        assert "not found" in err.lower()

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_assign_item_not_available(self, service, mock_db):
        """assign_item_to_user should reject items not in AVAILABLE or ASSIGNED status."""
        item = _make_item(status=ItemStatus.IN_MAINTENANCE)
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = item
        mock_db.execute = AsyncMock(return_value=mock_result)

        assignment, err = await service.assign_item_to_user(
            item_id=UUID(item.id), user_id=uuid4(),
            organization_id=UUID(item.organization_id), assigned_by=uuid4()
        )
        assert assignment is None
        assert "not available" in err.lower()

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_assign_retired_item_rejected(self, service, mock_db):
        """Cannot assign a RETIRED item."""
        item = _make_item(status=ItemStatus.RETIRED, condition=ItemCondition.RETIRED)
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = item
        mock_db.execute = AsyncMock(return_value=mock_result)

        assignment, err = await service.assign_item_to_user(
            item_id=UUID(item.id), user_id=uuid4(),
            organization_id=UUID(item.organization_id), assigned_by=uuid4()
        )
        assert assignment is None
        assert "not available" in err.lower()

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_assign_checked_out_item_rejected(self, service, mock_db):
        """Cannot assign a CHECKED_OUT item."""
        item = _make_item(status=ItemStatus.CHECKED_OUT)
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = item
        mock_db.execute = AsyncMock(return_value=mock_result)

        assignment, err = await service.assign_item_to_user(
            item_id=UUID(item.id), user_id=uuid4(),
            organization_id=UUID(item.organization_id), assigned_by=uuid4()
        )
        assert assignment is None
        assert "not available" in err.lower()

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_assign_item_success(self, service, mock_db):
        """assign_item_to_user should succeed for an AVAILABLE item."""
        user_id = uuid4()
        item = _make_item(status=ItemStatus.AVAILABLE, assigned_to_user_id=None)
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = item
        mock_db.execute = AsyncMock(return_value=mock_result)

        with patch.object(service, "_queue_inventory_notification", new_callable=AsyncMock):
            assignment, err = await service.assign_item_to_user(
                item_id=UUID(item.id), user_id=user_id,
                organization_id=UUID(item.organization_id), assigned_by=uuid4(),
                reason="New member issue"
            )
        assert err is None
        assert item.status == ItemStatus.ASSIGNED
        assert item.assigned_to_user_id == user_id
        mock_db.add.assert_called_once()
        mock_db.commit.assert_awaited_once()

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_reassign_already_assigned_item(self, service, mock_db):
        """Assigning an ALREADY_ASSIGNED item to a different user should trigger unassign first."""
        old_user = uuid4()
        new_user = uuid4()
        item = _make_item(
            status=ItemStatus.ASSIGNED,
            assigned_to_user_id=str(old_user),
        )
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = item
        mock_db.execute = AsyncMock(return_value=mock_result)

        # Mock unassign_item to just pass
        service.unassign_item = AsyncMock(return_value=(True, None))

        with patch.object(service, "_queue_inventory_notification", new_callable=AsyncMock):
            assignment, err = await service.assign_item_to_user(
                item_id=UUID(item.id), user_id=new_user,
                organization_id=UUID(item.organization_id), assigned_by=uuid4()
            )
        assert err is None
        service.unassign_item.assert_awaited_once()


# ============================================
# Pool Issuance Validation Tests
# ============================================

class TestPoolIssuanceValidation:

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_create_pool_item_zero_quantity_rejected(self, service, mock_db, org_id, user_id):
        """Pool item with quantity=0 should be rejected."""
        service._validate_category_requirements = AsyncMock(return_value=None)

        item, err = await service.create_item(
            organization_id=org_id,
            item_data={
                "name": "Gloves",
                "tracking_type": "pool",
                "quantity": 0,
                "condition": "good",
                "status": "available",
            },
            created_by=user_id,
        )
        assert item is None
        assert "quantity" in err.lower()

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_create_pool_item_positive_quantity_accepted(self, service, mock_db, org_id, user_id):
        """Pool item with quantity >= 1 should be accepted."""
        service._validate_category_requirements = AsyncMock(return_value=None)
        service._check_serial_number_unique = AsyncMock(return_value=None)

        item, err = await service.create_item(
            organization_id=org_id,
            item_data={
                "name": "N95 Masks",
                "tracking_type": "pool",
                "quantity": 100,
                "condition": "good",
                "status": "available",
            },
            created_by=user_id,
        )
        assert err is None
        mock_db.add.assert_called_once()


# ============================================
# Status Transition Matrix Tests
# ============================================

class TestStatusTransitionMatrix:
    """Verify the full matrix of status/condition combinations."""

    @pytest.mark.unit
    def test_retired_only_accepts_retired_condition(self):
        """RETIRED status should only accept RETIRED condition."""
        for cond in ItemCondition:
            err = InventoryService._validate_item_state(ItemStatus.RETIRED, cond)
            if cond == ItemCondition.RETIRED:
                assert err is None, f"RETIRED + {cond} should be valid"
            else:
                assert err is not None, f"RETIRED + {cond} should be invalid"

    @pytest.mark.unit
    def test_non_retired_statuses_accept_standard_conditions(self):
        """Non-RETIRED statuses should accept any standard condition."""
        non_retired = [
            ItemStatus.AVAILABLE,
            ItemStatus.CHECKED_OUT,
            ItemStatus.IN_MAINTENANCE,
            ItemStatus.LOST,
            ItemStatus.STOLEN,
        ]
        standard = [
            ItemCondition.EXCELLENT,
            ItemCondition.GOOD,
            ItemCondition.FAIR,
            ItemCondition.POOR,
            ItemCondition.DAMAGED,
            ItemCondition.OUT_OF_SERVICE,
        ]
        for st in non_retired:
            for cond in standard:
                err = InventoryService._validate_item_state(st, cond)
                assert err is None, f"{st} + {cond} should be valid but got: {err}"

    @pytest.mark.unit
    def test_assigned_status_always_requires_user(self):
        """ASSIGNED status without user should always fail, regardless of condition."""
        for cond in [ItemCondition.EXCELLENT, ItemCondition.GOOD, ItemCondition.FAIR]:
            err = InventoryService._validate_item_state(
                ItemStatus.ASSIGNED, cond, assigned_to_user_id=None
            )
            assert err is not None
            assert "user" in err.lower() or "assigned" in err.lower()

    @pytest.mark.unit
    def test_assigned_status_with_user_passes(self):
        """ASSIGNED status with user should pass for standard conditions."""
        for cond in [ItemCondition.EXCELLENT, ItemCondition.GOOD, ItemCondition.FAIR]:
            err = InventoryService._validate_item_state(
                ItemStatus.ASSIGNED, cond, assigned_to_user_id=str(uuid4())
            )
            assert err is None

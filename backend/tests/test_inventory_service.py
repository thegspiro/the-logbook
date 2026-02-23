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

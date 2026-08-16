"""
Guided Inventory Setup — service unit tests

Covers the three calls behind the setup workflow:
  - get_setup_status: the counts, and the all-four rule behind is_complete
  - get_category_presets: the case-insensitive "already have it" flag
  - apply_category_presets: skip-don't-duplicate, unknown keys, rollback

DB-free: the mocked session returns canned counts and name rows, so these
assert the branching rather than the SQL.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.models.inventory import ItemType
from app.services.inventory_service import CATEGORY_PRESETS, InventoryService


@pytest.fixture
def mock_db():
    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    db.refresh = AsyncMock()
    db.scalar = AsyncMock()
    db.execute = AsyncMock()
    return db


@pytest.fixture
def service(mock_db):
    return InventoryService(mock_db)


@pytest.fixture
def org_id():
    return str(uuid4())


def _names_result(names):
    """A db.execute result whose .scalars().all() yields category names."""
    result = MagicMock()
    result.scalars.return_value.all.return_value = names
    return result


class TestSetupStatus:
    async def test_counts_are_reported_in_order(self, service, mock_db, org_id):
        mock_db.scalar.side_effect = [2, 5, 7, 41]

        status = await service.get_setup_status(org_id)

        assert status == {
            "rooms": 2,
            "storage_areas": 5,
            "categories": 7,
            "items": 41,
            "is_complete": True,
        }

    async def test_incomplete_when_any_step_is_empty(self, service, mock_db, org_id):
        mock_db.scalar.side_effect = [2, 5, 7, 0]

        status = await service.get_setup_status(org_id)

        assert status["items"] == 0
        assert status["is_complete"] is False

    async def test_null_counts_read_as_zero(self, service, mock_db, org_id):
        mock_db.scalar.side_effect = [None, None, None, None]

        status = await service.get_setup_status(org_id)

        assert status["rooms"] == 0
        assert status["is_complete"] is False


class TestCategoryPresets:
    async def test_every_preset_is_offered(self, service, mock_db, org_id):
        mock_db.execute.return_value = _names_result([])

        presets = await service.get_category_presets(org_id)

        assert len(presets) == len(CATEGORY_PRESETS)
        assert all(p["exists"] is False for p in presets)

    async def test_item_type_is_serialized_for_the_wire(self, service, mock_db, org_id):
        mock_db.execute.return_value = _names_result([])

        presets = await service.get_category_presets(org_id)

        turnout = next(p for p in presets if p["key"] == "turnout_gear")
        assert turnout["item_type"] == ItemType.PPE.value
        assert isinstance(turnout["item_type"], str)

    async def test_existing_name_flagged_regardless_of_case(
        self, service, mock_db, org_id
    ):
        mock_db.execute.return_value = _names_result(["  turnout GEAR "])

        presets = await service.get_category_presets(org_id)

        by_key = {p["key"]: p for p in presets}
        assert by_key["turnout_gear"]["exists"] is True
        assert by_key["radios"]["exists"] is False

    async def test_only_active_categories_count_as_taken(
        self, service, mock_db, org_id
    ):
        """A deactivated category must not mark its preset as already-added.

        `delete_category` deactivates rather than deleting, so matching every
        row would show the preset as done, hide it from the category list
        beside it, and leave no way to bring it back from here.
        """
        mock_db.execute.return_value = _names_result([])

        await service.get_category_presets(org_id)

        where = str(mock_db.execute.await_args.args[0])
        assert "active" in where


class TestApplyCategoryPresets:
    async def test_creates_the_requested_presets(self, service, mock_db, org_id):
        mock_db.execute.return_value = _names_result([])

        created, skipped, error = await service.apply_category_presets(
            org_id, ["turnout_gear", "radios"], uuid4()
        )

        assert error is None
        assert skipped == []
        assert [c.name for c in created] == ["Turnout Gear", "Radios & Pagers"]
        assert mock_db.add.call_count == 2
        mock_db.commit.assert_awaited_once()

    async def test_preset_settings_are_carried_onto_the_category(
        self, service, mock_db, org_id
    ):
        mock_db.execute.return_value = _names_result([])

        created, _, error = await service.apply_category_presets(
            org_id, ["turnout_gear"], uuid4()
        )

        assert error is None
        category = created[0]
        assert category.item_type == ItemType.PPE
        assert category.requires_serial_number is True
        assert category.requires_maintenance is True
        assert category.nfpa_tracking_enabled is True
        assert category.organization_id == org_id

    async def test_existing_name_is_skipped_not_duplicated(
        self, service, mock_db, org_id
    ):
        mock_db.execute.return_value = _names_result(["Turnout Gear"])

        created, skipped, error = await service.apply_category_presets(
            org_id, ["turnout_gear", "radios"], uuid4()
        )

        assert error is None
        assert skipped == ["Turnout Gear"]
        assert [c.name for c in created] == ["Radios & Pagers"]

    async def test_repeated_key_creates_one_category(self, service, mock_db, org_id):
        mock_db.execute.return_value = _names_result([])

        created, skipped, error = await service.apply_category_presets(
            org_id, ["radios", "radios"], uuid4()
        )

        assert error is None
        assert skipped == []
        assert len(created) == 1

    async def test_nothing_to_do_does_not_commit(self, service, mock_db, org_id):
        mock_db.execute.return_value = _names_result(["Radios & Pagers"])

        created, skipped, error = await service.apply_category_presets(
            org_id, ["radios"], uuid4()
        )

        assert error is None
        assert created == []
        assert skipped == ["Radios & Pagers"]
        mock_db.commit.assert_not_awaited()

    async def test_unknown_key_is_rejected_before_any_write(
        self, service, mock_db, org_id
    ):
        created, skipped, error = await service.apply_category_presets(
            org_id, ["turnout_gear", "not_a_preset"], uuid4()
        )

        assert created == []
        assert skipped == []
        assert error is not None
        assert "not_a_preset" in error
        mock_db.add.assert_not_called()
        mock_db.commit.assert_not_awaited()

    async def test_commit_failure_rolls_back_and_reports(
        self, service, mock_db, org_id
    ):
        mock_db.execute.return_value = _names_result([])
        mock_db.commit.side_effect = Exception("deadlock")

        created, skipped, error = await service.apply_category_presets(
            org_id, ["turnout_gear"], uuid4()
        )

        assert created == []
        assert error == "deadlock"
        mock_db.rollback.assert_awaited_once()


class TestPresetCatalog:
    def test_keys_and_names_are_unique(self):
        keys = [p["key"] for p in CATEGORY_PRESETS]
        names = [p["name"].lower() for p in CATEGORY_PRESETS]
        assert len(keys) == len(set(keys))
        assert len(names) == len(set(names))

    def test_every_preset_is_fully_specified(self):
        required = {
            "key",
            "name",
            "description",
            "item_type",
            "requires_assignment",
            "requires_serial_number",
            "requires_maintenance",
            "nfpa_tracking_enabled",
            "low_stock_threshold",
        }
        for preset in CATEGORY_PRESETS:
            assert required <= set(preset), preset.get("key")
            assert isinstance(preset["item_type"], ItemType)

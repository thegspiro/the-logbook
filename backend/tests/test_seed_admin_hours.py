"""
Tests for Admin Hours Seed Data

Validates the default category definitions, idempotent seeding logic,
and event-hour mapping creation.
"""

from unittest.mock import AsyncMock, MagicMock, patch

from app.core.seed_admin_hours import (
    DEFAULT_ADMIN_HOURS_CATEGORIES,
    DEFAULT_EVENT_HOUR_MAPPINGS,
    seed_admin_hours_categories,
    seed_admin_hours_data,
    seed_event_hour_mappings,
)


# ============================================
# Default Category Definitions
# ============================================


class TestDefaultCategories:
    """Validate the static category definitions."""

    def test_has_categories(self):
        assert len(DEFAULT_ADMIN_HOURS_CATEGORIES) >= 6

    def test_required_keys_present(self):
        required = {
            "name", "description", "color", "require_approval",
            "auto_approve_under_hours", "max_hours_per_session", "sort_order",
        }
        for cat in DEFAULT_ADMIN_HOURS_CATEGORIES:
            missing = required - cat.keys()
            assert not missing, (
                f"Category '{cat['name']}' missing keys: {missing}"
            )

    def test_names_unique(self):
        names = [c["name"] for c in DEFAULT_ADMIN_HOURS_CATEGORIES]
        assert len(names) == len(set(names))

    def test_sort_orders_unique(self):
        orders = [c["sort_order"] for c in DEFAULT_ADMIN_HOURS_CATEGORIES]
        assert len(orders) == len(set(orders))

    def test_colors_are_hex(self):
        for cat in DEFAULT_ADMIN_HOURS_CATEGORIES:
            color = cat["color"]
            assert color.startswith("#"), f"Color '{color}' should start with #"
            assert len(color) == 7, f"Color '{color}' should be 7 chars"

    def test_expected_categories_present(self):
        names = {c["name"] for c in DEFAULT_ADMIN_HOURS_CATEGORIES}
        expected = {
            "Community Outreach",
            "Fundraising",
            "Administrative Work",
            "Station Maintenance",
            "Meetings & Governance",
            "Volunteer Hours",
        }
        assert expected.issubset(names)

    def test_max_hours_positive(self):
        for cat in DEFAULT_ADMIN_HOURS_CATEGORIES:
            assert cat["max_hours_per_session"] > 0

    def test_auto_approve_positive_or_none(self):
        for cat in DEFAULT_ADMIN_HOURS_CATEGORIES:
            val = cat["auto_approve_under_hours"]
            assert val is None or val > 0


# ============================================
# Default Event-Hour Mappings
# ============================================


class TestDefaultEventMappings:
    """Validate the static event mapping definitions."""

    def test_has_mappings(self):
        assert len(DEFAULT_EVENT_HOUR_MAPPINGS) >= 3

    def test_required_keys(self):
        for m in DEFAULT_EVENT_HOUR_MAPPINGS:
            assert "event_type" in m
            assert "category_name" in m

    def test_category_names_reference_valid_categories(self):
        valid_names = {c["name"] for c in DEFAULT_ADMIN_HOURS_CATEGORIES}
        for m in DEFAULT_EVENT_HOUR_MAPPINGS:
            assert m["category_name"] in valid_names, (
                f"Mapping references unknown category: {m['category_name']}"
            )

    def test_expected_event_types(self):
        types = {m["event_type"] for m in DEFAULT_EVENT_HOUR_MAPPINGS}
        assert "public_education" in types
        assert "fundraiser" in types
        assert "business_meeting" in types


# ============================================
# seed_admin_hours_categories
# ============================================


class TestSeedCategories:
    """Test the category seeding function."""

    async def test_creates_categories_when_none_exist(self):
        mock_db = AsyncMock()

        # Every select returns no existing category
        no_result = MagicMock()
        no_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = no_result

        result = await seed_admin_hours_categories(
            mock_db, "org-1", "user-1"
        )

        assert len(result) == len(DEFAULT_ADMIN_HOURS_CATEGORIES)
        for cat in DEFAULT_ADMIN_HOURS_CATEGORIES:
            assert cat["name"] in result

        # Should have called db.add for each new category
        assert mock_db.add.call_count == len(DEFAULT_ADMIN_HOURS_CATEGORIES)
        mock_db.flush.assert_called_once()

    async def test_skips_existing_categories(self):
        mock_db = AsyncMock()

        existing_cat = MagicMock()
        existing_cat.id = "existing-cat-id"
        existing_cat.name = "Community Outreach"

        # Every select returns an existing category
        existing_result = MagicMock()
        existing_result.scalar_one_or_none.return_value = existing_cat
        mock_db.execute.return_value = existing_result

        result = await seed_admin_hours_categories(
            mock_db, "org-1", "user-1"
        )

        # All map to the existing id
        for cat_name in result:
            assert result[cat_name] == "existing-cat-id"

        # No new categories created
        mock_db.add.assert_not_called()


# ============================================
# seed_event_hour_mappings
# ============================================


class TestSeedEventMappings:
    """Test the event-hour mapping seeding function."""

    async def test_creates_mappings_for_known_categories(self):
        mock_db = AsyncMock()
        no_result = MagicMock()
        no_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = no_result

        category_map = {
            "Community Outreach": "cat-1",
            "Fundraising": "cat-2",
            "Meetings & Governance": "cat-3",
        }

        created = await seed_event_hour_mappings(
            mock_db, "org-1", category_map, "user-1"
        )

        assert created == 3
        assert mock_db.add.call_count == 3

    async def test_skips_existing_mappings(self):
        mock_db = AsyncMock()
        existing = MagicMock()
        existing_result = MagicMock()
        existing_result.scalar_one_or_none.return_value = existing
        mock_db.execute.return_value = existing_result

        category_map = {
            "Community Outreach": "cat-1",
            "Fundraising": "cat-2",
            "Meetings & Governance": "cat-3",
        }

        created = await seed_event_hour_mappings(
            mock_db, "org-1", category_map, "user-1"
        )

        assert created == 0
        mock_db.add.assert_not_called()

    async def test_skips_missing_categories(self):
        mock_db = AsyncMock()
        no_result = MagicMock()
        no_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = no_result

        # Only one of the expected categories exists
        category_map = {"Community Outreach": "cat-1"}

        created = await seed_event_hour_mappings(
            mock_db, "org-1", category_map, "user-1"
        )

        assert created == 1


# ============================================
# seed_admin_hours_data (top-level)
# ============================================


class TestSeedAdminHoursData:
    """Test the top-level orchestration function."""

    @patch("app.core.seed_admin_hours.seed_event_hour_mappings", new_callable=AsyncMock)
    @patch("app.core.seed_admin_hours.seed_admin_hours_categories", new_callable=AsyncMock)
    async def test_calls_both_seeders(self, mock_cats, mock_mappings):
        mock_db = AsyncMock()
        mock_cats.return_value = {"Cat A": "id-1", "Cat B": "id-2"}
        mock_mappings.return_value = 2

        result = await seed_admin_hours_data(mock_db, "org-1", "user-1")

        mock_cats.assert_called_once_with(mock_db, "org-1", "user-1")
        mock_mappings.assert_called_once_with(
            mock_db, "org-1", {"Cat A": "id-1", "Cat B": "id-2"}, "user-1"
        )
        assert result["categories_count"] == 2
        assert result["mappings_created"] == 2
        assert result["category_names"] == ["Cat A", "Cat B"]

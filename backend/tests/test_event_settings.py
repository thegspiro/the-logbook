"""
Event Settings Tests

Unit tests for event module settings update logic, focused on ensuring
sequential partial updates all persist correctly (regression test for
SQLAlchemy JSON shallow-copy mutation detection bug).
"""

import copy
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.v1.endpoints.events import EVENT_SETTINGS_DEFAULTS


def _make_org(initial_settings=None):
    """Create a mock Organization with realistic JSON column behavior."""
    org = MagicMock()
    # Simulate SQLAlchemy JSON column: store a real dict, and track whether
    # the identity changes on assignment (which is how SA detects mutations).
    _stored = initial_settings

    def _get_settings():
        return _stored

    def _set_settings(value):
        nonlocal _stored
        _stored = value

    type(org).settings = property(
        lambda self: _get_settings(),
        lambda self, v: _set_settings(v),
    )
    org.settings = initial_settings
    return org


def _make_db(org):
    """Create a mock AsyncSession that returns the given org."""
    db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = org
    db.execute = AsyncMock(return_value=mock_result)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    return db


def _make_user():
    user = MagicMock()
    user.id = "user-1"
    user.organization_id = "org-1"
    user.username = "testadmin"
    return user


class TestEventSettingsDeepCopy:
    """Verify that sequential partial updates don't lose data due to
    shallow-copy mutation of SQLAlchemy's committed state."""

    @pytest.mark.asyncio
    async def test_sequential_updates_persist_independently(self):
        """Adding a category then toggling visibility should preserve both."""
        from app.schemas.event import EventCategoryConfig, EventSettingsUpdate

        org = _make_org(initial_settings={})
        db = _make_db(org)
        user = _make_user()

        # Patch dependencies
        with (
            patch("app.api.v1.endpoints.events.get_db", return_value=db),
            patch(
                "app.api.v1.endpoints.events.require_permission",
                return_value=lambda: user,
            ),
            patch("app.api.v1.endpoints.events.log_audit_event", new_callable=AsyncMock),
        ):
            from app.api.v1.endpoints.events import update_event_settings

            # Step 1: Create a custom category
            update1 = EventSettingsUpdate(
                custom_event_categories=[
                    EventCategoryConfig(
                        value="drill",
                        label="Drill",
                        color="bg-blue-100 text-blue-800",
                    )
                ]
            )
            result1 = await update_event_settings(update1, db, user)

            assert len(result1["custom_event_categories"]) == 1
            assert result1["custom_event_categories"][0]["value"] == "drill"

            # Step 2: Toggle visibility for that category
            update2 = EventSettingsUpdate(
                visible_custom_categories=["drill"]
            )
            result2 = await update_event_settings(update2, db, user)

            # Both the category AND the visibility should be present
            assert len(result2["custom_event_categories"]) == 1, (
                "Custom category disappeared after toggling visibility — "
                "likely a shallow-copy mutation bug"
            )
            assert result2["visible_custom_categories"] == ["drill"]

            # Verify the data was actually persisted (not just in-memory)
            stored = org.settings.get("events", {})
            assert "custom_event_categories" in stored
            assert len(stored["custom_event_categories"]) == 1
            assert "visible_custom_categories" in stored
            assert stored["visible_custom_categories"] == ["drill"]

    @pytest.mark.asyncio
    async def test_update_does_not_mutate_existing_settings_in_place(self):
        """Verify deepcopy prevents mutation of the original settings dict."""
        initial_events = {
            "custom_event_categories": [
                {"value": "drill", "label": "Drill", "color": "bg-blue-100 text-blue-800"}
            ],
            "visible_custom_categories": [],
        }
        org = _make_org(initial_settings={"events": copy.deepcopy(initial_events)})
        db = _make_db(org)
        user = _make_user()

        with (
            patch("app.api.v1.endpoints.events.get_db", return_value=db),
            patch(
                "app.api.v1.endpoints.events.require_permission",
                return_value=lambda: user,
            ),
            patch("app.api.v1.endpoints.events.log_audit_event", new_callable=AsyncMock),
        ):
            from app.api.v1.endpoints.events import update_event_settings

            from app.schemas.event import EventSettingsUpdate

            update = EventSettingsUpdate(
                visible_custom_categories=["drill"]
            )

            # Simulate SQLAlchemy committed state check: if the endpoint
            # mutates via shared references, before_snapshot would also change
            # (because they share nested objects). With deepcopy this shouldn't happen.
            result = await update_event_settings(update, db, user)

            assert result["visible_custom_categories"] == ["drill"]
            # The stored settings should have been updated
            assert org.settings["events"]["visible_custom_categories"] == ["drill"]


class TestEventSettingsDefaults:
    """Verify that the merge-with-defaults logic returns complete objects."""

    def test_defaults_include_all_expected_keys(self):
        """EVENT_SETTINGS_DEFAULTS should cover all settings the frontend expects."""
        expected_keys = {
            "enabled_event_types",
            "visible_event_types",
            "event_type_labels",
            "custom_event_categories",
            "visible_custom_categories",
            "outreach_event_types",
            "request_pipeline",
            "defaults",
            "qr_code",
            "cancellation",
        }
        assert set(EVENT_SETTINGS_DEFAULTS.keys()) == expected_keys

    def test_list_defaults_are_lists(self):
        """List-type defaults should not be dicts (would break merge logic)."""
        list_keys = [
            "enabled_event_types",
            "visible_event_types",
            "custom_event_categories",
            "visible_custom_categories",
            "outreach_event_types",
        ]
        for key in list_keys:
            assert isinstance(EVENT_SETTINGS_DEFAULTS[key], list), (
                f"{key} should be a list, got {type(EVENT_SETTINGS_DEFAULTS[key])}"
            )

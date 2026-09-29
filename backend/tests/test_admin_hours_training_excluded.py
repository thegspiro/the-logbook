"""Training events do not credit admin hours.

A Training event's attendance is credited to the members' training records
when it is finalized. Crediting admin hours too counted the same hours twice
wherever the two ledgers are added together. ``EVENT_TYPES_WITHOUT_ADMIN_HOURS``
names the types, and every reader of an event-hour mapping honours it: the
crediting path, the event card's estimate, and the mapping settings (which
refuse new ones and label stored ones "not in effect" — CLAUDE.md pitfall #19).
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.seed_admin_hours import DEFAULT_EVENT_HOUR_MAPPINGS
from app.models.admin_hours import (
    EVENT_TYPES_WITHOUT_ADMIN_HOURS,
    AdminHoursEntryMethod,
)
from app.services.admin_hours_service import AdminHoursService, mapping_effect

pytestmark = pytest.mark.unit


def _all(items):
    result = MagicMock()
    result.scalars.return_value.all.return_value = items
    return result


def _one(value):
    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    return result


def _service(*results):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=list(results))
    db.delete = AsyncMock()
    return AdminHoursService(db), db


class TestTheWiredSet:
    def test_only_training_is_excluded(self):
        """Adding a type here takes its attendance out of admin hours for every
        department; it must be a visible, deliberate change."""
        assert EVENT_TYPES_WITHOUT_ADMIN_HOURS == frozenset({"training"})

    def test_no_default_mapping_names_an_excluded_type(self):
        seeded = {m["event_type"] for m in DEFAULT_EVENT_HOUR_MAPPINGS}
        assert not seeded & EVENT_TYPES_WITHOUT_ADMIN_HOURS


class TestCrediting:
    async def test_training_attendance_credits_nothing_even_when_mapped(self):
        svc, db = _service()
        svc.get_mappings_for_event = AsyncMock(return_value=[("cat-1", 100, None)])

        count = await svc.credit_event_attendance(
            organization_id="org-1",
            user_id="user-1",
            event_id="event-1",
            rsvp_id="rsvp-1",
            event_title="Hose Ops",
            check_in_at=None,
            check_out_at=None,
            duration_minutes=240,
            event_type="training",
            custom_category=None,
            resync=True,
        )

        assert count == 0
        svc.get_mappings_for_event.assert_not_awaited()
        db.execute.assert_not_awaited()


class TestMappingSettings:
    async def test_a_training_mapping_cannot_be_created(self):
        svc, db = _service()

        with pytest.raises(ValueError, match="training records instead"):
            await svc.create_event_hour_mapping(
                organization_id="org-1",
                created_by="admin-1",
                event_type="training",
                custom_category=None,
                admin_hours_category_id="cat-1",
            )
        db.execute.assert_not_awaited()

    async def test_a_stored_training_mapping_cannot_be_reactivated(self):
        mapping = SimpleNamespace(
            id="map-1", event_type="training", is_active=False, percentage=100
        )
        svc, _db = _service(_one(mapping))

        with pytest.raises(ValueError, match="training records instead"):
            await svc.update_event_hour_mapping(
                mapping_id="map-1", organization_id="org-1", is_active=True
            )

    def test_effect_is_reported_for_the_settings_screen(self):
        assert mapping_effect("training") == {
            "in_effect": False,
            "not_in_effect_reason": (
                "Training events are credited to members' training records "
                "instead of admin hours"
            ),
        }
        assert mapping_effect("business_meeting") == {
            "in_effect": True,
            "not_in_effect_reason": None,
        }
        assert mapping_effect(None)["in_effect"] is True


class TestPerEventRemoval:
    async def test_removes_the_event_s_attendance_entries(self):
        entries = [SimpleNamespace(id="e-1"), SimpleNamespace(id="e-2")]
        svc, db = _service(_all(entries))

        removed = await svc.delete_event_attendance_entries_for_event(
            "event-1", "org-1"
        )

        assert removed == 2
        assert db.delete.await_count == 2
        statement = db.execute.await_args.args[0]
        compiled = str(statement.compile(compile_kwargs={"literal_binds": True}))
        assert "admin_hours_entries.organization_id = 'org-1'" in compiled
        assert "admin_hours_entries.source_event_id = 'event-1'" in compiled
        # Only attendance-derived entries: one taken over by hand is theirs.
        method = AdminHoursEntryMethod.EVENT_ATTENDANCE.value
        assert f"admin_hours_entries.entry_method = '{method}'" in compiled

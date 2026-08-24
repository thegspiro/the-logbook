"""
The member-facing /events list ranks each event by how urgently it needs the
member — check-in open now, mandatory with no RSVP, mandatory and missed. That
ranking is derived from fields the list response did not previously carry, so
these cover the projection:

* the check-in window, computed rather than stored;
* `credited_hours` / `hour_category_label`, resolved from the org's active
  event-hour mappings with the same precedence ``credit_event_attendance``
  uses, so the number shown is the number that will be awarded;
* `user_attended`, which distinguishes "did not attend" from "not known" and
  therefore decides whether a member is told they missed something.

DB-free.
"""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from unittest.mock import AsyncMock

import pytest

from app.models.event import CheckInWindowType, Event
from app.services.event_service import EventService

ORG_ID = "11111111-1111-1111-1111-111111111111"


def make_event(**overrides) -> Event:
    start = datetime(2026, 9, 1, 19, 0, tzinfo=dt_timezone.utc)
    defaults = {
        "id": "22222222-2222-2222-2222-222222222222",
        "organization_id": ORG_ID,
        "title": "Ladder Company Drill",
        "event_type": "training",
        "custom_category": None,
        "start_datetime": start,
        "end_datetime": start + timedelta(hours=2),
        "actual_start_time": None,
        "actual_end_time": None,
        "check_in_window_type": CheckInWindowType.FLEXIBLE,
        "check_in_minutes_before": 60,
        "check_in_minutes_after": 15,
    }
    defaults.update(overrides)
    event = Event()
    for key, value in defaults.items():
        setattr(event, key, value)
    return event


class TestResolveCreditedHours:
    def test_no_mapping_credits_nothing(self):
        # An org that has not mapped this event type credits no hours, so the
        # card must not claim any — the row is omitted rather than showing 0.
        hours, label = EventService._resolve_credited_hours(make_event(), {})
        assert hours is None
        assert label is None

    def test_full_mapping_credits_the_scheduled_duration(self):
        mappings = {("event_type", "training"): [(100, "Drill")]}
        hours, label = EventService._resolve_credited_hours(make_event(), mappings)
        assert hours == 2.0
        assert label == "Drill"

    def test_partial_mapping_credits_its_share(self):
        mappings = {("event_type", "training"): [(50, "Drill")]}
        hours, label = EventService._resolve_credited_hours(make_event(), mappings)
        assert hours == 1.0
        assert label == "Drill"

    def test_split_mapping_sums_but_names_no_category(self):
        # 70/30 across two categories has no single honest label, so the total
        # is shown without naming one of them.
        mappings = {("event_type", "training"): [(70, "Drill"), (30, "Prof Dev")]}
        hours, label = EventService._resolve_credited_hours(make_event(), mappings)
        assert hours == 2.0
        assert label is None

    def test_event_type_wins_over_custom_category(self):
        # Mirrors AdminHoursService.get_mappings_for_event: while an event has
        # a type, its custom_category mapping is not consulted. Displaying the
        # custom-category credit here would promise hours nothing awards.
        mappings = {
            ("event_type", "training"): [(100, "Drill")],
            ("custom_category", "hazmat"): [(100, "Hazmat")],
        }
        event = make_event(custom_category="hazmat")
        hours, label = EventService._resolve_credited_hours(event, mappings)
        assert label == "Drill"

    def test_custom_category_applies_when_the_event_has_no_type(self):
        mappings = {("custom_category", "hazmat"): [(100, "Hazmat")]}
        event = make_event(event_type=None, custom_category="hazmat")
        hours, label = EventService._resolve_credited_hours(event, mappings)
        assert hours == 2.0
        assert label == "Hazmat"

    def test_zero_length_event_credits_nothing(self):
        start = datetime(2026, 9, 1, 19, 0, tzinfo=dt_timezone.utc)
        event = make_event(start_datetime=start, end_datetime=start)
        mappings = {("event_type", "training"): [(100, "Drill")]}
        hours, label = EventService._resolve_credited_hours(event, mappings)
        assert hours is None
        assert label is None

    def test_rounds_to_a_single_decimal(self):
        start = datetime(2026, 9, 1, 19, 0, tzinfo=dt_timezone.utc)
        event = make_event(
            start_datetime=start, end_datetime=start + timedelta(minutes=100)
        )
        mappings = {("event_type", "training"): [(100, "Drill")]}
        hours, _ = EventService._resolve_credited_hours(event, mappings)
        assert hours == 1.7


class TestAnnotateListItems:
    @pytest.fixture
    def service(self):
        return EventService(AsyncMock())

    async def test_attaches_the_check_in_window(self, service, monkeypatch):
        monkeypatch.setattr(
            "app.services.event_service.AdminHoursService",
            lambda db: AsyncMock(
                get_active_mappings_by_source=AsyncMock(return_value={})
            ),
        )
        event = make_event()
        items = [{"event": event}]

        await service._annotate_list_items(items, ORG_ID)

        # FLEXIBLE opens check_in_minutes_before ahead of the start and closes
        # at the end — the same rule the check-in endpoint enforces.
        assert items[0]["check_in_opens_at"] == event.start_datetime - timedelta(
            minutes=60
        )
        assert items[0]["check_in_closes_at"] == event.end_datetime

    async def test_attaches_credited_hours_from_the_org_mappings(
        self, service, monkeypatch
    ):
        monkeypatch.setattr(
            "app.services.event_service.AdminHoursService",
            lambda db: AsyncMock(
                get_active_mappings_by_source=AsyncMock(
                    return_value={("event_type", "training"): [(100, "Drill")]}
                )
            ),
        )
        items = [{"event": make_event()}]

        await service._annotate_list_items(items, ORG_ID)

        assert items[0]["credited_hours"] == 2.0
        assert items[0]["hour_category_label"] == "Drill"

    async def test_an_empty_list_does_not_query_the_mappings(
        self, service, monkeypatch
    ):
        calls = []
        monkeypatch.setattr(
            "app.services.event_service.AdminHoursService",
            lambda db: calls.append(db) or AsyncMock(),
        )

        await service._annotate_list_items([], ORG_ID)

        assert calls == []

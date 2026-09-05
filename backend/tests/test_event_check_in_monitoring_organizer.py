"""The organizer on the check-in monitoring dashboard.

``/events/{id}/monitoring`` is a route of its own with no event payload to read
the organizer from, and it is the screen a manager actually works the check-in
list from. The name therefore rides along on the stats.

It rides along on the *existing* event fetch rather than costing a query of its
own: this dashboard polls every ten seconds, so a second round trip here is one
per poll per open dashboard. These tests pin that — the query count, the
tolerance for an event with no creator recorded, and the blank-name fallback.

There was no coverage of ``get_check_in_monitoring_stats`` at all before this.
DB mocked; no MySQL.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.event import CheckInWindowType, EventType
from app.services.event_service import EventService

pytestmark = [pytest.mark.unit]


def _event():
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id="event-1",
        organization_id="org-1",
        title="Monthly Drill",
        event_type=EventType.TRAINING,
        created_by="organizer-1",
        start_datetime=now - timedelta(hours=1),
        end_datetime=now + timedelta(hours=1),
        actual_start_time=None,
        actual_end_time=None,
        check_in_window_type=CheckInWindowType.FLEXIBLE,
        check_in_minutes_before=60,
        check_in_minutes_after=60,
    )


def _creator(first="Sam", last="Ortiz", username="sortiz"):
    return SimpleNamespace(first_name=first, last_name=last, username=username)


def _db(creator):
    """Mock the three queries the method makes, in order."""
    event_row = MagicMock()
    event_row.first.return_value = (_event(), creator)

    rsvp_rows = MagicMock()
    rsvp_rows.all.return_value = []

    eligible = MagicMock()
    eligible.scalar.return_value = 30

    db = AsyncMock()
    db.execute.side_effect = [event_row, rsvp_rows, eligible]
    return db


class TestOrganizerOnMonitoringStats:
    async def test_the_organizer_is_named(self):
        db = _db(_creator())

        stats, error = await EventService(db).get_check_in_monitoring_stats(
            event_id="event-1", organization_id="org-1"
        )

        assert error is None
        assert stats["created_by_name"] == "Sam Ortiz"

    async def test_it_costs_no_extra_query(self):
        """The reason the creator is outer-joined onto the event fetch.

        Three queries: the event (carrying the creator), the RSVPs, and the
        eligible-member count. A fourth would run on every ten-second poll.
        """
        db = _db(_creator())

        await EventService(db).get_check_in_monitoring_stats(
            event_id="event-1", organization_id="org-1"
        )

        assert db.execute.await_count == 3

    async def test_no_creator_row_yields_the_key_with_no_name(self):
        """An event predating the column, or a creator outside the org.

        The join is constrained to the event's own organization, so a foreign
        created_by produces no row — the field is present and None rather than
        absent, so the response shape does not change.
        """
        db = _db(None)

        stats, error = await EventService(db).get_check_in_monitoring_stats(
            event_id="event-1", organization_id="org-1"
        )

        assert error is None
        assert stats["created_by_name"] is None

    async def test_a_blank_first_name_does_not_render_as_None(self):
        db = _db(_creator(first=None, last="Ortiz"))

        stats, _ = await EventService(db).get_check_in_monitoring_stats(
            event_id="event-1", organization_id="org-1"
        )

        assert stats["created_by_name"] == "Ortiz"

    async def test_a_wholly_nameless_creator_falls_back_to_the_username(self):
        db = _db(_creator(first=None, last=None, username="ghost"))

        stats, _ = await EventService(db).get_check_in_monitoring_stats(
            event_id="event-1", organization_id="org-1"
        )

        assert stats["created_by_name"] == "ghost"

    async def test_an_event_in_another_org_is_still_refused(self):
        """The post-fetch org check the join does not replace."""
        db = _db(_creator())

        stats, error = await EventService(db).get_check_in_monitoring_stats(
            event_id="event-1", organization_id="org-2"
        )

        assert stats is None
        assert error == "Event not found in your organization"

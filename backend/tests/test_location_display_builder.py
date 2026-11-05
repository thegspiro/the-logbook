"""
LOC-40: both room display endpoints are built by one function.

The public kiosk (``app/api/public/display.py``) and the authenticated room
page's endpoint (``app/api/v1/endpoints/locations.py``) each used to construct
``LocationDisplayInfo`` field by field, and the authenticated copy left
``allow_guest_check_in`` and ``badge_check_in_enabled`` at their defaults. The
owner chose one shared builder (2026-11-01), keeping the one deliberate
difference — how ``is_valid`` / ``can_check_in`` are decided — as a parameter.

These tests call both endpoints with the same room and events and pin:

- the public response's exact shape, so consolidating did not hand the
  unauthenticated kiosk a field it did not already send;
- that the two responses agree on every value except the window rule;
- the window rule itself, on an event where the two rules disagree.

LocationService and the integration lookup are mocked; no DB.
"""

from datetime import datetime, timedelta
from datetime import timezone as tz
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest

import app.api.public.display as display
import app.api.v1.endpoints.locations as locations
import app.services.location_display as location_display
from app.models.event import CheckInWindowType, EventType

pytestmark = [pytest.mark.unit]

LOC_ID = "11111111-1111-1111-1111-111111111111"

# What the kiosk sent before the builder was shared (captured from the
# pre-LOC-40 endpoint). A new key in either set is a field the unauthenticated
# kiosk would start publishing, so it has to be added here on purpose.
PUBLIC_TOP_LEVEL_KEYS = {
    "location_id",
    "location_name",
    "current_events",
    "has_overlap",
    "timezone",
    "badge_check_in_enabled",
}
PUBLIC_EVENT_KEYS = {
    "event_id",
    "event_name",
    "event_type",
    "event_description",
    "start_datetime",
    "end_datetime",
    "actual_end_time",
    "check_in_start",
    "check_in_end",
    "is_valid",
    "can_check_in",
    "location",
    "location_id",
    "location_name",
    "require_checkout",
    "timezone",
    "allow_guest_check_in",
    "records_training",
    "training_requires_approval",
    "user_checked_in_at",
    "user_checked_out_at",
}
# Fields the kiosk carries only at their empty defaults. Each would say more
# about the event or a member than a room display may: the description is
# not audience-filtered (LOC5-32-1), the training flags describe the event's
# credit rules, and the check-in times belong to whoever asked.
PUBLIC_EVENT_DEFAULTS = {
    "event_description": None,
    "timezone": None,
    "records_training": False,
    "training_requires_approval": False,
    "user_checked_in_at": None,
    "user_checked_out_at": None,
}


def _event(window_type=CheckInWindowType.FLEXIBLE, starts_in_minutes=20):
    start = datetime.now(tz.utc) + timedelta(minutes=starts_in_minutes)
    return SimpleNamespace(
        id=UUID("22222222-2222-2222-2222-222222222222"),
        title="Pump Drill",
        event_type=EventType.TRAINING,
        description="Not for the room display",
        start_datetime=start,
        end_datetime=start + timedelta(hours=1),
        actual_start_time=None,
        actual_end_time=None,
        location="Apparatus bay",
        location_id=UUID(LOC_ID),
        require_checkout=True,
        allow_guest_check_in=True,
        check_in_window_type=window_type,
        check_in_minutes_before=None,
        check_in_minutes_after=None,
        # Present so a builder that started reading them would leak them;
        # the defaults assertion above would then fail.
        records_training=True,
        training_requires_approval=True,
    )


@pytest.fixture
def room(monkeypatch):
    """One room, served to both endpoints, with badge check-in fully on."""
    location = SimpleNamespace(
        id=LOC_ID,
        organization_id="org-1",
        name="Training Room",
        nfc_badge_check_in_enabled=True,
    )
    state = SimpleNamespace(location=location, events=[])
    service = SimpleNamespace(
        get_location=AsyncMock(return_value=location),
        get_location_by_display_code=AsyncMock(return_value=location),
        get_current_events_in_check_in_window=AsyncMock(
            side_effect=lambda **_: state.events
        ),
    )
    monkeypatch.setattr(display, "LocationService", lambda db: service)
    monkeypatch.setattr(locations, "LocationService", lambda db: service)
    monkeypatch.setattr(
        location_display, "nfc_id_cards_enabled", AsyncMock(return_value=True)
    )
    return state


def _db():
    db = MagicMock()
    db.execute = AsyncMock(
        return_value=MagicMock(
            scalar_one_or_none=MagicMock(return_value="America/Chicago")
        )
    )
    return db


async def _public():
    info = await display.get_public_location_display("ROOM1CODE", db=_db())
    return info.model_dump(mode="json")


async def _authenticated():
    info = await locations.get_location_display_info(
        location_id=UUID(LOC_ID),
        db=_db(),
        current_user=SimpleNamespace(id="user-1", organization_id="org-1"),
    )
    return info.model_dump(mode="json")


class TestPublicKioskShape:
    async def test_sends_exactly_the_fields_it_sent_before(self, room):
        room.events = [_event()]
        body = await _public()

        assert set(body) == PUBLIC_TOP_LEVEL_KEYS
        assert set(body["current_events"][0]) == PUBLIC_EVENT_KEYS

    async def test_withheld_fields_stay_empty(self, room):
        room.events = [_event()]
        event = (await _public())["current_events"][0]

        for key, empty in PUBLIC_EVENT_DEFAULTS.items():
            assert event[key] == empty, key


class TestBothEndpointsFillTheSameFields:
    async def test_an_open_event_reads_the_same_on_both(self, room):
        """With the window open both rules say yes, so nothing may differ."""
        room.events = [_event(CheckInWindowType.FLEXIBLE, starts_in_minutes=20)]

        assert await _authenticated() == await _public()

    async def test_the_room_page_reports_guest_check_in(self, room):
        room.events = [_event()]
        event = (await _authenticated())["current_events"][0]

        assert event["allow_guest_check_in"] is True

    async def test_the_room_page_reports_the_badge_reader(self, room):
        assert (await _authenticated())["badge_check_in_enabled"] is True

    async def test_the_room_page_withholds_what_the_kiosk_withholds(self, room):
        room.events = [_event()]
        event = (await _authenticated())["current_events"][0]

        for key, empty in PUBLIC_EVENT_DEFAULTS.items():
            assert event[key] == empty, key


class TestTheWindowRuleIsTheParameter:
    """A STRICT event that has not started: the kiosk re-asks the check-in
    rule and is told no; the room page trusts the selection. The selection
    would not have returned this event, so the room page's answer is never
    shown in practice — the case exists here only to tell the rules apart."""

    async def test_the_kiosk_rechecks_the_window(self, room):
        room.events = [_event(CheckInWindowType.STRICT, starts_in_minutes=30)]
        event = (await _public())["current_events"][0]

        assert event["is_valid"] is False
        assert event["can_check_in"] is False

    async def test_the_room_page_trusts_the_selection(self, room):
        room.events = [_event(CheckInWindowType.STRICT, starts_in_minutes=30)]
        event = (await _authenticated())["current_events"][0]

        assert event["is_valid"] is True
        assert event["can_check_in"] is True

    async def test_nothing_else_differs(self, room):
        room.events = [_event(CheckInWindowType.STRICT, starts_in_minutes=30)]
        public, authed = await _public(), await _authenticated()

        for body in (public, authed):
            for event in body["current_events"]:
                del event["is_valid"], event["can_check_in"]
        assert public == authed

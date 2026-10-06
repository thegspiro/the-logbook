"""
The authenticated location display endpoint builds a real QRCheckInData.

`app/api/v1/endpoints/locations.py` constructs the schema field by field, so
every field the schema requires has to be passed there explicitly. When
`can_check_in` was added as a required field, the public kiosk
(`app/api/public/display.py`) was updated and this endpoint was not — and
because it constructs the model rather than returning a dict, the omission is
not a wrong value but a `ValidationError`: the endpoint 500s for any location
that has an event in its check-in window, which is the only state it exists to
report.

Nothing caught it. `test_kiosk_check_in_window.py` covers
`LocationService.get_current_events_in_check_in_window` — the query that feeds
this loop — and stops there, and `test_public_display.py` covers the other
endpoint. This file closes that gap: it calls the endpoint with an event in
window and asserts the response is built.

LocationService is mocked; no DB.
"""

from datetime import datetime, timedelta
from datetime import timezone as tz
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

import app.api.v1.endpoints.locations as locations
from app.models.event import CheckInWindowType

pytestmark = [pytest.mark.unit]

NOW = datetime.now(tz.utc)
LOC_ID = uuid4()


def _event(window_type=CheckInWindowType.FLEXIBLE, starts_in_minutes=20):
    start = NOW + timedelta(minutes=starts_in_minutes)
    return SimpleNamespace(
        id=uuid4(),
        title="Monthly Meeting",
        event_type=None,
        description="Business meeting",
        start_datetime=start,
        end_datetime=start + timedelta(hours=1),
        actual_start_time=None,
        actual_end_time=None,
        location="Hall A",
        location_id=None,
        require_checkout=False,
        check_in_window_type=window_type,
        check_in_minutes_before=None,
        check_in_minutes_after=None,
    )


def _patch_location_service(monkeypatch, events):
    location = SimpleNamespace(
        id=str(LOC_ID), organization_id="org-1", name="Station 1"
    )
    fake = SimpleNamespace(
        get_location=AsyncMock(return_value=location),
        get_current_events_in_check_in_window=AsyncMock(return_value=events),
    )
    monkeypatch.setattr(locations, "LocationService", lambda db: fake)
    return location


def _user():
    return SimpleNamespace(id=uuid4(), organization_id="org-1")


def _db(org_timezone="America/New_York"):
    db = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = org_timezone
    db.execute.return_value = result
    return db


async def _call(monkeypatch, events, db=None):
    _patch_location_service(monkeypatch, events)
    return await locations.get_location_display_info(
        location_id=LOC_ID, db=db or _db(), current_user=_user()
    )


class TestLocationDisplayInfo:
    async def test_an_event_in_window_is_reported_rather_than_raising(
        self, monkeypatch
    ):
        """The regression: a missing required field here is a 500, not a 0."""
        result = await _call(monkeypatch, [_event()])

        assert len(result.current_events) == 1
        assert result.current_events[0]["event_name"] == "Monthly Meeting"

    async def test_a_listed_event_can_be_checked_into(self, monkeypatch):
        """The service filters on the strict window before this loop sees an
        event, and the permissive rule admits everything the strict one does —
        so anything the kiosk lists is something a member can act on."""
        result = await _call(monkeypatch, [_event()])

        assert result.current_events[0]["is_valid"] is True
        assert result.current_events[0]["can_check_in"] is True

    async def test_no_events_is_still_a_valid_response(self, monkeypatch):
        result = await _call(monkeypatch, [])

        assert result.current_events == []
        assert result.has_overlap is False

    async def test_two_events_at_one_location_report_the_overlap(self, monkeypatch):
        result = await _call(monkeypatch, [_event(), _event(starts_in_minutes=25)])

        assert len(result.current_events) == 2
        assert result.has_overlap is True

    async def test_event_description_is_redacted(self, monkeypatch):
        """LOC5-32-1: this endpoint gained a real caller (RoomCheckInPage's
        `getCurrentCheckIns`) without closing the redaction gap its public
        sibling already closed. `_event()`'s `description` is non-empty, so a
        regression that reinstates `event_description=event.description`
        fails this rather than passing by coincidence on an empty field."""
        result = await _call(monkeypatch, [_event()])

        assert result.current_events[0]["event_description"] is None

    async def test_ships_the_department_timezone(self, monkeypatch):
        # The public kiosk sends it; a caller of this endpoint with no
        # timezone of its own would otherwise render UTC in the device's zone.
        info = await _call(monkeypatch, [_event()])
        assert info.timezone == "America/New_York"

    async def test_a_department_with_no_timezone_sends_none(self, monkeypatch):
        info = await _call(monkeypatch, [], db=_db(None))
        assert info.timezone is None

"""
Tests for the public location kiosk display endpoint (app/api/public/display.py).

The kiosk must report the authoritative check-in window/validity (the same
logic the check-in endpoint enforces), not a hardcoded 1-hour guess — so a
STRICT event isn't shown as "ready" before its window opens, while an early
FLEXIBLE event correctly shows as available. LocationService is mocked; no DB.
"""

from datetime import datetime, timedelta
from datetime import timezone as tz
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

import app.api.public.display as display
from app.models.event import CheckInWindowType

NOW = datetime.now(tz.utc)
LOC_ID = str(uuid4())


def _event(window_type, starts_in_minutes, allow_guest_check_in=False):
    start = NOW + timedelta(minutes=starts_in_minutes)
    return SimpleNamespace(
        id=uuid4(),
        title="Monthly Meeting",
        event_type=None,
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
        allow_guest_check_in=allow_guest_check_in,
    )


def _patch_location_service(monkeypatch, events):
    location = SimpleNamespace(id=LOC_ID, organization_id="org-1", name="Station 1")

    fake = SimpleNamespace(
        get_location_by_display_code=AsyncMock(return_value=location),
        get_current_events_in_check_in_window=AsyncMock(return_value=events),
    )
    monkeypatch.setattr(display, "LocationService", lambda db: fake)
    return location


def _db(org_timezone="America/New_York"):
    """Stub session whose one query returns the organization's timezone.

    The kiosk is unauthenticated, so the endpoint looks the timezone up itself
    rather than reading it off a user profile — see LOC-2.
    """
    db = MagicMock()
    db.execute = AsyncMock(
        return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=org_timezone))
    )
    return db


async def _call(code="abc123", org_timezone="America/New_York"):
    return await display.get_public_location_display(code, db=_db(org_timezone))


class TestPublicDisplayWindow:
    async def test_strict_event_not_yet_open_is_invalid(self, monkeypatch):
        # STRICT event starting in 30 min: window opens at start -> not valid yet.
        _patch_location_service(monkeypatch, [_event(CheckInWindowType.STRICT, 30)])
        result = await _call()
        assert result.current_events[0]["is_valid"] is False

    async def test_flexible_early_event_is_valid(self, monkeypatch):
        # FLEXIBLE event starting in 20 min: within the 60-min early grace,
        # so the kiosk reports it as available (early check-in is allowed).
        _patch_location_service(monkeypatch, [_event(CheckInWindowType.FLEXIBLE, 20)])
        result = await _call()
        assert result.current_events[0]["is_valid"] is True

    async def test_reports_authoritative_window_start(self, monkeypatch):
        # The kiosk must report the window the service actually enforces, which
        # is the FLEXIBLE default of 60 minutes before start.
        event = _event(CheckInWindowType.FLEXIBLE, 60)
        _patch_location_service(monkeypatch, [event])
        result = await _call()
        reported = datetime.fromisoformat(result.current_events[0]["check_in_start"])
        expected = event.start_datetime - timedelta(minutes=60)
        assert abs((reported - expected).total_seconds()) < 1

    async def test_invalid_display_code_404s(self, monkeypatch):
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc:
            await _call(code="bad!")  # non-alphanumeric
        assert exc.value.status_code == 404


class TestGuestCheckInDailyCapOrdering:
    """The daily cap must be reserved only by a sign-in that could succeed.

    daily_cap_exceeded is an atomic Redis INCR — merely asking spends an
    allowance slot — so a rejection running after it lets refused traffic
    burn the event's 300/day ceiling before the window even opens (or after
    attendance is finalized), denying legitimate guests later. Every
    rejection gate must run first.
    """

    def _finalizable_event(self, **overrides):
        now = datetime.now(tz.utc)
        defaults = dict(
            id=uuid4(),
            organization_id="org-1",
            title="Open House",
            event_type=None,
            # Starts in 2h; FLEXIBLE's 30-min-before default means the window
            # is not open yet.
            start_datetime=now + timedelta(hours=2),
            end_datetime=now + timedelta(hours=4),
            actual_start_time=None,
            actual_end_time=None,
            check_in_window_type=CheckInWindowType.FLEXIBLE,
            check_in_minutes_before=30,
            check_in_minutes_after=None,
            allow_guest_check_in=True,
            attendance_finalized_at=None,
            custom_fields={},
        )
        defaults.update(overrides)
        return SimpleNamespace(**defaults)

    def _payload(self):
        from app.schemas.event import GuestCheckInRequest

        return GuestCheckInRequest(first_name="Dana", last_name="Reyes")

    def _patch_resolve(self, monkeypatch, event):
        location = SimpleNamespace(id=LOC_ID, organization_id="org-1")
        org = SimpleNamespace(name="Test Dept", timezone="UTC")
        resolve = AsyncMock(return_value=(location, event, org))
        monkeypatch.setattr(display, "_resolve_guest_event", resolve)
        return location, org

    async def test_window_not_open_does_not_spend_the_cap(self, monkeypatch):
        from fastapi import HTTPException

        event = self._finalizable_event()  # window opens in 90 min, not yet
        self._patch_resolve(monkeypatch, event)
        cap_mock = AsyncMock(return_value=False)
        monkeypatch.setattr(display, "daily_cap_exceeded", cap_mock)

        with pytest.raises(HTTPException) as exc:
            await display.guest_check_in(
                display_code="abc123",
                event_id=event.id,
                payload=self._payload(),
                request=MagicMock(),
                db=_db(),
            )

        assert exc.value.status_code == 400
        cap_mock.assert_not_awaited()

    async def test_finalized_attendance_does_not_spend_the_cap(self, monkeypatch):
        from fastapi import HTTPException

        # Window is open (starts now), but attendance was already finalized.
        now = datetime.now(tz.utc)
        event = self._finalizable_event(
            start_datetime=now - timedelta(minutes=5),
            end_datetime=now + timedelta(hours=1),
            attendance_finalized_at=now - timedelta(minutes=1),
        )
        self._patch_resolve(monkeypatch, event)
        cap_mock = AsyncMock(return_value=False)
        monkeypatch.setattr(display, "daily_cap_exceeded", cap_mock)

        with pytest.raises(HTTPException) as exc:
            await display.guest_check_in(
                display_code="abc123",
                event_id=event.id,
                payload=self._payload(),
                request=MagicMock(),
                db=_db(),
            )

        assert exc.value.status_code == 400
        cap_mock.assert_not_awaited()

    async def test_open_window_still_spends_the_cap(self, monkeypatch):
        """A genuinely acceptable sign-in still reserves the allowance."""
        now = datetime.now(tz.utc)
        event = self._finalizable_event(
            start_datetime=now - timedelta(minutes=5),
            end_datetime=now + timedelta(hours=1),
        )
        self._patch_resolve(monkeypatch, event)
        cap_mock = AsyncMock(return_value=True)  # cap already spent
        monkeypatch.setattr(display, "daily_cap_exceeded", cap_mock)

        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc:
            await display.guest_check_in(
                display_code="abc123",
                event_id=event.id,
                payload=self._payload(),
                request=MagicMock(),
                db=_db(),
            )

        assert exc.value.status_code == 429
        cap_mock.assert_awaited_once()


class TestGuestCheckInFlag:
    """The kiosk only draws a guest QR code for events that opted in.

    The flag gates an unauthenticated write endpoint, so a display must never
    advertise guest sign-in for an event that has not enabled it.
    """

    async def test_flag_defaults_off(self, monkeypatch):
        _patch_location_service(monkeypatch, [_event(CheckInWindowType.FLEXIBLE, 10)])
        result = await _call()
        assert result.current_events[0]["allow_guest_check_in"] is False

    async def test_flag_is_reported_when_enabled(self, monkeypatch):
        _patch_location_service(
            monkeypatch,
            [_event(CheckInWindowType.FLEXIBLE, 10, allow_guest_check_in=True)],
        )
        result = await _call()
        assert result.current_events[0]["allow_guest_check_in"] is True


class TestKioskTimezone:
    """The kiosk has no session, so the API must tell it which zone to render in.

    Without this the page falls back to the tablet's own timezone — commonly
    UTC on a wall-mounted device — and every time on the display is shifted.
    """

    async def test_response_carries_the_department_timezone(self, monkeypatch):
        _patch_location_service(monkeypatch, [_event(CheckInWindowType.FLEXIBLE, 10)])
        result = await _call(org_timezone="America/Chicago")
        assert result.timezone == "America/Chicago"

    async def test_missing_org_timezone_is_none_not_an_error(self, monkeypatch):
        # An org that never set one must still render the kiosk; the client
        # keeps its own fallback.
        _patch_location_service(monkeypatch, [_event(CheckInWindowType.FLEXIBLE, 10)])
        result = await _call(org_timezone=None)
        assert result.timezone is None


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))

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


def _event(window_type, starts_in_minutes):
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
    )


def _patch_location_service(monkeypatch, events):
    location = SimpleNamespace(id=LOC_ID, organization_id="org-1", name="Station 1")

    fake = SimpleNamespace(
        get_location_by_display_code=AsyncMock(return_value=location),
        get_current_events_in_check_in_window=AsyncMock(return_value=events),
    )
    monkeypatch.setattr(display, "LocationService", lambda db: fake)
    return location


async def _call(code="abc123"):
    return await display.get_public_location_display(code, db=MagicMock())


class TestPublicDisplayWindow:
    async def test_strict_event_not_yet_open_is_invalid(self, monkeypatch):
        # STRICT event starting in 30 min: window opens at start -> not valid yet.
        _patch_location_service(monkeypatch, [_event(CheckInWindowType.STRICT, 30)])
        result = await _call()
        assert result.current_events[0]["is_valid"] is False

    async def test_flexible_early_event_is_valid(self, monkeypatch):
        # FLEXIBLE event starting in 20 min: within the 30-min early grace,
        # so the kiosk reports it as available (early check-in is allowed).
        _patch_location_service(monkeypatch, [_event(CheckInWindowType.FLEXIBLE, 20)])
        result = await _call()
        assert result.current_events[0]["is_valid"] is True

    async def test_reports_authoritative_window_start(self, monkeypatch):
        # FLEXIBLE default opens 30 min before start (not the old 1-hour guess).
        event = _event(CheckInWindowType.FLEXIBLE, 60)
        _patch_location_service(monkeypatch, [event])
        result = await _call()
        reported = datetime.fromisoformat(result.current_events[0]["check_in_start"])
        expected = event.start_datetime - timedelta(minutes=30)
        assert abs((reported - expected).total_seconds()) < 1

    async def test_invalid_display_code_404s(self, monkeypatch):
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc:
            await _call(code="bad!")  # non-alphanumeric
        assert exc.value.status_code == 404


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))

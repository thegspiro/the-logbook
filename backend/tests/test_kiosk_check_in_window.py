"""
LOC-4 (pass 2): the kiosk's current-events selection must apply the canonical
per-event check-in window (EventService._get_check_in_window), not a hardcoded
1-hour lead — otherwise a STRICT or early-FLEXIBLE event shows an active check-in
QR up to an hour before its window actually opens (the LOC-1 drift, one layer
down). DB mocked; no MySQL.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.event import CheckInWindowType
from app.services.location_service import LocationService

NOW = datetime.now(timezone.utc)


def _event(eid, window_type, start_offset_min, **kw):
    return SimpleNamespace(
        id=eid,
        check_in_window_type=window_type,
        check_in_minutes_before=kw.get("minutes_before"),
        check_in_minutes_after=kw.get("minutes_after"),
        start_datetime=NOW + timedelta(minutes=start_offset_min),
        end_datetime=NOW + timedelta(minutes=start_offset_min + 120),
        actual_start_time=kw.get("actual_start_time"),
        actual_end_time=None,
    )


class TestKioskCheckInWindow:
    async def test_only_events_whose_window_is_open_are_returned(self):
        # FLEXIBLE started 10 min ago -> window (30 min before) is open now.
        open_event = _event("open", CheckInWindowType.FLEXIBLE, -10)
        # STRICT starting in 30 min -> window opens at start, not open yet, even
        # though the old 1-hour prefilter would have surfaced it as "active".
        early_strict = _event("early", CheckInWindowType.STRICT, 30)

        result = MagicMock()
        result.scalars.return_value.all.return_value = [open_event, early_strict]
        db = MagicMock()
        db.execute = AsyncMock(return_value=result)

        events = await LocationService(db).get_current_events_in_check_in_window(
            "loc-1", "org-1"
        )

        ids = [e.id for e in events]
        assert ids == ["open"]  # the not-yet-open STRICT event is filtered out


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))

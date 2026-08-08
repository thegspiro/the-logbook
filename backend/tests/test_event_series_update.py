"""
Event series-update tests (BXC-1).

update_future_events applies an EventUpdate across a whole recurring series via
a blind setattr loop. Like update_event / create_event, it must validate a
newly-set location_id in-org — location_id is eager-loaded and name-projected as
location_name, so a foreign id would leak another org's location name on every
event in the series.

Mocked session — no DB.
"""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.schemas.event import EventUpdate
from app.services.event_service import EventService


def _scalar(value):
    r = MagicMock()
    r.scalar_one_or_none.return_value = value
    return r


def _scalars(values):
    r = MagicMock()
    r.scalars.return_value.all.return_value = values
    return r


def _anchor():
    return MagicMock(
        is_cancelled=False,
        id=str(uuid4()),
        recurrence_parent_id=None,
        start_datetime=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )


class TestUpdateFutureEventsLocationValidation:
    async def test_foreign_location_rejected(self):
        db = AsyncMock()
        svc = EventService(db)
        # execute #1: anchor fetch. #2: series query.
        db.execute.side_effect = [_scalar(_anchor()), _scalars([MagicMock()])]
        with patch("app.services.event_service.LocationService") as MockLoc:
            MockLoc.return_value.get_location = AsyncMock(return_value=None)
            with pytest.raises(ValueError, match="Location not found"):
                await svc.update_future_events(
                    uuid4(), uuid4(), EventUpdate(location_id=uuid4())
                )
        db.commit.assert_not_awaited()

    async def test_no_location_change_skips_validation(self):
        db = AsyncMock()
        svc = EventService(db)
        db.execute.side_effect = [_scalar(_anchor()), _scalars([MagicMock()])]
        with patch("app.services.event_service.LocationService") as MockLoc:
            # No location_id in the update → the location service is never used.
            count = await svc.update_future_events(
                uuid4(), uuid4(), EventUpdate(title="Renamed drill")
            )
            MockLoc.return_value.get_location.assert_not_called()
        assert count == 1
        db.commit.assert_awaited_once()

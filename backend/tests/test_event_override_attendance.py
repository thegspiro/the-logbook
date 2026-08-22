from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.schemas.event import RSVPOverride
from app.services.event_service import EventService


@pytest.mark.asyncio
async def test_individual_override_calculates_duration_without_changing_event_times():
    actual_start = datetime(2030, 4, 15, 18, 0, tzinfo=timezone.utc)
    actual_end = datetime(2030, 4, 15, 20, 0, tzinfo=timezone.utc)
    event = SimpleNamespace(actual_start_time=actual_start, actual_end_time=actual_end)
    rsvp = SimpleNamespace(
        override_check_in_at=None,
        override_check_out_at=None,
        override_duration_minutes=None,
        checked_in=False,
        checked_in_at=None,
    )

    event_result = MagicMock()
    event_result.scalar_one_or_none.return_value = event
    rsvp_result = MagicMock()
    rsvp_result.scalar_one_or_none.return_value = rsvp
    db = AsyncMock()
    db.execute.side_effect = [event_result, rsvp_result]

    check_in = datetime(2030, 4, 15, 18, 10, tzinfo=timezone.utc)
    check_out = datetime(2030, 4, 15, 19, 25, tzinfo=timezone.utc)
    result, error = await EventService(db).override_rsvp_attendance(
        uuid4(),
        uuid4(),
        uuid4(),
        uuid4(),
        RSVPOverride(
            override_check_in_at=check_in,
            override_check_out_at=check_out,
        ),
    )

    assert error is None
    assert result is rsvp
    assert rsvp.override_duration_minutes == 75
    assert event.actual_start_time == actual_start
    assert event.actual_end_time == actual_end
    db.commit.assert_awaited_once()

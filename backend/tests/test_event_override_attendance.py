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


_IN = datetime(2030, 4, 15, 18, 10, tzinfo=timezone.utc)
_OUT = datetime(2030, 4, 15, 19, 25, tzinfo=timezone.utc)


async def _override(rsvp: SimpleNamespace, data: RSVPOverride) -> SimpleNamespace:
    event_result = MagicMock()
    event_result.scalar_one_or_none.return_value = SimpleNamespace(
        actual_start_time=None, actual_end_time=None
    )
    rsvp_result = MagicMock()
    rsvp_result.scalar_one_or_none.return_value = rsvp
    db = AsyncMock()
    db.execute.side_effect = [event_result, rsvp_result]
    result, error = await EventService(db).override_rsvp_attendance(
        uuid4(), uuid4(), uuid4(), uuid4(), data
    )
    assert error is None
    return result


def _overridden_rsvp(duration: int | None, **times) -> SimpleNamespace:
    return SimpleNamespace(
        override_check_in_at=times.get("check_in", _IN),
        override_check_out_at=times.get("check_out", _OUT),
        override_duration_minutes=duration,
        checked_in=True,
        checked_in_at=_IN,
    )


class TestClearingAnOverrideTime:
    """A cleared override time must not leave its derived duration behind.

    Finalize credits ``override_duration_minutes`` ahead of the clock, so a
    stale 75 would keep crediting the old span after the officer emptied the
    check-out box.
    """

    async def test_clearing_check_out_drops_the_duration_it_derived(self):
        rsvp = await _override(
            _overridden_rsvp(75), RSVPOverride(override_check_out_at=None)
        )
        assert rsvp.override_check_out_at is None
        assert rsvp.override_check_in_at == _IN
        assert rsvp.override_duration_minutes is None

    async def test_clearing_check_in_drops_the_duration_it_derived(self):
        rsvp = await _override(
            _overridden_rsvp(75), RSVPOverride(override_check_in_at=None)
        )
        assert rsvp.override_check_in_at is None
        assert rsvp.override_duration_minutes is None

    async def test_a_duration_entered_on_purpose_survives_the_clear(self):
        # 30 is not the 75-minute span of the old pair, so it was set
        # deliberately and stands on its own.
        rsvp = await _override(
            _overridden_rsvp(30), RSVPOverride(override_check_out_at=None)
        )
        assert rsvp.override_check_out_at is None
        assert rsvp.override_duration_minutes == 30

    async def test_a_duration_in_the_same_request_is_respected(self):
        rsvp = await _override(
            _overridden_rsvp(75),
            RSVPOverride(override_check_out_at=None, override_duration_minutes=45),
        )
        assert rsvp.override_duration_minutes == 45

    async def test_resending_an_already_empty_time_keeps_the_duration(self):
        # The edit-times form sends null for an empty box on every save; with
        # no previous pair there is nothing the duration was derived from.
        rsvp = await _override(
            _overridden_rsvp(75, check_out=None),
            RSVPOverride(override_check_in_at=_IN, override_check_out_at=None),
        )
        assert rsvp.override_duration_minutes == 75

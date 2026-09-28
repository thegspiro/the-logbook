"""
Event series-update tests (BXC-1).

update_future_events applies an EventUpdate across a whole recurring series via
a blind setattr loop. Like update_event / create_event, it must validate a
newly-set location_id in-org — location_id is eager-loaded and name-projected as
location_name, so a foreign id would leak another org's location name on every
event in the series.

Mocked session — no DB.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4
from zoneinfo import ZoneInfo

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


class TestUpdateFutureEventsTiming:
    """W18-2: "This and all future events" stamped the anchor's start and end
    onto every later occurrence. The edit form always sends the times, so
    changing only a description moved a weekly series onto one day."""

    CHI = ZoneInfo("America/Chicago")

    def _series(self):
        # Mondays 7-9pm Chicago, 19 Oct - 9 Nov 2026 (DST ends 1 Nov).
        starts = [
            datetime(2026, 10, 20, 0, 0, tzinfo=timezone.utc),
            datetime(2026, 10, 27, 0, 0, tzinfo=timezone.utc),
            datetime(2026, 11, 3, 1, 0, tzinfo=timezone.utc),
            datetime(2026, 11, 10, 1, 0, tzinfo=timezone.utc),
        ]
        return [
            SimpleNamespace(
                id=str(uuid4()),
                is_cancelled=False,
                recurrence_parent_id="parent",
                start_datetime=s,
                end_datetime=s + timedelta(hours=2),
                rsvp_deadline=None,
                attendance_finalized_at=None,
                custom_fields=None,
            )
            for s in starts
        ]

    async def _update(self, series, update):
        db = AsyncMock()
        db.execute.side_effect = [_scalar(series[0]), _scalars(series)]
        with patch(
            "app.services.event_service.resolve_scheduling_timezone",
            AsyncMock(return_value=self.CHI),
        ):
            return await EventService(db).update_future_events(uuid4(), uuid4(), update)

    def _local(self, value):
        return value.astimezone(self.CHI).strftime("%a %d %b %H:%M")

    async def test_unchanged_times_leave_every_occurrence_where_it_was(self):
        series = self._series()
        before = [(e.start_datetime, e.end_datetime) for e in series]
        anchor = series[0]

        count = await self._update(
            series,
            EventUpdate(
                description="Bring SCBA.",
                start_datetime=anchor.start_datetime,
                end_datetime=anchor.end_datetime,
            ),
        )

        assert count == 4
        assert [(e.start_datetime, e.end_datetime) for e in series] == before
        assert {e.description for e in series} == {"Bring SCBA."}

    async def test_a_new_start_moves_each_occurrence_by_the_same_wall_clock_shift(
        self,
    ):
        series = self._series()
        anchor = series[0]

        await self._update(
            series,
            EventUpdate(
                start_datetime=anchor.start_datetime + timedelta(minutes=30),
                end_datetime=anchor.end_datetime + timedelta(minutes=60),
            ),
        )

        assert [self._local(e.start_datetime) for e in series] == [
            "Mon 19 Oct 19:30",
            "Mon 26 Oct 19:30",
            "Mon 02 Nov 19:30",
            "Mon 09 Nov 19:30",
        ]
        assert all(
            e.end_datetime - e.start_datetime == timedelta(hours=2, minutes=30)
            for e in series
        )

    async def test_an_rsvp_deadline_keeps_its_lead_on_each_occurrence(self):
        series = self._series()
        anchor = series[0]

        await self._update(
            series,
            EventUpdate(rsvp_deadline=anchor.start_datetime - timedelta(days=1)),
        )

        assert [self._local(e.rsvp_deadline) for e in series] == [
            "Sun 18 Oct 19:00",
            "Sun 25 Oct 19:00",
            "Sun 01 Nov 19:00",
            "Sun 08 Nov 19:00",
        ]

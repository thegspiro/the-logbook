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

from app.models.event import CheckInWindowType, EventType
from app.schemas.event import EventUpdate
from app.services.event_service import (
    ATTENDANCE_LOCKED_PREFIX,
    EventService,
    attendance_is_finalized,
    attendance_locked_error,
)


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
                # Every event has a type and a title; the series edit reads both
                # to keep a Training occurrence's credit in step.
                event_type=None,
                title="Monday drill",
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


def _drills(*finalized, **per_occurrence):
    """Four Monday drills; ``finalized`` names the closed indexes and each
    keyword maps an index to that occurrence's overrides."""
    starts = [
        datetime(2026, 9, 1, 0, 0, tzinfo=timezone.utc) + timedelta(weeks=week)
        for week in range(4)
    ]
    series = []
    for index, start in enumerate(starts):
        occurrence = SimpleNamespace(
            id=str(uuid4()),
            is_cancelled=False,
            recurrence_parent_id="parent",
            start_datetime=start,
            end_datetime=start + timedelta(hours=2),
            rsvp_deadline=None,
            attendance_finalized_at=(
                start + timedelta(hours=3) if index in finalized else None
            ),
            custom_fields=None,
            event_type=EventType.BUSINESS_MEETING,
            custom_category=None,
            check_in_window_type=CheckInWindowType.FLEXIBLE,
            check_in_minutes_before=60,
            check_in_minutes_after=15,
            require_checkout=False,
            title="Monday drill",
            description=None,
        )
        for name, value in per_occurrence.get(f"o{index}", {}).items():
            setattr(occurrence, name, value)
        series.append(occurrence)
    return series


async def _save_series(series, update):
    db = AsyncMock()
    db.execute.side_effect = [_scalar(series[0]), _scalars(series)]
    with patch(
        "app.services.event_service.resolve_scheduling_timezone",
        AsyncMock(return_value=ZoneInfo("America/Chicago")),
    ):
        count = await EventService(db).update_future_events(uuid4(), uuid4(), update)
    return count, db


class TestUpdateFutureEventsAttendanceLock:
    """A series save reaches finalized occurrences too, and the lock refuses
    what would change on them — not a field's mere presence. The edit form
    resends every field it shows, so a presence check refused every "this and
    all future events" save once any occurrence in reach was finalized."""

    def _form_save(self, anchor, **changes):
        body = {
            "title": anchor.title,
            "event_type": "business_meeting",
            "start_datetime": anchor.start_datetime,
            "end_datetime": anchor.end_datetime,
            "check_in_window_type": "flexible",
            "check_in_minutes_before": 60,
            "check_in_minutes_after": 15,
            "require_checkout": False,
        }
        body.update(changes)
        return EventUpdate.model_validate(body)

    async def test_a_descriptive_edit_passes_finalized_occurrences_it_leaves_alone(
        self,
    ):
        series = _drills(0, 1)

        count, db = await _save_series(
            series, self._form_save(series[0], description="Bring SCBA.")
        )

        assert count == 4
        assert {e.description for e in series} == {"Bring SCBA."}
        db.commit.assert_awaited_once()

    async def test_a_finalized_occurrence_that_would_change_refuses_the_whole_edit(
        self,
    ):
        """The loop writes the anchor's values onto every occurrence, so a
        closed one that differs from the anchor is changed by a save that
        leaves the anchor as it was."""
        series = _drills(2, o2={"check_in_minutes_before": 30})

        with pytest.raises(ValueError, match=ATTENDANCE_LOCKED_PREFIX) as excinfo:
            await _save_series(
                series, self._form_save(series[0], description="Bring SCBA.")
            )

        assert str(excinfo.value) == attendance_locked_error(
            "changing check_in_minutes_before across this series "
            "(1 of 1 finalized occurrence would change)"
        )
        assert {e.description for e in series} == {None}
        assert series[2].check_in_minutes_before == 30

    async def test_only_finalized_occurrences_that_would_change_are_counted(self):
        series = _drills(
            0,
            1,
            2,
            o1={"require_checkout": True},
            o2={"require_checkout": True},
            o3={"require_checkout": True},
        )

        with pytest.raises(ValueError, match=ATTENDANCE_LOCKED_PREFIX) as excinfo:
            await _save_series(series, self._form_save(series[0]))

        assert str(excinfo.value) == attendance_locked_error(
            "changing require_checkout across this series "
            "(2 of 3 finalized occurrences would change)"
        )

    async def test_moving_the_series_clock_is_refused_when_any_occurrence_is_closed(
        self,
    ):
        series = _drills(3)
        anchor = series[0]

        with pytest.raises(ValueError, match=ATTENDANCE_LOCKED_PREFIX) as excinfo:
            await _save_series(
                series,
                self._form_save(
                    anchor,
                    start_datetime=anchor.start_datetime + timedelta(minutes=30),
                    end_datetime=anchor.end_datetime + timedelta(minutes=30),
                ),
            )

        assert str(excinfo.value) == attendance_locked_error(
            "changing end_datetime, start_datetime across this series "
            "(1 of 1 finalized occurrence would change)"
        )
        assert series[0].start_datetime == datetime(2026, 9, 1, tzinfo=timezone.utc)

    async def test_an_open_occurrence_may_differ_freely(self):
        series = _drills(0, o2={"check_in_minutes_before": 30})

        count, _db = await _save_series(series, self._form_save(series[0]))

        assert count == 4
        assert series[2].check_in_minutes_before == 60

    async def test_a_finalized_fall_back_night_takes_a_title_fix_with_its_deadline(
        self,
    ):
        """1:00 CDT to 1:00 CST is an hour, but wall time drops the fold and
        reads it as none. The edit page sends a finalized event no times, only
        its RSVP deadline, so a length check against the stored pair refused a
        title fix over times nobody can edit."""
        night = datetime(2026, 11, 1, 6, 0, tzinfo=timezone.utc)
        series = _drills(
            0,
            o0={"start_datetime": night, "end_datetime": night + timedelta(hours=1)},
            o1={
                "start_datetime": night + timedelta(weeks=1, hours=1),
                "end_datetime": night + timedelta(weeks=1, hours=2),
            },
            o2={
                "start_datetime": night + timedelta(weeks=2, hours=1),
                "end_datetime": night + timedelta(weeks=2, hours=2),
            },
            o3={
                "start_datetime": night + timedelta(weeks=3, hours=1),
                "end_datetime": night + timedelta(weeks=3, hours=2),
            },
        )
        before = [(e.start_datetime, e.end_datetime) for e in series]

        count, db = await _save_series(
            series,
            EventUpdate.model_validate(
                {
                    "title": "Night drill (corrected)",
                    "requires_rsvp": True,
                    "rsvp_deadline": night - timedelta(days=1),
                }
            ),
        )

        assert count == 4
        assert {e.title for e in series} == {"Night drill (corrected)"}
        assert [(e.start_datetime, e.end_datetime) for e in series] == before
        assert series[0].rsvp_deadline == night - timedelta(days=1)
        db.commit.assert_awaited_once()


class TestSeriesSaveKeepsEachOccurrencesLifecycleMarkers:
    """custom_fields carries server-written lifecycle markers. The edit form
    echoes back what it loaded, and a series save writes the anchor's value
    onto every occurrence — so each occurrence must keep its own markers and
    take nobody else's."""

    CLOSED = {
        "attendance_finalized": True,
        "validation_notification_sent": True,
        "reminders_sent": [24],
    }

    def _form_save(self, series, **changes):
        """What the page sends from the anchor once the locked fields are
        stripped: descriptive fields plus the custom_fields it loaded."""
        body = {
            "title": series[0].title,
            "custom_fields": dict(series[0].custom_fields or {}),
        }
        body.update(changes)
        return EventUpdate.model_validate(body)

    async def test_a_closed_anchor_s_markers_do_not_lock_later_occurrences(self):
        series = _drills(0, o0={"custom_fields": {**self.CLOSED, "room": "Bay 2"}})

        count, _db = await _save_series(
            series, self._form_save(series, description="Bring SCBA.")
        )

        assert count == 4
        for later in series[1:]:
            assert attendance_is_finalized(later) is False
            assert later.custom_fields == {"room": "Bay 2"}
        assert series[0].custom_fields == {**self.CLOSED, "room": "Bay 2"}

    async def test_an_open_anchor_s_save_keeps_a_closed_occurrence_s_markers(self):
        series = _drills(
            2,
            o0={"custom_fields": {"reminders_sent": [48], "room": "Bay 2"}},
            o2={"custom_fields": dict(self.CLOSED)},
        )

        await _save_series(series, self._form_save(series))

        assert series[2].custom_fields == {**self.CLOSED, "room": "Bay 2"}
        assert attendance_is_finalized(series[2]) is True
        assert series[1].custom_fields == {"room": "Bay 2"}

    async def test_occurrences_do_not_share_one_dict(self):
        series = _drills(o0={"custom_fields": {"room": "Bay 2"}})

        await _save_series(series, self._form_save(series))

        assert len({id(e.custom_fields) for e in series}) == len(series)


class TestUpdateFutureEventsLockCount:
    """The series refusal counts the finalized occurrences the save would
    change, out of the finalized ones. It read "(2 of 4 occurrences have
    finalized attendance)" for a series with three finalized occurrences, two
    of them changed, which misstated both numbers."""

    def _series(self, *, finalized, require_checkout):
        closed = datetime(2026, 9, 1, tzinfo=timezone.utc)
        return [
            SimpleNamespace(
                id=str(uuid4()),
                is_cancelled=False,
                recurrence_parent_id="parent",
                start_datetime=datetime(2026, 9, 1 + 7 * i, 19, tzinfo=timezone.utc),
                end_datetime=datetime(2026, 9, 1 + 7 * i, 21, tzinfo=timezone.utc),
                attendance_finalized_at=closed if is_closed else None,
                custom_fields=None,
                require_checkout=checkout,
            )
            for i, (is_closed, checkout) in enumerate(zip(finalized, require_checkout))
        ]

    async def _refusal(self, series):
        db = AsyncMock()
        db.execute.side_effect = [_scalar(series[0]), _scalars(series)]
        with pytest.raises(ValueError, match=ATTENDANCE_LOCKED_PREFIX) as excinfo:
            await EventService(db).update_future_events(
                uuid4(), uuid4(), EventUpdate(require_checkout=False)
            )
        db.commit.assert_not_awaited()
        return str(excinfo.value)

    async def test_counts_changed_out_of_finalized(self):
        message = await self._refusal(
            self._series(
                finalized=[True, True, True, False],
                require_checkout=[False, True, True, True],
            )
        )
        assert (
            "across this series (2 of 3 finalized occurrences would change)" in message
        )

    async def test_a_single_finalized_occurrence_reads_in_the_singular(self):
        message = await self._refusal(
            self._series(
                finalized=[False, True, False],
                require_checkout=[False, True, True],
            )
        )
        assert (
            "across this series (1 of 1 finalized occurrence would change)" in message
        )

"""Shift, call, cohort-class and petition request times reach the model in UTC.

These times live in MySQL DATETIME columns, and the driver formats an aware
datetime by its wall clock, dropping the offset: a shift start sent as
``07:00-04:00`` was written as 07:00, read back as 07:00 UTC and shown four
hours early. A naive value meeting an aware one in a comparison raised
``TypeError``, which Pydantic does not turn into a 422, so a mixed pair was a
500. The schemas convert on the way in, through ``UTCDateTime``.

``shift_date`` is a calendar date and is deliberately left alone.
"""

from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

import pymysql.converters
import pytest
from pydantic import ValidationError

from app.schemas.course_cohort import (
    CohortAdHocClassCreate,
    CohortClassOverride,
    CohortClassReschedule,
    CohortMakeupCreate,
)
from app.schemas.event import AttendancePetitionApprove
from app.schemas.scheduling import (
    CloseoutAttendanceEntry,
    ShiftAttendanceCreate,
    ShiftAttendanceUpdate,
    ShiftCallCreate,
    ShiftCallUpdate,
    ShiftCreate,
    ShiftUpdate,
)

pytestmark = [pytest.mark.unit]

START_EDT = "2026-10-17T07:00:00-04:00"
END_EDT = "2026-10-17T19:00:00-04:00"
START_UTC = "'2026-10-17 11:00:00'"
END_UTC = "'2026-10-17 23:00:00'"

# 11:00 UTC naive against 06:00-04:00 (10:00 UTC): the end is before the start.
NAIVE_START = "2026-10-17T11:00:00"
AWARE_EARLIER_END = "2026-10-17T06:00:00-04:00"


def _stored(value: datetime | None) -> str:
    """What pymysql actually writes into the DATETIME column."""
    assert value is not None
    return pymysql.converters.escape_item(value, "utf8")


class TestShiftCreate:
    def test_offset_times_are_stored_as_the_utc_instant(self):
        data = ShiftCreate(
            shift_date="2026-10-17", start_time=START_EDT, end_time=END_EDT
        )

        assert _stored(data.start_time) == START_UTC
        assert _stored(data.end_time) == END_UTC

    def test_shift_date_stays_the_calendar_date_sent(self):
        # An overnight shift starting 22:00-04:00 is 02:00 UTC the next day;
        # the department's date for it is still the 17th.
        data = ShiftCreate(
            shift_date="2026-10-17",
            start_time="2026-10-17T22:00:00-04:00",
            end_time="2026-10-18T07:00:00-04:00",
        )

        assert data.shift_date == date(2026, 10, 17)
        assert _stored(data.start_time) == "'2026-10-18 02:00:00'"

    def test_naive_input_is_read_as_utc(self):
        data = ShiftCreate(shift_date="2026-10-17", start_time="2026-10-17T11:00:00")

        assert data.start_time.tzinfo is not None
        assert _stored(data.start_time) == START_UTC

    def test_mixed_pair_out_of_order_is_a_validation_error(self):
        with pytest.raises(ValidationError, match="end_time must be after"):
            ShiftCreate(
                shift_date="2026-10-17",
                start_time=NAIVE_START,
                end_time=AWARE_EARLIER_END,
            )


class TestShiftUpdate:
    def test_offset_times_are_stored_as_the_utc_instant(self):
        data = ShiftUpdate(start_time=START_EDT, end_time=END_EDT)

        assert _stored(data.start_time) == START_UTC
        assert _stored(data.end_time) == END_UTC

    def test_mixed_pair_out_of_order_is_a_validation_error(self):
        with pytest.raises(ValidationError, match="end_time must be after"):
            ShiftUpdate(start_time=NAIVE_START, end_time=AWARE_EARLIER_END)

    def test_explicit_null_survives(self):
        data = ShiftUpdate(end_time=None)

        assert data.end_time is None
        assert "end_time" in data.model_dump(exclude_unset=True)


class TestShiftAttendance:
    def test_create_offset_times_are_stored_as_the_utc_instant(self):
        data = ShiftAttendanceCreate(
            user_id=uuid4(), checked_in_at=START_EDT, checked_out_at=END_EDT
        )

        assert _stored(data.checked_in_at) == START_UTC
        assert _stored(data.checked_out_at) == END_UTC

    def test_create_mixed_pair_can_be_subtracted(self):
        # add_attendance subtracts the two to get duration_minutes; a naive and
        # an aware value there raised TypeError.
        data = ShiftAttendanceCreate(
            user_id=uuid4(), checked_in_at=NAIVE_START, checked_out_at=END_EDT
        )

        assert data.checked_in_at is not None
        assert data.checked_out_at is not None
        assert data.checked_out_at - data.checked_in_at == timedelta(hours=12)

    def test_update_offset_times_are_stored_as_the_utc_instant(self):
        data = ShiftAttendanceUpdate(checked_in_at=START_EDT, checked_out_at=END_EDT)

        assert _stored(data.checked_in_at) == START_UTC
        assert _stored(data.checked_out_at) == END_UTC

    def test_update_lone_naive_value_meets_a_stored_aware_one(self):
        # update_attendance subtracts against the stored value, which the ORM
        # load hook stamps UTC.
        data = ShiftAttendanceUpdate(checked_out_at="2026-10-17T23:00:00")

        stored_in = datetime(2026, 10, 17, 11, 0, tzinfo=timezone.utc)
        assert data.checked_out_at is not None
        assert data.checked_out_at - stored_in == timedelta(hours=12)


class TestCloseoutAttendanceEntry:
    def test_offset_times_are_stored_as_the_utc_instant(self):
        data = CloseoutAttendanceEntry(
            user_id=uuid4(), checked_in_at=START_EDT, checked_out_at=END_EDT
        )

        assert _stored(data.checked_in_at) == START_UTC
        assert _stored(data.checked_out_at) == END_UTC

    def test_mixed_pair_out_of_order_is_a_validation_error(self):
        with pytest.raises(ValidationError, match="cannot leave before"):
            CloseoutAttendanceEntry(
                user_id=uuid4(),
                checked_in_at=NAIVE_START,
                checked_out_at=AWARE_EARLIER_END,
            )


class TestShiftCall:
    def test_create_offset_times_are_stored_as_the_utc_instant(self):
        data = ShiftCallCreate(
            incident_type="fire",
            dispatched_at=START_EDT,
            on_scene_at="2026-10-17T07:08:00-04:00",
            cleared_at=END_EDT,
        )

        assert _stored(data.dispatched_at) == START_UTC
        assert _stored(data.on_scene_at) == "'2026-10-17 11:08:00'"
        assert _stored(data.cleared_at) == END_UTC

    def test_update_offset_times_are_stored_as_the_utc_instant(self):
        data = ShiftCallUpdate(
            dispatched_at=START_EDT,
            on_scene_at="2026-10-17T07:08:00-04:00",
            cleared_at=END_EDT,
        )

        assert _stored(data.dispatched_at) == START_UTC
        assert _stored(data.on_scene_at) == "'2026-10-17 11:08:00'"
        assert _stored(data.cleared_at) == END_UTC


class TestCohortClassOverride:
    def test_offset_times_are_stored_as_the_utc_instant(self):
        data = CohortClassOverride(
            course_class_id=uuid4(), scheduled_start=START_EDT, scheduled_end=END_EDT
        )

        assert _stored(data.scheduled_start) == START_UTC
        assert _stored(data.scheduled_end) == END_UTC

    def test_mixed_pair_out_of_order_is_a_validation_error(self):
        with pytest.raises(ValidationError, match="scheduled_end must be after"):
            CohortClassOverride(
                course_class_id=uuid4(),
                scheduled_start=NAIVE_START,
                scheduled_end=AWARE_EARLIER_END,
            )


class TestCohortClassReschedule:
    def test_offset_times_are_stored_as_the_utc_instant(self):
        data = CohortClassReschedule(scheduled_start=START_EDT, scheduled_end=END_EDT)

        assert _stored(data.scheduled_start) == START_UTC
        assert _stored(data.scheduled_end) == END_UTC

    def test_mixed_pair_out_of_order_is_a_validation_error(self):
        with pytest.raises(ValidationError, match="scheduled_end must be after"):
            CohortClassReschedule(
                scheduled_start=NAIVE_START, scheduled_end=AWARE_EARLIER_END
            )


class TestCohortAdHocClassCreate:
    BASE = {"title": "Make-up", "class_course_id": str(uuid4())}

    def test_offset_times_are_stored_as_the_utc_instant(self):
        data = CohortAdHocClassCreate(
            **self.BASE, scheduled_start=START_EDT, scheduled_end=END_EDT
        )

        assert _stored(data.scheduled_start) == START_UTC
        assert _stored(data.scheduled_end) == END_UTC

    def test_mixed_pair_out_of_order_is_a_validation_error(self):
        with pytest.raises(ValidationError, match="scheduled_end must be after"):
            CohortAdHocClassCreate(
                **self.BASE,
                scheduled_start=NAIVE_START,
                scheduled_end=AWARE_EARLIER_END,
            )


class TestCohortMakeupCreate:
    def test_offset_times_are_stored_as_the_utc_instant(self):
        data = CohortMakeupCreate(scheduled_start=START_EDT, scheduled_end=END_EDT)

        assert _stored(data.scheduled_start) == START_UTC
        assert _stored(data.scheduled_end) == END_UTC

    def test_mixed_pair_out_of_order_is_a_validation_error(self):
        with pytest.raises(ValidationError, match="scheduled_end must be after"):
            CohortMakeupCreate(
                scheduled_start=NAIVE_START, scheduled_end=AWARE_EARLIER_END
            )


class TestAttendancePetitionApprove:
    def test_offset_times_are_stored_as_the_utc_instant(self):
        data = AttendancePetitionApprove(check_in_at=START_EDT, check_out_at=END_EDT)

        assert _stored(data.check_in_at) == START_UTC
        assert _stored(data.check_out_at) == END_UTC

    def test_mixed_pair_out_of_order_is_a_validation_error(self):
        with pytest.raises(ValidationError, match="Check-out time must be after"):
            AttendancePetitionApprove(
                check_in_at=NAIVE_START, check_out_at=AWARE_EARLIER_END
            )

"""Event request times reach the model in UTC, whatever offset was sent.

Event and RSVP times live in MySQL DATETIME columns, and the driver formats
an aware datetime by its wall clock, dropping the offset: a start sent as
``18:00-04:00`` was written as 18:00, read back as 18:00 UTC and shown four
hours early. A naive value meeting an aware one in a comparison raised
``TypeError``, which Pydantic does not turn into a 422, so a mixed pair was a
500. The schemas convert on the way in, through ``app.schemas.base.as_utc``.
"""

from datetime import datetime, timedelta, timezone

import pymysql.converters
import pytest
from pydantic import ValidationError

from app.schemas.event import (
    EventCreate,
    EventUpdate,
    RecordActualTimes,
    RSVPOverride,
)

pytestmark = [pytest.mark.unit]

EDT = timezone(timedelta(hours=-4))

EVENT = {"title": "Business meeting", "event_type": "business_meeting"}


def _stored(value: datetime | None) -> str:
    """What pymysql actually writes into the DATETIME column."""
    assert value is not None
    return pymysql.converters.escape_item(value, "utf8")


class TestEventCreate:
    def test_offset_times_are_stored_as_the_utc_instant(self):
        data = EventCreate(
            **EVENT,
            start_datetime="2026-10-17T18:00:00-04:00",
            end_datetime="2026-10-17T20:00:00-04:00",
            requires_rsvp=True,
            rsvp_deadline="2026-10-16T18:00:00-04:00",
        )

        assert data.start_datetime.utcoffset() == timedelta(0)
        assert _stored(data.start_datetime) == "'2026-10-17 22:00:00'"
        assert _stored(data.end_datetime) == "'2026-10-18 00:00:00'"
        assert _stored(data.rsvp_deadline) == "'2026-10-16 22:00:00'"

    def test_utc_input_is_unchanged(self):
        data = EventCreate(
            **EVENT,
            start_datetime="2026-10-17T22:00:00Z",
            end_datetime="2026-10-18T00:00:00Z",
        )

        assert _stored(data.start_datetime) == "'2026-10-17 22:00:00'"
        assert _stored(data.end_datetime) == "'2026-10-18 00:00:00'"

    def test_naive_input_is_read_as_utc(self):
        data = EventCreate(
            **EVENT,
            start_datetime="2026-10-17T22:00:00",
            end_datetime=datetime(2026, 10, 17, 20, 0, tzinfo=EDT),
        )

        assert data.start_datetime.tzinfo is not None
        assert _stored(data.start_datetime) == "'2026-10-17 22:00:00'"
        assert _stored(data.end_datetime) == "'2026-10-18 00:00:00'"

    def test_mixed_pair_out_of_order_is_a_validation_error(self):
        # 22:00 UTC naive vs 17:00-04:00 (21:00 UTC): end before start.
        with pytest.raises(ValidationError, match="end_datetime must be after"):
            EventCreate(
                **EVENT,
                start_datetime="2026-10-17T22:00:00",
                end_datetime="2026-10-17T17:00:00-04:00",
            )


class TestEventUpdate:
    def test_offset_times_are_stored_as_the_utc_instant(self):
        data = EventUpdate(
            start_datetime="2026-10-17T18:00:00-04:00",
            end_datetime="2026-10-17T20:00:00-04:00",
            rsvp_deadline="2026-10-16T18:00:00-04:00",
        )

        assert _stored(data.start_datetime) == "'2026-10-17 22:00:00'"
        assert _stored(data.end_datetime) == "'2026-10-18 00:00:00'"
        assert _stored(data.rsvp_deadline) == "'2026-10-16 22:00:00'"

    def test_a_lone_naive_start_is_aware_for_the_service_comparison(self):
        # The service compares a lone start against the stored end, which the
        # ORM load hook stamps UTC; a naive start there was a TypeError.
        data = EventUpdate(start_datetime="2026-10-17T22:00:00")

        stored_end = datetime(2026, 10, 18, 0, 0, tzinfo=timezone.utc)
        assert data.start_datetime is not None
        assert data.start_datetime < stored_end

    def test_mixed_pair_out_of_order_is_a_validation_error(self):
        with pytest.raises(ValidationError, match="end_datetime must be after"):
            EventUpdate(
                start_datetime="2026-10-17T22:00:00",
                end_datetime="2026-10-17T17:00:00-04:00",
            )

    def test_explicit_null_survives(self):
        data = EventUpdate(rsvp_deadline=None)

        assert data.rsvp_deadline is None
        assert "rsvp_deadline" in data.model_dump(exclude_unset=True)


class TestRSVPOverride:
    def test_offset_times_are_stored_as_the_utc_instant(self):
        data = RSVPOverride(
            override_check_in_at="2026-10-17T18:00:00-04:00",
            override_check_out_at="2026-10-17T20:00:00-04:00",
        )

        assert _stored(data.override_check_in_at) == "'2026-10-17 22:00:00'"
        assert _stored(data.override_check_out_at) == "'2026-10-18 00:00:00'"

    def test_mixed_pair_is_comparable(self):
        # The service refuses check-out <= check-in with a 400; on a mixed pair
        # that comparison raised TypeError, a 500.
        data = RSVPOverride(
            override_check_in_at="2026-10-17T22:00:00",
            override_check_out_at="2026-10-17T17:00:00-04:00",
        )

        assert data.override_check_in_at is not None
        assert data.override_check_out_at is not None
        assert data.override_check_out_at <= data.override_check_in_at


class TestRecordActualTimes:
    def test_offset_times_are_stored_as_the_utc_instant(self):
        data = RecordActualTimes(
            actual_start_time="2026-10-17T18:00:00-04:00",
            actual_end_time="2026-10-17T20:00:00-04:00",
        )

        assert _stored(data.actual_start_time) == "'2026-10-17 22:00:00'"
        assert _stored(data.actual_end_time) == "'2026-10-18 00:00:00'"

    def test_mixed_pair_is_comparable(self):
        data = RecordActualTimes(
            actual_start_time="2026-10-17T22:00:00",
            actual_end_time="2026-10-17T17:00:00-04:00",
        )

        assert data.actual_start_time is not None
        assert data.actual_end_time is not None
        assert data.actual_end_time <= data.actual_start_time

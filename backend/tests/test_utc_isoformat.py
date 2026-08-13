"""
API timestamp serialization tests.

Timestamps are stored as UTC, but MySQL hands them back as naive datetimes;
serializing those with a bare .isoformat() emits no offset, and JavaScript's
`new Date()` then reads the UTC wall-clock as *local* time — the Error
Monitoring page showed UTC to every member. `utc_isoformat` pins the offset.
"""

from datetime import datetime, timedelta, timezone

from app.core.utils import utc_isoformat


class TestUtcIsoformat:
    def test_none_stays_none(self):
        assert utc_isoformat(None) is None

    def test_naive_datetime_is_marked_utc(self):
        # The MySQL-driver case: stored UTC, returned naive.
        dt = datetime(2026, 8, 13, 0, 15, 0)
        assert utc_isoformat(dt) == "2026-08-13T00:15:00+00:00"

    def test_aware_utc_datetime_keeps_offset(self):
        dt = datetime(2026, 8, 13, 0, 15, 0, tzinfo=timezone.utc)
        assert utc_isoformat(dt) == "2026-08-13T00:15:00+00:00"

    def test_aware_non_utc_datetime_is_converted(self):
        eastern = timezone(timedelta(hours=-4))
        dt = datetime(2026, 8, 12, 20, 15, 0, tzinfo=eastern)
        assert utc_isoformat(dt) == "2026-08-13T00:15:00+00:00"

    def test_output_parses_unambiguously_in_javascript_terms(self):
        # The string must carry an explicit offset — that is the entire point.
        out = utc_isoformat(datetime(2026, 8, 13, 0, 15, 0))
        assert out is not None
        assert out.endswith("+00:00")

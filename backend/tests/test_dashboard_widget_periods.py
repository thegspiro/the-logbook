from datetime import date, datetime, timezone

import pytest

from app.services.dashboard_widget_service import PERIOD_LABELS, period_bounds


@pytest.mark.parametrize(
    ("period", "expected"),
    [
        ("month", date(2026, 8, 1)),
        ("quarter", date(2026, 7, 1)),
        ("year", date(2026, 1, 1)),
        ("rolling_30", date(2026, 7, 23)),
    ],
)
def test_period_bounds_include_today_and_use_exclusive_tomorrow(period, expected):
    start, end = period_bounds(period, date(2026, 8, 21))
    assert start == datetime.combine(expected, datetime.min.time(), timezone.utc)
    assert end == datetime(2026, 8, 22, tzinfo=timezone.utc)


def test_period_labels_cover_every_allowed_period():
    assert set(PERIOD_LABELS) == {"month", "quarter", "year", "rolling_30"}

"""
Tests for the event analytics summary
(app/services/event_service.py :: get_analytics_summary).

The aggregation SQL needs a database, but the per-query Python math and
shaping (attendance/check-in rates, avg check-in lead time, type
distribution, monthly buckets, and top-events attendance rate) are tested
here by mocking the six query results in order. DB mocked; no MySQL.
"""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.models.event import EventType
from app.services.event_service import EventService


def _scalar(value):
    return MagicMock(scalar=MagicMock(return_value=value))


def _one(row):
    return MagicMock(one=MagicMock(return_value=row))


def _rows(rows):
    return MagicMock(all=MagicMock(return_value=rows))


def _db(side_effect):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=side_effect)
    return db


def _full_db():
    """A db whose six executes return a representative analytics dataset."""
    agg_row = SimpleNamespace(total_rsvps=20, going_count=16, checked_in_count=12)
    type_rows = [
        SimpleNamespace(event_type=EventType.TRAINING, cnt=5),
        SimpleNamespace(event_type=EventType.SOCIAL, cnt=3),
    ]
    month_rows = [
        SimpleNamespace(yr=2026, mo=1, cnt=4),
        SimpleNamespace(yr=2026, mo=2, cnt=6),
    ]
    top_rows = [
        SimpleNamespace(
            event_id="e1",
            title="FF1 Drill",
            event_type=EventType.TRAINING,
            start_datetime=datetime(2026, 1, 10, 19, 0),
            going_count=10,
            checked_in_count=8,
        )
    ]
    return _db(
        [
            _scalar(10),  # total events
            _one(agg_row),  # rsvp/checkin aggregates
            _scalar(900),  # avg seconds before start (15 min)
            _rows(type_rows),  # type distribution
            _rows(month_rows),  # monthly counts
            _rows(top_rows),  # top events
        ]
    )


class TestAnalyticsSummary:
    async def test_rates_and_lead_time(self):
        out = await EventService(_full_db()).get_analytics_summary("org-1")
        assert out["total_events"] == 10
        assert out["total_rsvps"] == 20
        assert out["total_checked_in"] == 12
        # checked_in / going = 12/16, checked_in / rsvps = 12/20
        assert out["avg_attendance_rate"] == 0.75
        assert out["check_in_rate"] == 0.6
        # 900 seconds / 60 = 15.0 minutes before start
        assert out["avg_checkin_minutes_before"] == 15.0

    async def test_distribution_and_monthly_shaping(self):
        out = await EventService(_full_db()).get_analytics_summary("org-1")
        assert out["event_type_distribution"] == [
            {"event_type": "training", "count": 5},
            {"event_type": "social", "count": 3},
        ]
        assert out["monthly_event_counts"] == [
            {"month": "2026-01", "count": 4},
            {"month": "2026-02", "count": 6},
        ]

    async def test_top_events_attendance_rate(self):
        out = await EventService(_full_db()).get_analytics_summary("org-1")
        top = out["top_events"][0]
        assert top["event_id"] == "e1"
        assert top["going_count"] == 10
        assert top["checked_in_count"] == 8
        assert top["attendance_rate"] == 0.8
        assert top["event_type"] == "training"

    async def test_zero_division_guards(self):
        # No going RSVPs and no check-in times -> rates 0.0, lead time None.
        agg_row = SimpleNamespace(total_rsvps=0, going_count=0, checked_in_count=0)
        db = _db(
            [
                _scalar(0),  # total events
                _one(agg_row),  # aggregates all zero
                _scalar(None),  # no avg seconds
                _rows([]),  # no types
                _rows([]),  # no months
                _rows([]),  # no top events
            ]
        )
        out = await EventService(db).get_analytics_summary("org-1")
        assert out["avg_attendance_rate"] == 0.0
        assert out["check_in_rate"] == 0.0
        assert out["avg_checkin_minutes_before"] is None
        assert out["top_events"] == []


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))

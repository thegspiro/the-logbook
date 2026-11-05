"""Scheduling-widget window, lifecycle, and configuration regressions."""

from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.services.scheduling_widget_service import (
    SchedulingWidgetService,
    organization_window,
)


def _rows(items):
    result = MagicMock()
    result.scalars.return_value.all.return_value = items
    return result


def test_day_bounds_follow_dst_instead_of_assuming_24_hours():
    spring_start, spring_end = organization_window(
        "America/New_York", date(2026, 3, 8), date(2026, 3, 8)
    )
    fall_start, fall_end = organization_window(
        "America/New_York", date(2026, 11, 1), date(2026, 11, 1)
    )
    assert (spring_end - spring_start).total_seconds() == 23 * 3600
    assert (fall_end - fall_start).total_seconds() == 25 * 3600


async def test_disabled_scheduling_returns_zero_without_reading_shifts():
    db = MagicMock()
    db.get = AsyncMock(
        return_value=SimpleNamespace(
            timezone="America/Chicago", settings={"modules": {"scheduling": False}}
        )
    )
    db.execute = AsyncMock()
    result = await SchedulingWidgetService(db).summarize(
        "org-1", date(2026, 8, 21), date(2026, 8, 27)
    )
    assert result["scheduling_enabled"] is False
    assert result["open_slots"] == 0
    db.execute.assert_not_awaited()


async def test_overnight_shift_counts_for_today_and_finalized_shift_is_closed():
    db = MagicMock()
    db.get = AsyncMock(
        return_value=SimpleNamespace(timezone="UTC", settings={"modules": {}})
    )
    overnight = SimpleNamespace(
        id="shift-1",
        # MySQL commonly returns timezone-aware columns as naive UTC values.
        start_time=datetime(2026, 8, 20, 22),
        end_time=datetime(2026, 8, 21, 8),
        positions=[{"position": "officer", "required": True}],
        min_staffing=1,
        is_finalized=True,
        activities={},
    )
    assignment = SimpleNamespace(
        shift_id="shift-1",
        user_id="user-1",
        assignment_status="assigned",
    )
    db.execute = AsyncMock(side_effect=[_rows([overnight]), _rows([assignment])])
    result = await SchedulingWidgetService(db).summarize(
        "org-1", date(2026, 8, 21), date(2026, 8, 21)
    )
    assert result["today_staffing"] == 1
    assert result["incomplete_closeouts"] == 0
    assert result["open_slots"] == 0


async def test_widget_preferences_offer_only_filters_the_department_has():
    """The dashboard picks a station or platoon from this list, not free text.

    A typed value the department has no shifts for is refused on save, so the
    form must be told which values exist.
    """
    from app.api.v1.endpoints.scheduling import get_scheduling_widget_preferences

    db = MagicMock()
    db.execute = AsyncMock(
        side_effect=[_rows(["station-2", "station-1"]), _rows(["B", "A"])]
    )
    user = SimpleNamespace(
        organization_id="org-1",
        notification_preferences={
            "scheduling_dashboard_widgets": {
                "open_slots": {"platoon": "A", "station_id": "gone", "horizon_days": 7}
            }
        },
    )

    result = await get_scheduling_widget_preferences(db=db, current_user=user)

    assert result["available_station_ids"] == ["station-1", "station-2"]
    assert result["available_platoons"] == ["A", "B"]
    assert result["widgets"] == {"open_slots": {"platoon": "A", "horizon_days": 7}}

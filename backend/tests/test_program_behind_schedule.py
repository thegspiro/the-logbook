"""
The program-progress "behind schedule" heuristic.

An enrollment is behind when the share of the cycle already gone exceeds its
recorded progress by more than 20 points. ``progress_percentage`` is nullable,
and a row that never recorded one used to raise ``TypeError`` (``None + 20``),
failing the member's whole progress view.
"""

from datetime import date

import pytest

from app.api.v1.endpoints.training_programs import _is_behind_schedule

CYCLE_START = date(2026, 1, 1)
TARGET = date(2026, 1, 11)  # a ten day cycle, so one day is ten percent


def _behind(day: int, progress):
    return _is_behind_schedule(
        today=date(2026, 1, day),
        cycle_start=CYCLE_START,
        target_completion_date=TARGET,
        progress_percentage=progress,
    )


@pytest.mark.unit
class TestIsBehindSchedule:
    def test_missing_progress_counts_as_none_made(self):
        assert _behind(6, None) is True  # 50% of the time gone, 0% done

    def test_missing_progress_early_in_the_cycle_is_not_behind(self):
        assert _behind(2, None) is False  # 10% gone, within the 20 point margin

    def test_progress_matching_elapsed_time_is_on_track(self):
        assert _behind(6, 50.0) is False

    def test_exactly_the_margin_is_not_behind(self):
        assert _behind(6, 30.0) is False  # 50 == 30 + 20

    def test_over_the_margin_is_behind(self):
        assert _behind(6, 29.0) is True

    def test_a_cycle_with_no_length_is_never_behind(self):
        assert (
            _is_behind_schedule(
                today=date(2026, 1, 5),
                cycle_start=TARGET,
                target_completion_date=TARGET,
                progress_percentage=0.0,
            )
            is False
        )

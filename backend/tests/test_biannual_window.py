"""BIANNUAL ("Every 2 Years") requirements are graded over a two-year window.

They used to have no window in the compliance evaluators, so hours, shifts and
calls counted from a member's whole history; the competency matrix used two
calendar years; and the scheduling compliance report read "biannual" as two
six-month periods a year. One definition now (owner decision
BIANNUAL-window, CLAUDE.md pitfall 29).
"""

from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.models.training import RequirementFrequency, TrainingStatus
from app.services.competency_matrix_service import CompetencyMatrixService
from app.services.scheduling_service import SchedulingService
from app.services.training_compliance import (
    biannual_window,
    evaluate_member_requirement_detail,
    get_requirement_date_window,
)
from app.services.training_service import TrainingService

pytestmark = pytest.mark.unit

TODAY = date(2026, 6, 15)


def _req(**kw):
    defaults = dict(
        id="req-1",
        name="Biannual hours",
        requirement_type=SimpleNamespace(value="hours"),
        frequency=RequirementFrequency.BIANNUAL,
        due_date_type=None,
        rolling_period_months=None,
        period_start_month=None,
        period_start_day=None,
        period_end_month=None,
        period_end_day=None,
        year=None,
        required_hours=10.0,
        training_type=None,
        category_ids=None,
        required_courses=None,
        include_current_month=None,
        recency_months=None,
    )
    defaults.update(kw)
    return SimpleNamespace(**defaults)


def _record(hours, completed):
    return SimpleNamespace(
        id=f"rec-{completed}",
        course_id=None,
        course_name="Course",
        training_type=SimpleNamespace(value="continuing_education"),
        status=TrainingStatus.COMPLETED,
        completion_date=completed,
        expiration_date=None,
        hours_completed=hours,
        credit_hours=hours,
        category_ids=None,
    )


class TestOneDefinition:
    @pytest.mark.parametrize("year", [None, 2024])
    def test_every_caller_grades_the_same_window(self, year):
        req = _req(year=year)
        expected = biannual_window(req, TODAY)
        assert get_requirement_date_window(req, TODAY) == expected
        assert TrainingService._get_date_window(req, TODAY) == expected
        assert CompetencyMatrixService._get_date_window(req, TODAY) == expected
        assert (
            SchedulingService(MagicMock())._compute_period_bounds(req, TODAY)
            == expected
        )

    def test_the_window_is_this_year_and_last(self):
        assert biannual_window(_req(), TODAY) == (date(2025, 1, 1), date(2026, 12, 31))


class TestHoursOutsideTheWindowNoLongerCount:
    def test_three_year_old_hours_do_not_meet_it(self):
        req = _req()
        ev = evaluate_member_requirement_detail(
            req, [_record(12.0, date(2023, 5, 1))], TODAY
        )
        assert ev.status != TrainingStatus.COMPLETED.value

    def test_hours_inside_the_window_do(self):
        req = _req()
        ev = evaluate_member_requirement_detail(
            req, [_record(12.0, date(2025, 5, 1))], TODAY
        )
        assert ev.status == TrainingStatus.COMPLETED.value

"""The competency matrix grades every requirement with the shared grader.

It used to grade hours, courses, certifications, calls and record-counted
shifts with its own rules: no rolling or custom-annual window, no category
filter, a calls target met by one record, and partial progress counted in
readiness (review finding of 2026-11-21, CLAUDE.md pitfall #29). Each cell now
maps ``evaluate_member_requirement_detail``'s status to the heat map's
vocabulary; only the 90-day "expiring soon" overlay is its own. No database.
"""

from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.services.competency_matrix_service import CompetencyMatrixService
from app.services.training_compliance import evaluate_member_requirement_detail
from tests.test_requirement_detail_agrees_with_grader import _record, _req

pytestmark = pytest.mark.unit

TODAY = date(2026, 2, 10)
_EXPECTED = {
    "completed": {"current", "expiring_soon"},
    "in_progress": {"in_progress"},
    "not_started": {"not_started"},
    "expired": {"expired"},
}


def _cell(req, records, today=TODAY):
    return CompetencyMatrixService(MagicMock())._evaluate_requirement_status(
        req, records, today, today + timedelta(days=90)
    )


def _graded(req, records, today=TODAY):
    return evaluate_member_requirement_detail(req, records, today).status


class TestTheReportedCases:
    def test_a_rolling_requirement_reads_its_rolling_window(self):
        req = _req(due_date_type="rolling", rolling_period_months=12)
        records = [_record(hours_completed=24.0, completion_date=date(2025, 8, 15))]
        assert _graded(req, records) == "completed"
        assert _cell(req, records)["status"] == "current"

    def test_one_call_does_not_meet_a_twelve_call_target(self):
        req = _req(requirement_type=SimpleNamespace(value="calls"), required_calls=12)
        records = [_record(completion_date=date(2026, 1, 20))]
        assert _graded(req, records) == "in_progress"
        assert _cell(req, records)["status"] == "in_progress"

    def test_a_category_scoped_requirement_ignores_other_categories(self):
        req = _req(category_ids=["ems"])
        records = [
            _record(
                category_id="fire",
                hours_completed=30.0,
                completion_date=date(2026, 1, 20),
            )
        ]
        assert _graded(req, records) == "not_started"
        assert _cell(req, records)["status"] == "not_started"


class TestReadiness:
    def test_partial_progress_is_not_counted_ready(self):
        """Readiness counts current and expiring-soon cells; a member part
        way to a target is neither."""
        req = _req()
        records = [_record(hours_completed=6.0, completion_date=date(2026, 1, 20))]
        assert _cell(req, records)["status"] == "in_progress"


_CASES = {
    "hours met": (
        _req(),
        [_record(hours_completed=30.0, completion_date=date(2026, 1, 5))],
    ),
    "hours none": (_req(), []),
    "courses short": (
        _req(
            requirement_type=SimpleNamespace(value="courses"),
            required_courses=["c1", "c2"],
        ),
        [_record(course_id="c1", completion_date=date(2026, 1, 5))],
    ),
    "certification current": (
        _req(requirement_type=SimpleNamespace(value="certification"), name="EMT"),
        [
            _record(
                course_name="EMT",
                completion_date=date(2025, 6, 1),
                expiration_date=date(2027, 6, 1),
            )
        ],
    ),
    "certification lapsed": (
        _req(requirement_type=SimpleNamespace(value="certification"), name="EMT"),
        [
            _record(
                course_name="EMT",
                completion_date=date(2024, 1, 1),
                expiration_date=date(2026, 1, 1),
            )
        ],
    ),
    "custom annual window": (
        _req(period_start_month=7, period_end_month=6),
        [_record(hours_completed=30.0, completion_date=date(2025, 9, 1))],
    ),
}


@pytest.mark.parametrize("case", sorted(_CASES))
def test_cell_agrees_with_the_grader(case):
    req, records = _CASES[case]
    assert _cell(req, records)["status"] in _EXPECTED[_graded(req, records)]

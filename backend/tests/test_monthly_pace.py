"""
The average hours a month an HOURS requirement reports beside its total.

My Training and the compliance matrix both show it, so both evaluators report
the one ``monthly_pace`` figure rather than each screen working it out
(CLAUDE.md pitfall 29). The grade is still decided on the total; these tests
pin that the average is reported and leaves the status alone.
"""

from datetime import date
from types import SimpleNamespace

import pytest

from app.services.training_compliance import (
    evaluate_member_requirement_detail,
    monthly_pace,
)
from app.services.training_service import TrainingService
from app.services.training_waiver_service import WaiverPeriod
from tests.test_training_compliance import _make_record, _make_requirement

pytestmark = [pytest.mark.unit]

# An annual (calendar-year) window evaluated on Sep 5 has nine months so far,
# January through September.
TODAY = date(2026, 9, 5)

RECORDS = [
    _make_record(id="rec-mar", completion_date=date(2026, 3, 15), hours_completed=8.0),
    _make_record(id="rec-jun", completion_date=date(2026, 6, 10), hours_completed=10.0),
]

JUNE_JULY_LEAVE = [
    WaiverPeriod(
        start_date=date(2026, 6, 1),
        end_date=date(2026, 7, 31),
        requirement_ids=None,
    )
]


def _both(req, records, waivers=None):
    """(My Training's detail, the compliance matrix's evaluation)."""
    detail = TrainingService.evaluate_requirement_detail(
        req, records, TODAY, waivers=waivers
    )
    ev = evaluate_member_requirement_detail(req, records, TODAY, waivers=waivers)
    return detail, ev


class TestMonthlyPace:
    def test_averages_every_month_so_far_including_empty_ones(self):
        rows = [
            {"month": "2026-01", "hours": 6.0, "waived": False},
            {"month": "2026-02", "hours": 0.0, "waived": False},
            {"month": "2026-03", "hours": 3.0, "waived": False},
        ]
        pace = monthly_pace(rows, 72.0, date(2026, 1, 1), date(2026, 12, 31))
        assert pace.average == 3.0
        assert pace.needed == 6.0

    def test_excused_months_and_their_hours_are_left_out(self):
        """26 hours, 23 of them on leave, is a pace of 3, not 13."""
        rows = [
            {"month": "2026-01", "hours": 3.0, "waived": False},
            {"month": "2026-02", "hours": 23.0, "waived": True},
        ]
        pace = monthly_pace(rows, 24.0, date(2026, 1, 1), date(2026, 12, 31))
        assert pace.average == 3.0

    def test_no_average_when_every_month_was_excused(self):
        rows = [{"month": "2026-01", "hours": 4.0, "waived": True}]
        pace = monthly_pace(rows, 24.0, date(2026, 1, 1), date(2026, 12, 31))
        assert pace.average is None
        assert pace.needed == 2.0

    def test_no_pace_without_a_target_or_a_window(self):
        rows = [{"month": "2026-01", "hours": 4.0, "waived": False}]
        assert (
            monthly_pace(rows, 0, date(2026, 1, 1), date(2026, 12, 31)).needed is None
        )
        assert monthly_pace(rows, 24.0, None, None).needed is None


class TestBothScreensReportOneAverage:
    def test_hours_requirement(self):
        detail, ev = _both(_make_requirement(required_hours=24.0), RECORDS)
        # 18 hours over January-September.
        assert detail["monthly_average"] == ev.monthly_average == 2.0
        assert detail["monthly_needed"] == ev.monthly_needed == 2.0

    def test_leave_months_are_excluded_on_both(self):
        detail, ev = _both(
            _make_requirement(required_hours=24.0), RECORDS, JUNE_JULY_LEAVE
        )
        # June's 10 hours were earned on leave: 8 hours over 7 active months.
        assert detail["monthly_average"] == ev.monthly_average == 1.14
        # The department's pace, not the leave-prorated target's.
        assert detail["monthly_needed"] == ev.monthly_needed == 2.0

    def test_status_is_still_graded_on_the_total(self):
        """Behind pace every month but over the total: still met."""
        records = [
            _make_record(completion_date=date(2026, 1, 20), hours_completed=30.0)
        ]
        detail, ev = _both(_make_requirement(required_hours=24.0), records)
        assert ev.status == "completed"
        assert detail["is_met"] is True
        assert ev.monthly_average == round(30.0 / 9, 2)

    def test_non_hours_requirements_report_no_average(self):
        req = _make_requirement(
            requirement_type=SimpleNamespace(value="courses"),
            required_hours=None,
            required_courses=["c1"],
        )
        detail, ev = _both(req, [_make_record(course_id="c1")])
        assert detail["monthly_average"] is None
        assert ev.monthly_average is None
        assert ev.monthly_needed is None

"""
Tests for Training Compliance Calculations

Tests cover the pure calculation logic in:
- TrainingService._get_date_window() — date window for evaluation periods
- TrainingService.evaluate_requirement_detail() — per-requirement evaluation
- training_waiver_service — waiver adjustment helpers

All tests run without a database by using mock requirement/record objects.
"""

import pytest
from datetime import date, timedelta
from types import SimpleNamespace

from app.services.training_service import TrainingService
from app.services.training_waiver_service import (
    WaiverPeriod,
    count_waived_months,
    total_months_in_period,
    adjust_required,
)


# ---------------------------------------------------------------------------
# Helpers to build lightweight mock objects
# ---------------------------------------------------------------------------

def _make_requirement(**kwargs):
    """Build a mock requirement with sensible defaults."""
    defaults = {
        "id": "req-1",
        "name": "Test Requirement",
        "description": "A test requirement",
        "requirement_type": SimpleNamespace(value="hours"),
        "training_type": None,
        "frequency": SimpleNamespace(value="annual"),
        "year": None,
        "due_date_type": None,
        "rolling_period_months": None,
        "required_hours": 24.0,
        "required_courses": None,
        "required_shifts": None,
        "required_calls": None,
        "required_call_types": None,
        "required_skills": None,
        "checklist_items": None,
        "passing_score": None,
        "max_attempts": None,
        "category_ids": None,
        "applies_to_all": True,
        "required_roles": None,
        "required_positions": None,
        "start_date": None,
        "due_date": None,
        "time_limit_days": None,
        "active": True,
        "registry_code": None,
        "registry_name": None,
    }
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def _make_record(**kwargs):
    """Build a mock training record."""
    from app.models.training import TrainingStatus
    defaults = {
        "id": "rec-1",
        "user_id": "user-1",
        "organization_id": "org-1",
        "course_id": None,
        "course_name": "Test Course",
        "course_code": "TC-101",
        "training_type": SimpleNamespace(value="continuing_education"),
        "status": TrainingStatus.COMPLETED,
        "completion_date": date(2026, 3, 15),
        "expiration_date": None,
        "hours_completed": 8.0,
        "credit_hours": 8.0,
        "certification_number": None,
        "issuing_agency": None,
    }
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


# =====================================================
# 1. _get_date_window tests
# =====================================================


class TestGetDateWindow:
    """Test TrainingService._get_date_window static method."""

    def test_annual_default(self):
        req = _make_requirement(frequency=SimpleNamespace(value="annual"))
        start, end = TrainingService._get_date_window(req, date(2026, 6, 15))
        assert start == date(2026, 1, 1)
        assert end == date(2026, 12, 31)

    def test_annual_with_year(self):
        req = _make_requirement(
            frequency=SimpleNamespace(value="annual"), year=2025
        )
        start, end = TrainingService._get_date_window(req, date(2026, 6, 15))
        assert start == date(2025, 1, 1)
        assert end == date(2025, 12, 31)

    def test_quarterly_q1(self):
        req = _make_requirement(frequency=SimpleNamespace(value="quarterly"))
        start, end = TrainingService._get_date_window(req, date(2026, 2, 10))
        assert start == date(2026, 1, 1)
        assert end == date(2026, 3, 31)

    def test_quarterly_q2(self):
        req = _make_requirement(frequency=SimpleNamespace(value="quarterly"))
        start, end = TrainingService._get_date_window(req, date(2026, 5, 1))
        assert start == date(2026, 4, 1)
        assert end == date(2026, 6, 30)

    def test_quarterly_q3(self):
        req = _make_requirement(frequency=SimpleNamespace(value="quarterly"))
        start, end = TrainingService._get_date_window(req, date(2026, 8, 20))
        assert start == date(2026, 7, 1)
        assert end == date(2026, 9, 30)

    def test_quarterly_q4(self):
        req = _make_requirement(frequency=SimpleNamespace(value="quarterly"))
        start, end = TrainingService._get_date_window(req, date(2026, 11, 5))
        assert start == date(2026, 10, 1)
        assert end == date(2026, 12, 31)

    def test_monthly(self):
        req = _make_requirement(frequency=SimpleNamespace(value="monthly"))
        start, end = TrainingService._get_date_window(req, date(2026, 2, 15))
        assert start == date(2026, 2, 1)
        assert end == date(2026, 2, 28)

    def test_monthly_leap_year(self):
        req = _make_requirement(frequency=SimpleNamespace(value="monthly"))
        start, end = TrainingService._get_date_window(req, date(2028, 2, 15))
        assert start == date(2028, 2, 1)
        assert end == date(2028, 2, 29)

    def test_one_time(self):
        req = _make_requirement(frequency=SimpleNamespace(value="one_time"))
        start, end = TrainingService._get_date_window(req, date(2026, 6, 15))
        assert start is None
        assert end is None

    def test_biannual(self):
        req = _make_requirement(frequency=SimpleNamespace(value="biannual"))
        start, end = TrainingService._get_date_window(req, date(2026, 6, 15))
        assert start is None
        assert end is None

    def test_rolling_period(self):
        req = _make_requirement(
            frequency=SimpleNamespace(value="annual"),
            due_date_type=SimpleNamespace(value="rolling"),
            rolling_period_months=6,
        )
        today = date(2026, 6, 15)
        start, end = TrainingService._get_date_window(req, today)
        assert end == today
        assert start == date(2025, 12, 15)

    def test_rolling_period_12_months(self):
        req = _make_requirement(
            frequency=SimpleNamespace(value="annual"),
            due_date_type=SimpleNamespace(value="rolling"),
            rolling_period_months=12,
        )
        today = date(2026, 3, 1)
        start, end = TrainingService._get_date_window(req, today)
        assert start == date(2025, 3, 1)
        assert end == today

    def test_rolling_period_not_set_falls_back(self):
        """If due_date_type is rolling but rolling_period_months is None, fall back to frequency."""
        req = _make_requirement(
            frequency=SimpleNamespace(value="annual"),
            due_date_type=SimpleNamespace(value="rolling"),
            rolling_period_months=None,
        )
        start, end = TrainingService._get_date_window(req, date(2026, 6, 15))
        assert start == date(2026, 1, 1)
        assert end == date(2026, 12, 31)

    def test_non_rolling_due_date_type_ignored(self):
        """Non-rolling due_date_type doesn't override frequency."""
        req = _make_requirement(
            frequency=SimpleNamespace(value="quarterly"),
            due_date_type=SimpleNamespace(value="calendar_period"),
            rolling_period_months=6,
        )
        start, end = TrainingService._get_date_window(req, date(2026, 5, 15))
        assert start == date(2026, 4, 1)
        assert end == date(2026, 6, 30)


# =====================================================
# 2. evaluate_requirement_detail tests
# =====================================================


class TestEvaluateRequirementDetailHours:
    """Test hours-based requirement evaluation."""

    def test_hours_met(self):
        req = _make_requirement(required_hours=16.0)
        records = [
            _make_record(hours_completed=10.0, completion_date=date(2026, 3, 1)),
            _make_record(hours_completed=8.0, completion_date=date(2026, 5, 1)),
        ]
        result = TrainingService.evaluate_requirement_detail(
            req, records, date(2026, 6, 15)
        )
        assert result["is_met"] is True
        assert result["completed_hours"] == 18.0
        assert result["required_hours"] == 16.0
        assert result["progress_percentage"] == 100.0

    def test_hours_not_met(self):
        req = _make_requirement(required_hours=24.0)
        records = [
            _make_record(hours_completed=10.0, completion_date=date(2026, 3, 1)),
        ]
        result = TrainingService.evaluate_requirement_detail(
            req, records, date(2026, 6, 15)
        )
        assert result["is_met"] is False
        assert result["completed_hours"] == 10.0
        assert result["required_hours"] == 24.0
        assert 0 < result["progress_percentage"] < 100

    def test_hours_zero_required(self):
        req = _make_requirement(required_hours=0)
        records = []
        result = TrainingService.evaluate_requirement_detail(
            req, records, date(2026, 6, 15)
        )
        assert result["is_met"] is True
        assert result["progress_percentage"] == 100.0

    def test_hours_filtered_by_training_type(self):
        from app.models.training import TrainingType
        req = _make_requirement(
            required_hours=10.0,
            training_type=TrainingType.CERTIFICATION,
        )
        records = [
            _make_record(
                hours_completed=8.0,
                training_type=TrainingType.CERTIFICATION,
                completion_date=date(2026, 3, 1),
            ),
            _make_record(
                hours_completed=20.0,
                training_type=TrainingType.CONTINUING_EDUCATION,
                completion_date=date(2026, 4, 1),
            ),
        ]
        result = TrainingService.evaluate_requirement_detail(
            req, records, date(2026, 6, 15)
        )
        assert result["completed_hours"] == 8.0
        assert result["is_met"] is False

    def test_hours_outside_window_excluded(self):
        """Records outside the annual window should not count."""
        req = _make_requirement(required_hours=10.0)
        records = [
            _make_record(hours_completed=20.0, completion_date=date(2025, 11, 1)),
        ]
        result = TrainingService.evaluate_requirement_detail(
            req, records, date(2026, 6, 15)
        )
        assert result["completed_hours"] == 0
        assert result["is_met"] is False

    def test_hours_with_waiver_adjustment(self):
        """Waived months reduce the required hours proportionally."""
        req = _make_requirement(required_hours=24.0)
        records = [
            _make_record(hours_completed=18.0, completion_date=date(2026, 6, 1)),
        ]
        waivers = [
            WaiverPeriod(start_date=date(2026, 3, 1), end_date=date(2026, 5, 31)),
        ]
        result = TrainingService.evaluate_requirement_detail(
            req, records, date(2026, 6, 15), waivers=waivers
        )
        # 3 months waived out of 12 → 9 active months → 24 * (9/12) = 18
        assert result["required_hours"] == 18.0
        assert result["is_met"] is True
        assert result["waived_months"] == 3

    def test_rolling_hours_with_waiver_uses_rolling_months(self):
        """Rolling period waiver uses rolling_period_months as total, not calendar months."""
        req = _make_requirement(
            required_hours=12.0,
            due_date_type=SimpleNamespace(value="rolling"),
            rolling_period_months=12,
        )
        records = [
            _make_record(hours_completed=11.0, completion_date=date(2026, 1, 15)),
        ]
        waivers = [
            WaiverPeriod(start_date=date(2026, 1, 1), end_date=date(2026, 1, 31)),
        ]
        result = TrainingService.evaluate_requirement_detail(
            req, records, date(2026, 2, 24), waivers=waivers
        )
        # 12-month rolling, 1 waived → 11 active → 12 * (11/12) = 11.0
        assert result["original_required_hours"] == 12.0
        assert result["required_hours"] == 11.0
        assert result["active_months"] == 11
        assert result["waived_months"] == 1
        assert result["is_met"] is True


class TestEvaluateRequirementDetailCourses:
    """Test course completion requirement evaluation."""

    def test_courses_all_completed(self):
        req = _make_requirement(
            requirement_type=SimpleNamespace(value="courses"),
            required_courses=["course-a", "course-b"],
            required_hours=None,
        )
        records = [
            _make_record(course_id="course-a", completion_date=date(2026, 2, 1)),
            _make_record(course_id="course-b", completion_date=date(2026, 3, 1)),
            _make_record(course_id="course-c", completion_date=date(2026, 4, 1)),
        ]
        result = TrainingService.evaluate_requirement_detail(
            req, records, date(2026, 6, 15)
        )
        assert result["is_met"] is True
        assert result["completed_hours"] == 2.0
        assert result["required_hours"] == 2.0

    def test_courses_partially_completed(self):
        req = _make_requirement(
            requirement_type=SimpleNamespace(value="courses"),
            required_courses=["course-a", "course-b", "course-c"],
            required_hours=None,
        )
        records = [
            _make_record(course_id="course-a", completion_date=date(2026, 2, 1)),
        ]
        result = TrainingService.evaluate_requirement_detail(
            req, records, date(2026, 6, 15)
        )
        assert result["is_met"] is False
        assert result["completed_hours"] == 1.0
        assert result["required_hours"] == 3.0

    def test_courses_empty_list_is_met(self):
        req = _make_requirement(
            requirement_type=SimpleNamespace(value="courses"),
            required_courses=[],
            required_hours=None,
        )
        result = TrainingService.evaluate_requirement_detail(
            req, [], date(2026, 6, 15)
        )
        assert result["is_met"] is True


class TestEvaluateRequirementDetailCertification:
    """Test certification requirement evaluation."""

    def test_certification_valid(self):
        req = _make_requirement(
            requirement_type=SimpleNamespace(value="certification"),
            required_hours=None,
        )
        records = [
            _make_record(
                course_name="Test Requirement Cert",
                expiration_date=date(2027, 6, 15),
                certification_number="CERT-001",
                completion_date=date(2025, 6, 15),
            ),
        ]
        result = TrainingService.evaluate_requirement_detail(
            req, records, date(2026, 6, 15)
        )
        assert result["is_met"] is True
        assert result["cert_expired"] is False

    def test_certification_expired(self):
        req = _make_requirement(
            requirement_type=SimpleNamespace(value="certification"),
            required_hours=None,
        )
        records = [
            _make_record(
                course_name="Test Requirement Cert",
                expiration_date=date(2026, 1, 1),
                certification_number="CERT-001",
                completion_date=date(2024, 1, 1),
            ),
        ]
        result = TrainingService.evaluate_requirement_detail(
            req, records, date(2026, 6, 15)
        )
        assert result["is_met"] is False
        assert result["cert_expired"] is True
        assert result["blocks_activity"] is True

    def test_certification_no_records(self):
        req = _make_requirement(
            requirement_type=SimpleNamespace(value="certification"),
            required_hours=None,
        )
        result = TrainingService.evaluate_requirement_detail(
            req, [], date(2026, 6, 15)
        )
        assert result["is_met"] is False
        assert result["cert_expired"] is True

    def test_certification_matched_by_registry_code(self):
        req = _make_requirement(
            requirement_type=SimpleNamespace(value="certification"),
            name="Some Other Name",
            registry_code="NFPA-1001",
            required_hours=None,
        )
        records = [
            _make_record(
                course_name="Unrelated Course",
                certification_number="NFPA-1001-2025",
                expiration_date=date(2027, 12, 31),
                completion_date=date(2025, 1, 1),
            ),
        ]
        result = TrainingService.evaluate_requirement_detail(
            req, records, date(2026, 6, 15)
        )
        assert result["is_met"] is True


class TestEvaluateRequirementDetailShifts:
    """Test shifts requirement evaluation."""

    def test_shifts_met(self):
        req = _make_requirement(
            requirement_type=SimpleNamespace(value="shifts"),
            required_shifts=3,
            required_hours=None,
        )
        records = [
            _make_record(completion_date=date(2026, 2, 1)),
            _make_record(completion_date=date(2026, 3, 1)),
            _make_record(completion_date=date(2026, 4, 1)),
        ]
        result = TrainingService.evaluate_requirement_detail(
            req, records, date(2026, 6, 15)
        )
        assert result["is_met"] is True
        assert result["completed_hours"] == 3.0
        assert result["required_hours"] == 3.0

    def test_shifts_not_met(self):
        req = _make_requirement(
            requirement_type=SimpleNamespace(value="shifts"),
            required_shifts=5,
            required_hours=None,
        )
        records = [
            _make_record(completion_date=date(2026, 2, 1)),
            _make_record(completion_date=date(2026, 3, 1)),
        ]
        result = TrainingService.evaluate_requirement_detail(
            req, records, date(2026, 6, 15)
        )
        assert result["is_met"] is False
        assert result["completed_hours"] == 2.0
        assert result["required_hours"] == 5.0

    def test_shifts_with_waiver(self):
        req = _make_requirement(
            requirement_type=SimpleNamespace(value="shifts"),
            required_shifts=12,
            required_hours=None,
        )
        records = [
            _make_record(completion_date=date(2026, i, 15))
            for i in range(1, 10)  # 9 records
        ]
        waivers = [
            WaiverPeriod(start_date=date(2026, 10, 1), end_date=date(2026, 12, 31)),
        ]
        result = TrainingService.evaluate_requirement_detail(
            req, records, date(2026, 12, 15), waivers=waivers
        )
        # 3 months waived → 9 active → 12 * (9/12) = 9 required
        assert result["required_hours"] == 9.0
        assert result["is_met"] is True


class TestEvaluateRequirementDetailCalls:
    """Test calls requirement evaluation."""

    def test_calls_met(self):
        req = _make_requirement(
            requirement_type=SimpleNamespace(value="calls"),
            required_calls=2,
            required_hours=None,
        )
        records = [
            _make_record(completion_date=date(2026, 2, 1)),
            _make_record(completion_date=date(2026, 3, 1)),
            _make_record(completion_date=date(2026, 4, 1)),
        ]
        result = TrainingService.evaluate_requirement_detail(
            req, records, date(2026, 6, 15)
        )
        assert result["is_met"] is True

    def test_calls_not_met(self):
        req = _make_requirement(
            requirement_type=SimpleNamespace(value="calls"),
            required_calls=10,
            required_hours=None,
        )
        records = [
            _make_record(completion_date=date(2026, 2, 1)),
        ]
        result = TrainingService.evaluate_requirement_detail(
            req, records, date(2026, 6, 15)
        )
        assert result["is_met"] is False


class TestEvaluateRequirementDetailFallback:
    """Test fallback (skills_evaluation, checklist, etc.) evaluation."""

    def test_fallback_with_matching_record(self):
        req = _make_requirement(
            requirement_type=SimpleNamespace(value="checklist"),
            required_hours=None,
        )
        records = [
            _make_record(
                course_name="Test Requirement Checklist",
                completion_date=date(2026, 3, 1),
            ),
        ]
        result = TrainingService.evaluate_requirement_detail(
            req, records, date(2026, 6, 15)
        )
        assert result["is_met"] is True

    def test_fallback_no_matching_record(self):
        req = _make_requirement(
            requirement_type=SimpleNamespace(value="skills_evaluation"),
            name="SCBA Operations",
            required_hours=None,
        )
        records = [
            _make_record(
                course_name="Hose Operations",
                completion_date=date(2026, 3, 1),
            ),
        ]
        result = TrainingService.evaluate_requirement_detail(
            req, records, date(2026, 6, 15)
        )
        assert result["is_met"] is False


class TestEvaluateRequirementDetailRolling:
    """Test rolling period requirements."""

    def test_rolling_period_includes_recent_records(self):
        req = _make_requirement(
            required_hours=10.0,
            due_date_type=SimpleNamespace(value="rolling"),
            rolling_period_months=6,
        )
        records = [
            _make_record(hours_completed=12.0, completion_date=date(2026, 4, 1)),
        ]
        result = TrainingService.evaluate_requirement_detail(
            req, records, date(2026, 6, 15)
        )
        assert result["is_met"] is True
        assert result["completed_hours"] == 12.0

    def test_rolling_period_excludes_old_records(self):
        req = _make_requirement(
            required_hours=10.0,
            due_date_type=SimpleNamespace(value="rolling"),
            rolling_period_months=6,
        )
        records = [
            _make_record(hours_completed=20.0, completion_date=date(2025, 6, 1)),
        ]
        result = TrainingService.evaluate_requirement_detail(
            req, records, date(2026, 6, 15)
        )
        assert result["is_met"] is False
        assert result["completed_hours"] == 0


# =====================================================
# 3. Waiver calculation tests
# =====================================================


class TestWaiverCalculations:
    """Test waiver-related pure calculation functions."""

    def test_count_waived_months_full_months(self):
        waivers = [WaiverPeriod(start_date=date(2026, 3, 1), end_date=date(2026, 5, 31))]
        count = count_waived_months(waivers, date(2026, 1, 1), date(2026, 12, 31))
        assert count == 3

    def test_count_waived_months_partial_under_threshold(self):
        """A waiver covering less than 15 days of a month does not waive it."""
        waivers = [WaiverPeriod(start_date=date(2026, 3, 1), end_date=date(2026, 3, 14))]
        count = count_waived_months(waivers, date(2026, 1, 1), date(2026, 12, 31))
        assert count == 0

    def test_count_waived_months_partial_at_threshold(self):
        """A waiver covering exactly 15 days counts."""
        waivers = [WaiverPeriod(start_date=date(2026, 3, 1), end_date=date(2026, 3, 15))]
        count = count_waived_months(waivers, date(2026, 1, 1), date(2026, 12, 31))
        assert count == 1

    def test_count_waived_months_overlapping_dedup(self):
        """Overlapping waivers don't double-count months."""
        waivers = [
            WaiverPeriod(start_date=date(2026, 3, 1), end_date=date(2026, 5, 31)),
            WaiverPeriod(start_date=date(2026, 4, 1), end_date=date(2026, 6, 30)),
        ]
        count = count_waived_months(waivers, date(2026, 1, 1), date(2026, 12, 31))
        assert count == 4  # March, April, May, June

    def test_count_waived_months_requirement_specific(self):
        """Requirement-specific waivers only apply to their requirement."""
        waivers = [
            WaiverPeriod(
                start_date=date(2026, 3, 1),
                end_date=date(2026, 5, 31),
                requirement_ids=["req-1"],
            ),
        ]
        # For req-1: should count
        assert count_waived_months(waivers, date(2026, 1, 1), date(2026, 12, 31), req_id="req-1") == 3
        # For req-2: should not count
        assert count_waived_months(waivers, date(2026, 1, 1), date(2026, 12, 31), req_id="req-2") == 0

    def test_count_waived_months_blanket_applies_to_all(self):
        """Blanket waivers (requirement_ids=None) apply to all requirements."""
        waivers = [
            WaiverPeriod(start_date=date(2026, 3, 1), end_date=date(2026, 5, 31)),
        ]
        assert count_waived_months(waivers, date(2026, 1, 1), date(2026, 12, 31), req_id="any-req") == 3

    def test_count_waived_months_no_overlap(self):
        """Waivers outside the evaluation period are ignored."""
        waivers = [WaiverPeriod(start_date=date(2025, 1, 1), end_date=date(2025, 3, 31))]
        count = count_waived_months(waivers, date(2026, 1, 1), date(2026, 12, 31))
        assert count == 0

    def test_count_waived_months_empty(self):
        assert count_waived_months([], date(2026, 1, 1), date(2026, 12, 31)) == 0

    def test_total_months_in_period_annual(self):
        assert total_months_in_period(date(2026, 1, 1), date(2026, 12, 31)) == 12

    def test_total_months_in_period_single_month(self):
        assert total_months_in_period(date(2026, 3, 1), date(2026, 3, 31)) == 1

    def test_total_months_in_period_quarter(self):
        assert total_months_in_period(date(2026, 4, 1), date(2026, 6, 30)) == 3

    def test_adjust_required_no_waivers(self):
        adjusted, waived, active = adjust_required(
            24.0, date(2026, 1, 1), date(2026, 12, 31), []
        )
        assert adjusted == 24.0
        assert waived == 0
        assert active == 12  # All months are active when no waivers

    def test_adjust_required_with_waivers(self):
        """Worked example from the spec: 24 hours, 3 months waived → 18."""
        waivers = [
            WaiverPeriod(start_date=date(2026, 3, 5), end_date=date(2026, 5, 20)),
        ]
        adjusted, waived, active = adjust_required(
            24.0, date(2026, 1, 1), date(2026, 12, 31), waivers
        )
        assert waived == 3
        assert active == 9
        assert adjusted == 18.0

    def test_adjust_required_all_months_waived(self):
        """If all months are waived, active is clamped to 1."""
        waivers = [
            WaiverPeriod(start_date=date(2026, 1, 1), end_date=date(2026, 12, 31)),
        ]
        adjusted, waived, active = adjust_required(
            24.0, date(2026, 1, 1), date(2026, 12, 31), waivers
        )
        assert waived == 12
        assert active == 1
        assert adjusted == 2.0  # 24 * (1/12) = 2.0

    def test_adjust_required_zero_base(self):
        """Zero base requirement should return zero regardless of waivers."""
        waivers = [
            WaiverPeriod(start_date=date(2026, 3, 1), end_date=date(2026, 5, 31)),
        ]
        adjusted, waived, active = adjust_required(
            0, date(2026, 1, 1), date(2026, 12, 31), waivers
        )
        assert adjusted == 0

    def test_adjust_required_rolling_period_months_override(self):
        """Rolling periods should use period_months instead of calendar-month count.

        A 12-month rolling window from mid-Feb to mid-Feb spans 13 calendar
        months but the intention is 12.  Passing period_months=12 corrects
        the total so that 1 waived month → 11 active months.
        """
        waivers = [
            WaiverPeriod(start_date=date(2026, 1, 1), end_date=date(2026, 1, 31)),
        ]
        # Mid-month rolling window: Feb 24 2025 → Feb 24 2026 (13 calendar months)
        adjusted, waived, active = adjust_required(
            12.0, date(2025, 2, 24), date(2026, 2, 24), waivers,
            period_months=12,
        )
        assert waived == 1
        assert active == 11
        assert adjusted == 11.0  # 12 * (11/12) = 11.0

    def test_adjust_required_rolling_without_override_has_off_by_one(self):
        """Without period_months, mid-month rolling window counts 13 months."""
        waivers = [
            WaiverPeriod(start_date=date(2026, 1, 1), end_date=date(2026, 1, 31)),
        ]
        # Same window without override → total_months_in_period returns 13
        adjusted, waived, active = adjust_required(
            12.0, date(2025, 2, 24), date(2026, 2, 24), waivers,
        )
        assert active == 12  # 13 - 1 = 12 (incorrect for a "12-month" period)


# =====================================================
# 4. Biannual requirements
# =====================================================


class TestBiannualRequirements:
    """Test biannual frequency requirements (cert-based compliance)."""

    def test_biannual_hours_with_valid_cert(self):
        req = _make_requirement(
            frequency=SimpleNamespace(value="biannual"),
            required_hours=10.0,
        )
        records = [
            _make_record(
                hours_completed=12.0,
                completion_date=date(2025, 6, 1),
                expiration_date=date(2027, 6, 1),
            ),
        ]
        result = TrainingService.evaluate_requirement_detail(
            req, records, date(2026, 6, 15)
        )
        assert result["is_met"] is True
        assert result["cert_expired"] is False

    def test_biannual_hours_with_expired_cert(self):
        req = _make_requirement(
            frequency=SimpleNamespace(value="biannual"),
            required_hours=10.0,
        )
        records = [
            _make_record(
                hours_completed=12.0,
                completion_date=date(2024, 6, 1),
                expiration_date=date(2026, 1, 1),
            ),
        ]
        result = TrainingService.evaluate_requirement_detail(
            req, records, date(2026, 6, 15)
        )
        assert result["is_met"] is False
        assert result["cert_expired"] is True
        assert result["progress_percentage"] == 0.0


# =====================================================
# 5. Output field tests
# =====================================================


class TestEvaluateRequirementDetailFields:
    """Verify all expected output fields are present."""

    def test_all_fields_present(self):
        req = _make_requirement()
        result = TrainingService.evaluate_requirement_detail(req, [], date(2026, 6, 15))
        expected_fields = {
            "id", "name", "description", "requirement_type", "frequency",
            "training_type", "required_hours", "original_required_hours",
            "completed_hours", "progress_percentage", "is_met", "due_date",
            "days_until_due", "waived_months", "active_months",
            "cert_expired", "blocks_activity",
        }
        assert set(result.keys()) == expected_fields

    def test_days_until_due_calculated(self):
        req = _make_requirement(due_date=date(2026, 12, 31))
        result = TrainingService.evaluate_requirement_detail(
            req, [], date(2026, 6, 15)
        )
        assert result["days_until_due"] == (date(2026, 12, 31) - date(2026, 6, 15)).days

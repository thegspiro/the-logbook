"""
Tests for the requirement freshness window (``recency_days``).

A requirement may demand that the completion itself be recent — "CPR taken
within the last 180 days" — separately from how often it recurs. The window
must:

* exclude an old completion even from a ``one_time`` requirement, whose
  frequency window is otherwise unbounded (this is the case it exists for);
* leave requirements without a window behaving exactly as before;
* block an officer crediting an out-of-window record to a pipeline requirement,
  since that sign-off would otherwise defeat the rule.

DB is mocked; no MySQL.
"""

from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.training import RequirementType, TrainingStatus
from app.services.training_compliance import (
    apply_recency,
    evaluate_member_requirement,
    is_recent_enough,
    recency_cutoff,
)
from app.services.training_program_service import TrainingProgramService

TODAY = date(2026, 8, 7)


def _requirement(**overrides):
    base = {
        "id": "req-1",
        "name": "CPR",
        "requirement_type": RequirementType.COURSES,
        "frequency": "one_time",
        "required_courses": ["course-cpr"],
        "required_hours": None,
        "required_shifts": None,
        "required_calls": None,
        "training_type": None,
        "registry_code": None,
        "category_ids": None,
        "recency_days": None,
        "year": None,
        "due_date_type": None,
        "rolling_period_months": None,
        "include_current_month": None,
        "period_start_month": 1,
        "period_start_day": 1,
        "period_end_month": None,
        "period_end_day": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _record(days_ago, **overrides):
    base = {
        "course_id": "course-cpr",
        "course_name": "CPR",
        "training_type": None,
        "certification_number": None,
        "status": TrainingStatus.COMPLETED,
        "completion_date": TODAY - timedelta(days=days_ago),
        "expiration_date": None,
        "hours_completed": 4.0,
        "category_id": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


class TestRecencyCutoff:
    def test_no_window_returns_none(self):
        assert recency_cutoff(_requirement(), TODAY) is None

    def test_zero_or_negative_is_treated_as_no_window(self):
        assert recency_cutoff(_requirement(recency_days=0), TODAY) is None
        assert recency_cutoff(_requirement(recency_days=-5), TODAY) is None

    def test_window_counts_back_from_today(self):
        assert recency_cutoff(_requirement(recency_days=180), TODAY) == date(2026, 2, 8)

    def test_record_on_the_cutoff_still_counts(self):
        req = _requirement(recency_days=180)
        assert is_recent_enough(req, _record(180), TODAY)
        assert not is_recent_enough(req, _record(181), TODAY)

    def test_record_without_a_completion_date_is_not_fresh(self):
        """Can't verify the window, so it must not slip through."""
        req = _requirement(recency_days=180)
        assert not is_recent_enough(req, _record(0, completion_date=None), TODAY)

    def test_record_without_a_date_is_untouched_when_no_window(self):
        req = _requirement()
        assert is_recent_enough(req, _record(0, completion_date=None), TODAY)

    def test_apply_recency_is_a_no_op_without_a_window(self):
        records = [_record(3000), _record(1)]
        assert apply_recency(_requirement(), records, TODAY) is records


class TestOneTimeRequirementWithWindow:
    """The motivating case: a one_time requirement's frequency window is
    unbounded, so without recency an ancient completion satisfies it forever."""

    def test_old_completion_satisfies_without_a_window(self):
        status, _, _ = evaluate_member_requirement(
            _requirement(), [_record(1095)], TODAY
        )
        assert status == "completed"

    def test_old_completion_does_not_satisfy_with_a_window(self):
        status, _, _ = evaluate_member_requirement(
            _requirement(recency_days=180), [_record(1095)], TODAY
        )
        assert status == "not_started"

    def test_recent_completion_still_satisfies_with_a_window(self):
        status, _, _ = evaluate_member_requirement(
            _requirement(recency_days=180), [_record(30)], TODAY
        )
        assert status == "completed"

    def test_certification_requirement_honors_the_window(self):
        req = _requirement(
            requirement_type=RequirementType.CERTIFICATION, recency_days=180
        )
        assert (
            evaluate_member_requirement(req, [_record(1095)], TODAY)[0] == "not_started"
        )
        assert evaluate_member_requirement(req, [_record(10)], TODAY)[0] == "completed"


def _apply_service(requirement):
    """Service whose apply-target lookup resolves to ``requirement``."""
    progress = SimpleNamespace(id="p1")
    enrollment = SimpleNamespace(id="enr-1")
    db = MagicMock()
    db.execute = AsyncMock(
        side_effect=[
            MagicMock(scalar_one_or_none=MagicMock(return_value=enrollment)),
            MagicMock(first=MagicMock(return_value=(progress, requirement))),
        ]
    )
    return TrainingProgramService(db)


class TestApplyTargetRespectsWindow:
    async def test_stale_record_is_rejected(self):
        svc = _apply_service(_requirement(recency_days=180))
        ok, error = await svc.validate_apply_target(
            user_id="u1",
            organization_id="org-1",
            program_id="prog-1",
            requirement_id="req-1",
            completed_on=TODAY - timedelta(days=400),
        )
        assert ok is False
        assert "180-day window" in error

    async def test_fresh_record_is_accepted(self):
        svc = _apply_service(_requirement(recency_days=180))
        ok, error = await svc.validate_apply_target(
            user_id="u1",
            organization_id="org-1",
            program_id="prog-1",
            requirement_id="req-1",
            completed_on=TODAY - timedelta(days=10),
        )
        assert ok is True
        assert error is None

    async def test_stale_record_is_accepted_when_no_window_is_set(self):
        svc = _apply_service(_requirement())
        ok, _ = await svc.validate_apply_target(
            user_id="u1",
            organization_id="org-1",
            program_id="prog-1",
            requirement_id="req-1",
            completed_on=TODAY - timedelta(days=4000),
        )
        assert ok is True

    async def test_caller_without_a_date_is_not_blocked(self):
        """Callers that can't supply a completion date keep working."""
        svc = _apply_service(_requirement(recency_days=180))
        ok, _ = await svc.validate_apply_target(
            user_id="u1",
            organization_id="org-1",
            program_id="prog-1",
            requirement_id="req-1",
        )
        assert ok is True


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))

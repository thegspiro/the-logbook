"""
Tests for the competency matrix service
(app/services/competency_matrix_service.py).

Focus on _evaluate_requirement_status, which maps the shared grader's status
to the heat map's current/expiring_soon/in_progress/expired/not_started for
HOURS, COURSES and CERTIFICATION requirements. No DB.
"""

from datetime import date, timedelta
from types import SimpleNamespace
from typing import Any

from app.models.training import RequirementFrequency, RequirementType, TrainingStatus
from app.services.competency_matrix_service import CompetencyMatrixService
from app.utils.training_match_key import training_match_key
from tests.clock_support import reread_each_test


def _svc():
    from unittest.mock import MagicMock

    return CompetencyMatrixService(MagicMock())


def _req(req_type, frequency=RequirementFrequency.ONE_TIME, **kw):
    return SimpleNamespace(
        id=kw.get("id", "req-1"),
        requirement_type=req_type,
        frequency=frequency,
        year=kw.get("year"),
        training_type=kw.get("training_type"),
        name=kw.get("name", "Req"),
        registry_code=kw.get("registry_code"),
        name_match_until=kw.get("name_match_until"),
        required_hours=kw.get("required_hours"),
        required_courses=kw.get("required_courses"),
        include_current_month=kw.get("include_current_month"),
    )


def _rec(completion_date=None, expiration_date=None, **kw):
    return SimpleNamespace(
        status=TrainingStatus.COMPLETED,
        completion_date=completion_date,
        expiration_date=expiration_date,
        training_type=kw.get("training_type"),
        course_name=kw.get("course_name"),
        certification_number=kw.get("certification_number"),
        # Keyed as the model keys a saved record (app/models/training.py).
        match_key=training_match_key(kw.get("course_name")),
        certification_key=training_match_key(kw.get("certification_number")),
        issuing_agency=kw.get("issuing_agency"),
        course_id=kw.get("course_id"),
        hours_completed=kw.get("hours_completed", 0),
    )


def _clock() -> dict[str, Any]:
    """Read as each test starts (tests/clock_support.py), not at import."""
    today = date.today()
    threshold = today + timedelta(days=90)
    return {"TODAY": today, "THRESHOLD": threshold}


TODAY, THRESHOLD = _clock().values()
_reread_clock = reread_each_test(__name__, _clock)


def _evaluate(requirement, records):
    return _svc()._evaluate_requirement_status(requirement, records, TODAY, THRESHOLD)


class TestNoWindowOfItsOwn:
    """The view used to compute its own windows, without rolling or custom
    annual ones; it now grades through the shared grader, whose window is
    ``get_requirement_date_window`` (tests/test_training_compliance.py).
    tests/test_competency_matrix_agrees_with_grader.py holds the cases."""

    def test_the_private_window_is_gone(self):
        assert not hasattr(CompetencyMatrixService, "_get_date_window")


class TestNotStarted:
    def test_no_records_is_not_started(self):
        req = _req(RequirementType.CERTIFICATION, training_type="ff1")
        assert _evaluate(req, [])["status"] == "not_started"


class TestCertificationStatus:
    def _req(self):
        return _req(RequirementType.CERTIFICATION, training_type="ff1")

    def test_current_when_expiry_far_off(self):
        rec = _rec(
            TODAY - timedelta(days=30), TODAY + timedelta(days=300), training_type="ff1"
        )
        out = _evaluate(self._req(), [rec])
        assert out["status"] == "current"

    def test_expiring_soon_within_threshold(self):
        rec = _rec(
            TODAY - timedelta(days=30), TODAY + timedelta(days=45), training_type="ff1"
        )
        assert _evaluate(self._req(), [rec])["status"] == "expiring_soon"

    def test_expired_when_past(self):
        rec = _rec(
            TODAY - timedelta(days=400), TODAY - timedelta(days=60), training_type="ff1"
        )
        assert _evaluate(self._req(), [rec])["status"] == "expired"

    def test_no_expiration_is_current(self):
        rec = _rec(TODAY - timedelta(days=30), None, training_type="ff1")
        out = _evaluate(self._req(), [rec])
        assert out["status"] == "current"
        assert out["expiration_date"] is None

    def test_matches_a_legacy_record_by_the_name_key(self):
        # By key since 2026-11-01: case and punctuation do not matter, other
        # words do, so a course that merely contains the name no longer counts.
        req = _req(RequirementType.CERTIFICATION, name="EMT", name_match_until=TODAY)
        rec = _rec(TODAY - timedelta(days=10), None, course_name="e.m.t.")
        assert _evaluate(req, [rec])["status"] == "current"
        rec = _rec(TODAY - timedelta(days=10), None, course_name="State EMT-B Course")
        assert _evaluate(req, [rec])["status"] != "current"

    def test_no_name_match_after_the_cutoff(self):
        req = _req(
            RequirementType.CERTIFICATION,
            name="EMT",
            name_match_until=TODAY - timedelta(days=30),
        )
        rec = _rec(TODAY - timedelta(days=10), None, course_name="State EMT-B Course")
        assert _evaluate(req, [rec])["status"] != "current"

    def test_picks_most_recent_record(self):
        old = _rec(
            TODAY - timedelta(days=400), TODAY - timedelta(days=60), training_type="ff1"
        )
        new = _rec(
            TODAY - timedelta(days=10), TODAY + timedelta(days=300), training_type="ff1"
        )
        # Most recent is current despite an older expired record.
        assert _evaluate(self._req(), [old, new])["status"] == "current"


class TestHoursStatus:
    def _req(self):
        return _req(
            RequirementType.HOURS,
            RequirementFrequency.ANNUAL,
            year=TODAY.year,
            required_hours=10,
            training_type="drill",
        )

    def _in_window(self):
        return date(TODAY.year, 1, 15)

    def test_current_when_hours_met(self):
        rec = _rec(self._in_window(), None, training_type="drill", hours_completed=12)
        out = _evaluate(self._req(), [rec])
        assert out["status"] == "current"
        assert out["details"] == "12/10 hours"

    def test_partial_progress_is_in_progress(self):
        # Not "expiring_soon", which readiness counts as ready.
        rec = _rec(self._in_window(), None, training_type="drill", hours_completed=4)
        assert _evaluate(self._req(), [rec])["status"] == "in_progress"

    def test_zero_hours_is_not_started(self):
        rec = _rec(self._in_window(), None, training_type="drill", hours_completed=0)
        assert _evaluate(self._req(), [rec])["status"] == "not_started"

    def test_wrong_training_type_excluded(self):
        rec = _rec(self._in_window(), None, training_type="other", hours_completed=20)
        assert _evaluate(self._req(), [rec])["status"] == "not_started"


class TestCoursesStatus:
    def _req(self):
        return _req(
            RequirementType.COURSES,
            RequirementFrequency.ANNUAL,
            year=TODAY.year,
            required_courses=["c1", "c2"],
        )

    def _rec_for(self, course_id):
        return _rec(date(TODAY.year, 2, 1), None, course_id=course_id)

    def test_all_courses_complete_is_current(self):
        recs = [self._rec_for("c1"), self._rec_for("c2")]
        out = _evaluate(self._req(), recs)
        assert out["status"] == "current"
        assert "2/2 courses" in out["details"]

    def test_partial_courses_is_in_progress(self):
        out = _evaluate(self._req(), [self._rec_for("c1")])
        assert out["status"] == "in_progress"
        assert "1/2 courses" in out["details"]

    def test_no_matching_courses_is_not_started(self):
        assert (
            _evaluate(self._req(), [self._rec_for("other")])["status"] == "not_started"
        )


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))

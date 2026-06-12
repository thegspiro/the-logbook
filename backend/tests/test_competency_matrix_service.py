"""
Tests for the competency matrix service
(app/services/competency_matrix_service.py).

Focus on the two correctness-sensitive, DB-free helpers that drive the
department heat map: _get_date_window (frequency -> evaluation window) and
_evaluate_requirement_status (type-aware current/expiring_soon/expired/
not_started determination for HOURS, COURSES, and CERTIFICATION
requirements). No DB.
"""

from datetime import date, timedelta
from types import SimpleNamespace

from app.models.training import RequirementFrequency, RequirementType, TrainingStatus
from app.services.competency_matrix_service import CompetencyMatrixService


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
        issuing_agency=kw.get("issuing_agency"),
        course_id=kw.get("course_id"),
        hours_completed=kw.get("hours_completed", 0),
    )


TODAY = date.today()
THRESHOLD = TODAY + timedelta(days=90)


def _evaluate(requirement, records):
    return _svc()._evaluate_requirement_status(requirement, records, TODAY, THRESHOLD)


class TestGetDateWindow:
    REF = date(2026, 5, 15)  # Q2, May

    def test_one_time_has_no_window(self):
        req = _req(RequirementType.CERTIFICATION, RequirementFrequency.ONE_TIME)
        assert CompetencyMatrixService._get_date_window(req, self.REF) == (None, None)

    def test_annual_uses_requirement_year(self):
        req = _req(RequirementType.HOURS, RequirementFrequency.ANNUAL, year=2026)
        assert CompetencyMatrixService._get_date_window(req, self.REF) == (
            date(2026, 1, 1),
            date(2026, 12, 31),
        )

    def test_monthly_is_current_month(self):
        req = _req(RequirementType.HOURS, RequirementFrequency.MONTHLY)
        assert CompetencyMatrixService._get_date_window(req, self.REF) == (
            date(2026, 5, 1),
            date(2026, 5, 31),
        )

    def test_quarterly_is_current_quarter(self):
        req = _req(RequirementType.HOURS, RequirementFrequency.QUARTERLY)
        assert CompetencyMatrixService._get_date_window(req, self.REF) == (
            date(2026, 4, 1),
            date(2026, 6, 30),
        )

    def test_biannual_spans_two_years(self):
        req = _req(RequirementType.HOURS, RequirementFrequency.BIANNUAL, year=2026)
        assert CompetencyMatrixService._get_date_window(req, self.REF) == (
            date(2025, 1, 1),
            date(2026, 12, 31),
        )


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

    def test_matches_by_name_substring(self):
        req = _req(RequirementType.CERTIFICATION, name="EMT")
        rec = _rec(TODAY - timedelta(days=10), None, course_name="State EMT-B Course")
        assert _evaluate(req, [rec])["status"] == "current"

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
        assert "12.0/10.0 hrs" in out["details"]

    def test_partial_progress_is_expiring_soon(self):
        rec = _rec(self._in_window(), None, training_type="drill", hours_completed=4)
        assert _evaluate(self._req(), [rec])["status"] == "expiring_soon"

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

    def test_partial_courses_is_expiring_soon(self):
        out = _evaluate(self._req(), [self._rec_for("c1")])
        assert out["status"] == "expiring_soon"
        assert "1/2 courses" in out["details"]

    def test_no_matching_courses_is_not_started(self):
        assert (
            _evaluate(self._req(), [self._rec_for("other")])["status"] == "not_started"
        )


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))

"""
Tests for linking course-library entries to a training requirement.

Two behaviours are covered:

* ``certification_record_matches`` — a CERTIFICATION requirement is satisfied by
  a record for a linked catalog course, on top of the pre-existing
  name/type/registry-code heuristics (which must keep working, since existing
  requirements rely on them).
* ``TrainingProgramService._validate_required_courses`` — client-supplied course
  ids are rejected unless they belong to the caller's organization, so a
  requirement can't be made to point at another tenant's course (XC-1).

DB is mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.training_compliance import certification_record_matches
from app.services.training_program_service import TrainingProgramService


def _requirement(**overrides):
    base = {
        "name": "CPR",
        "training_type": None,
        "registry_code": None,
        "required_courses": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _record(**overrides):
    base = {
        "course_id": None,
        "course_name": None,
        "training_type": None,
        "certification_number": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


class TestCertificationRecordMatches:
    def test_linked_course_matches(self):
        req = _requirement(name="Cardiac Care", required_courses=["course-cpr"])
        assert certification_record_matches(req, _record(course_id="course-cpr"))

    def test_linked_course_compares_as_string(self):
        """Course ids arrive as UUID objects on records but strings in JSON."""
        from uuid import UUID

        cid = UUID("11111111-1111-1111-1111-111111111111")
        req = _requirement(required_courses=[str(cid)])
        assert certification_record_matches(req, _record(course_id=cid))

    def test_unlinked_course_does_not_match(self):
        req = _requirement(name="Cardiac Care", required_courses=["course-cpr"])
        assert not certification_record_matches(req, _record(course_id="course-evoc"))

    def test_linking_a_course_keeps_name_matching(self):
        """Linking widens the match — it must not narrow it, or an existing
        requirement would stop crediting records it already credited."""
        req = _requirement(name="CPR", required_courses=["course-cpr"])
        assert certification_record_matches(
            req, _record(course_name="CPR Recertification")
        )

    def test_training_type_still_matches_without_link(self):
        req = _requirement(training_type="certification")
        assert certification_record_matches(req, _record(training_type="certification"))

    def test_registry_code_still_matches_without_link(self):
        req = _requirement(name="EMT", registry_code="NREMT")
        assert certification_record_matches(
            req, _record(certification_number="NREMT-12345")
        )

    def test_no_signal_does_not_match(self):
        req = _requirement(name="CPR")
        assert not certification_record_matches(req, _record(course_name="Ladders"))


def _svc_with_courses(found_ids):
    """Service whose course lookup returns exactly ``found_ids``."""
    db = MagicMock()
    db.execute = AsyncMock(
        return_value=MagicMock(all=MagicMock(return_value=[(i,) for i in found_ids]))
    )
    return TrainingProgramService(db)


class TestValidateRequiredCourses:
    async def test_empty_is_allowed(self):
        svc = _svc_with_courses([])
        assert await svc._validate_required_courses(None, "org-1") is None
        assert await svc._validate_required_courses([], "org-1") is None

    async def test_in_org_courses_pass(self):
        svc = _svc_with_courses(["c1", "c2"])
        assert await svc._validate_required_courses(["c1", "c2"], "org-1") is None

    async def test_out_of_org_course_is_rejected(self):
        # The lookup is org-scoped, so a foreign course simply isn't returned.
        svc = _svc_with_courses(["c1"])
        error = await svc._validate_required_courses(
            ["c1", "other-org-course"], "org-1"
        )
        assert error == "Invalid linked course"
        # Never names the offending id — that would be a cross-tenant
        # existence oracle.
        assert "other-org-course" not in error

    async def test_unknown_course_is_rejected(self):
        svc = _svc_with_courses([])
        assert await svc._validate_required_courses(["ghost"], "org-1") is not None


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))

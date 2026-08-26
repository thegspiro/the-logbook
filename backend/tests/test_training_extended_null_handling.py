"""
Security-review findings (training extended, 2026-08-26): three update paths
(external-training provider, course cohort, syllabus class) wrote
partial-update payloads with a hand-rolled ``setattr`` loop instead of
``apply_updates``, so an explicit JSON ``null`` for a NOT NULL column (e.g.
``name``) reached ``db.commit()`` unguarded and raised a raw IntegrityError
(a 500) instead of a clean 400 — the "blind setattr / null-handling" defect
class (CLAUDE.md pitfall #4 / #1).

Unit-tests ``apply_updates`` against real (unsaved) ORM instances so SQLAlchemy's
own column-nullability metadata drives the assertion, matching the precedent in
``tests/test_facilities_service.py::TestNullabilityGuard`` — a plain
``SimpleNamespace`` has no mapper, so ``apply_updates`` cannot see any NOT NULL
constraint on one and the guard would silently not apply. DB mocked; no MySQL.
"""

import pytest

from app.models.training import CourseClass, CourseCohort, ExternalTrainingProvider
from app.utils.model_updates import apply_updates


class TestProviderUpdateNullabilityGuard:
    def test_name_cannot_be_nulled(self):
        provider = ExternalTrainingProvider(
            name="Vector Solutions", organization_id="org-1", provider_type="custom"
        )
        with pytest.raises(ValueError, match="cannot be cleared"):
            apply_updates(provider, {"name": None})

    def test_active_can_still_be_set(self):
        provider = ExternalTrainingProvider(
            name="Vector Solutions", organization_id="org-1", provider_type="custom"
        )
        apply_updates(provider, {"active": False})
        assert provider.active is False


class TestCohortUpdateNullabilityGuard:
    def test_name_cannot_be_nulled(self):
        cohort = CourseCohort(
            name="Recruit School 12",
            organization_id="org-1",
            course_id="course-1",
            start_date="2026-01-01",
        )
        with pytest.raises(ValueError, match="cannot be cleared"):
            apply_updates(cohort, {"name": None})

    def test_status_cannot_be_nulled(self):
        cohort = CourseCohort(
            name="Recruit School 12",
            organization_id="org-1",
            course_id="course-1",
            start_date="2026-01-01",
            status="active",
        )
        with pytest.raises(ValueError, match="cannot be cleared"):
            apply_updates(cohort, {"status": None})

    def test_code_can_still_be_cleared(self):
        cohort = CourseCohort(
            name="Recruit School 12",
            organization_id="org-1",
            course_id="course-1",
            start_date="2026-01-01",
            code="RS-12",
        )
        apply_updates(cohort, {"code": None})
        assert cohort.code is None


class TestSyllabusClassUpdateNullabilityGuard:
    def test_class_course_id_cannot_be_nulled(self):
        course_class = CourseClass(
            organization_id="org-1", course_id="course-1", class_course_id="course-2"
        )
        with pytest.raises(ValueError, match="cannot be cleared"):
            apply_updates(course_class, {"class_course_id": None})

    def test_day_offset_cannot_be_nulled(self):
        course_class = CourseClass(
            organization_id="org-1",
            course_id="course-1",
            class_course_id="course-2",
            day_offset=3,
        )
        with pytest.raises(ValueError, match="cannot be cleared"):
            apply_updates(course_class, {"day_offset": None})

    def test_duration_minutes_cannot_be_nulled(self):
        course_class = CourseClass(
            organization_id="org-1",
            course_id="course-1",
            class_course_id="course-2",
            duration_minutes=60,
        )
        with pytest.raises(ValueError, match="cannot be cleared"):
            apply_updates(course_class, {"duration_minutes": None})

    def test_instructor_id_can_still_be_cleared(self):
        course_class = CourseClass(
            organization_id="org-1",
            course_id="course-1",
            class_course_id="course-2",
            instructor_id="user-9",
        )
        apply_updates(course_class, {"instructor_id": None})
        assert course_class.instructor_id is None

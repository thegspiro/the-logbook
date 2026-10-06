"""
One rule decides which records count toward an HOURS requirement.

My Training (``TrainingService``) narrowed by course and ignored a
requirement's categories; the compliance screens (``training_compliance``)
narrowed by category and ignored its courses. A member could read "met" on
one and "not met" on the other (CLAUDE.md pitfall 29). Both now call
``hours_record_counts``, and the SQL-sum path applies the same filters.
"""

from datetime import date

import pytest

from app.services.training_compliance import (
    _grade_member_requirement,
    hours_record_counts,
)
from app.services.training_service import TrainingService
from tests.test_training_compliance import _make_record, _make_requirement

pytestmark = pytest.mark.unit

TODAY = date(2026, 6, 30)


def _both(req, records):
    """(hours My Training credits, hours the compliance grade credits)."""
    detail = TrainingService.evaluate_requirement_detail(req, records, TODAY)
    grade = _grade_member_requirement(req, records, TODAY)
    return detail["completed_hours"], grade.progress_current


class TestTheRule:
    def test_unset_criteria_restrict_nothing(self):
        assert hours_record_counts(_make_requirement(), _make_record(category_id=None))

    def test_a_category_scoped_requirement_needs_the_category(self):
        req = _make_requirement(category_ids=["cat-ems"])
        assert hours_record_counts(req, _make_record(category_id="cat-ems"))
        assert not hours_record_counts(req, _make_record(category_id="cat-fire"))
        assert not hours_record_counts(req, _make_record(category_id=None))

    def test_a_course_scoped_requirement_needs_the_course(self):
        req = _make_requirement(required_courses=["course-1"])
        assert hours_record_counts(req, _make_record(course_id="course-1"))
        assert not hours_record_counts(req, _make_record(course_id="course-2"))

    def test_each_criterion_set_narrows_the_pool(self):
        req = _make_requirement(category_ids=["cat-ems"], required_courses=["course-1"])
        assert hours_record_counts(
            req, _make_record(category_id="cat-ems", course_id="course-1")
        )
        assert not hours_record_counts(
            req, _make_record(category_id="cat-ems", course_id="course-2")
        )


class TestBothScreensAgree:
    def test_category_scoped(self):
        req = _make_requirement(category_ids=["cat-ems"], required_hours=10.0)
        records = [
            _make_record(id="a", category_id="cat-ems", hours_completed=6.0),
            _make_record(id="b", category_id="cat-fire", hours_completed=8.0),
        ]
        # My Training used to count both records (14 hours, "met").
        assert _both(req, records) == (6.0, 6.0)

    def test_course_scoped(self):
        req = _make_requirement(required_courses=["course-1"], required_hours=10.0)
        records = [
            _make_record(id="a", course_id="course-1", hours_completed=6.0),
            _make_record(id="b", course_id="course-2", hours_completed=8.0),
        ]
        # The compliance grade used to count both records.
        assert _both(req, records) == (6.0, 6.0)

    def test_unscoped(self):
        req = _make_requirement(required_hours=10.0)
        records = [
            _make_record(id="a", hours_completed=6.0),
            _make_record(id="b", hours_completed=8.0),
        ]
        assert _both(req, records) == (14.0, 14.0)

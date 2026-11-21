"""
A lapsed certificate fails an "every 2 years" hours or courses requirement the
same way on every screen.

The compliance matrix (``_grade_member_requirement``), My Training
(``TrainingService.evaluate_requirement_detail``) and the requirements
progress check (``TrainingService.check_requirement_progress``) each had their
own version of the rule, and they disagreed (CLAUDE.md pitfall 29):

- **Courses:** only the matrix checked for a lapsed certificate, so My
  Training read met where the matrix read expired.
- **Hours:** My Training and the progress check read every completed record
  of the training type, in the window or not, so an old lapsed certificate
  failed a member the matrix graded met.

All three now call ``lapsed_biannual_certificate`` on the records the
requirement counts.
"""

from datetime import date
from types import SimpleNamespace

import pytest

from app.services.training_compliance import (
    _grade_member_requirement,
    lapsed_biannual_certificate,
)
from app.services.training_service import TrainingService
from tests.test_training_compliance import _make_record, _make_requirement

pytestmark = pytest.mark.unit

# A biannual window on this date runs from Jan 1, 2025 to Dec 31, 2026.
TODAY = date(2026, 6, 30)
# check_requirement_progress returns a model that requires a UUID id.
REQ_ID = "6f1c2a52-0d3e-4c9a-9b7e-2d8f5a1c3e40"
BIANNUAL = SimpleNamespace(value="biannual")


async def _three(req, records):
    """(matrix status, My Training is_met, progress check is_complete)."""
    grade = _grade_member_requirement(req, records, TODAY)
    detail = TrainingService.evaluate_requirement_detail(req, records, TODAY)
    # Everything preloaded, so the check reads nothing from a database.
    progress = await TrainingService(db=None).check_requirement_progress(
        "user-1",
        req.id,
        "org-1",
        waivers=[],
        requirement=req,
        completed_records=records,
        today=TODAY,
    )
    return grade.status, detail["is_met"], progress.is_complete


def _courses_requirement():
    return _make_requirement(
        id=REQ_ID,
        requirement_type=SimpleNamespace(value="courses"),
        frequency=BIANNUAL,
        required_hours=None,
        required_courses=["cpr"],
    )


class TestCourses:
    async def test_a_lapsed_certificate_fails_it_everywhere(self):
        records = [
            _make_record(
                course_id="cpr",
                completion_date=date(2025, 2, 1),
                expiration_date=date(2026, 2, 1),
            )
        ]
        assert await _three(_courses_requirement(), records) == (
            "expired",
            False,
            False,
        )

    async def test_my_training_says_why(self):
        records = [
            _make_record(
                course_id="cpr",
                completion_date=date(2025, 2, 1),
                expiration_date=date(2026, 2, 1),
            )
        ]
        detail = TrainingService.evaluate_requirement_detail(
            _courses_requirement(), records, TODAY
        )
        assert detail["cert_expired"] is True
        assert detail["blocks_activity"] is True

    async def test_a_current_certificate_meets_it_everywhere(self):
        records = [
            _make_record(
                course_id="cpr",
                completion_date=date(2025, 2, 1),
                expiration_date=date(2027, 2, 1),
            )
        ]
        assert await _three(_courses_requirement(), records) == (
            "completed",
            True,
            True,
        )


class TestHours:
    def _requirement(self):
        return _make_requirement(
            id=REQ_ID,
            frequency=BIANNUAL,
            training_type="certification",
            required_hours=8.0,
        )

    async def test_a_lapsed_certificate_outside_the_window_is_not_read(self):
        """Eight hours in the window, and a certificate from 2023 that lapsed
        in 2024: the requirement is met on every screen."""
        records = [
            _make_record(
                id="current",
                training_type="certification",
                completion_date=date(2026, 3, 1),
                hours_completed=8.0,
            ),
            _make_record(
                id="old",
                training_type="certification",
                completion_date=date(2023, 3, 1),
                expiration_date=date(2024, 3, 1),
                hours_completed=8.0,
            ),
        ]
        assert await _three(self._requirement(), records) == (
            "completed",
            True,
            True,
        )

    async def test_a_lapsed_certificate_among_the_counted_hours_fails_it(self):
        records = [
            _make_record(
                training_type="certification",
                completion_date=date(2025, 3, 1),
                expiration_date=date(2026, 3, 1),
                hours_completed=8.0,
            )
        ]
        assert await _three(self._requirement(), records) == (
            "expired",
            False,
            False,
        )


class TestTheRule:
    def test_only_biannual_requirements_are_overridden(self):
        lapsed = _make_record(expiration_date=date(2026, 1, 1))
        annual = _make_requirement(frequency=SimpleNamespace(value="annual"))
        assert lapsed_biannual_certificate(annual, [lapsed], TODAY) is None
        biannual = _make_requirement(frequency=BIANNUAL)
        assert lapsed_biannual_certificate(biannual, [lapsed], TODAY) is lapsed

    def test_the_certificate_expiring_last_decides(self):
        renewed = [
            _make_record(id="old", expiration_date=date(2026, 1, 1)),
            _make_record(id="new", expiration_date=date(2028, 1, 1)),
        ]
        biannual = _make_requirement(frequency=BIANNUAL)
        assert lapsed_biannual_certificate(biannual, renewed, TODAY) is None

    def test_records_without_an_expiry_never_lapse(self):
        biannual = _make_requirement(frequency=BIANNUAL)
        assert lapsed_biannual_certificate(biannual, [_make_record()], TODAY) is None


class TestCertificateExpiryOnMyTraining:
    """My Training reports the graded certificate's expiry, so the card can
    say "On file (Expires ...)" or "Expired ..." instead of 1/1 or 0/1."""

    def _requirement(self):
        return _make_requirement(
            requirement_type=SimpleNamespace(value="certification"),
            frequency=BIANNUAL,
            training_type="certification",
            required_hours=None,
        )

    def test_a_current_certificate_reports_its_expiry(self):
        records = [
            _make_record(
                training_type="certification",
                completion_date=date(2025, 3, 14),
                expiration_date=date(2027, 3, 14),
            )
        ]
        detail = TrainingService.evaluate_requirement_detail(
            self._requirement(), records, TODAY
        )
        assert detail["is_met"] is True
        assert detail["expiry_date"] == "2027-03-14"

    def test_a_lapsed_certificate_reports_when_it_lapsed(self):
        records = [
            _make_record(
                training_type="certification",
                completion_date=date(2024, 3, 14),
                expiration_date=date(2026, 3, 14),
            )
        ]
        detail = TrainingService.evaluate_requirement_detail(
            self._requirement(), records, TODAY
        )
        assert detail["is_met"] is False
        assert detail["cert_expired"] is True
        assert detail["expiry_date"] == "2026-03-14"

    def test_nothing_on_file_reports_no_expiry(self):
        detail = TrainingService.evaluate_requirement_detail(
            self._requirement(), [], TODAY
        )
        assert detail["is_met"] is False
        assert detail["expiry_date"] is None

    def test_other_requirement_types_report_no_expiry(self):
        records = [_make_record(expiration_date=date(2027, 1, 1))]
        detail = TrainingService.evaluate_requirement_detail(
            _make_requirement(), records, TODAY
        )
        assert detail["expiry_date"] is None

"""My Training's requirement detail reports what the shared grader decided.

``TrainingService.evaluate_requirement_detail`` builds the per-requirement
breakdown My Training, the officer's member view, the compliance exports and
the forecast show. It used to decide met / expired by its own rules, and three
branches disagreed with ``training_compliance``'s grader -- the one the
matrix, the profile card and the dashboard read (CLAUDE.md pitfall #29,
review finding of 2026-11-21). It now takes ``is_met`` and ``cert_expired``
from that grader and keeps its own code for display fields only.

Its ``days_until_due`` was also measured from the evaluation cut-off rather
than the real day, so with the current month excluded a passed due date read
as upcoming.

No database: the inputs are the in-memory shapes both functions accept.
"""

from datetime import date
from types import SimpleNamespace

import pytest

from app.models.training import TrainingStatus
from app.services.training_compliance import evaluate_member_requirement_detail
from app.services.training_service import TrainingService
from app.utils.training_match_key import training_match_key

pytestmark = pytest.mark.unit

TODAY = date(2026, 11, 20)


def _req(**kwargs):
    fields = {
        "id": "req-1",
        "name": "Requirement",
        "description": None,
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
        "category_ids": None,
        "applies_to_all": True,
        "required_roles": None,
        "required_membership_types": None,
        "required_positions": None,
        "start_date": None,
        "due_date": None,
        "period_start_month": None,
        "period_start_day": None,
        "period_end_month": None,
        "period_end_day": None,
        "include_current_month": None,
        "name_match_until": date(2026, 10, 5),
        "registry_code": None,
        "registry_name": None,
    }
    fields.update(kwargs)
    return SimpleNamespace(**fields)


def _record(**kwargs):
    fields = {
        "id": "rec",
        "course_id": None,
        "course_name": "Drill",
        "course_code": None,
        "training_type": SimpleNamespace(value="continuing_education"),
        "status": TrainingStatus.COMPLETED,
        "completion_date": date(2026, 3, 15),
        "expiration_date": None,
        "hours_completed": 8.0,
        "credit_hours": 8.0,
        "certification_number": None,
        "issuing_agency": None,
        "category_id": None,
        "category_ids": None,
        "created_at": None,
    }
    fields.update(kwargs)
    fields["match_key"] = training_match_key(fields["course_name"])
    fields["certification_key"] = training_match_key(fields["certification_number"])
    return SimpleNamespace(**fields)


def _both(req, records, today=TODAY, include_current_month=True):
    detail = TrainingService.evaluate_requirement_detail(
        req, records, today, org_include_current_month=include_current_month
    )
    graded = evaluate_member_requirement_detail(
        req, records, today, org_include_current_month=include_current_month
    )
    return detail, graded


def _assert_agree(detail, graded):
    assert detail["is_met"] == (graded.status == TrainingStatus.COMPLETED.value)
    assert detail["cert_expired"] == (graded.status == "expired")


class TestDaysUntilDueFromTheRealDay:
    def test_a_passed_fixed_due_date_reads_overdue_with_the_month_excluded(self):
        req = _req(
            frequency=SimpleNamespace(value="one_time"),
            due_date_type="fixed_date",
            due_date=date(2026, 11, 10),
            required_hours=8.0,
        )
        detail = TrainingService.evaluate_requirement_detail(
            req, [], TODAY, org_include_current_month=False
        )
        assert detail["days_until_due"] == -10

    def test_a_closed_monthly_window_reads_overdue_with_the_month_excluded(self):
        # Graded for October (the cut-off is October 31); that window closed
        # twenty days before the real day.
        req = _req(frequency=SimpleNamespace(value="monthly"), required_hours=4.0)
        detail = TrainingService.evaluate_requirement_detail(
            req, [], TODAY, org_include_current_month=False
        )
        assert detail["due_date"] == "2026-10-31"
        assert detail["days_until_due"] == -20

    def test_unchanged_with_the_month_included(self):
        # A guard: with the month included the cut-off is the real day.
        req = _req(
            frequency=SimpleNamespace(value="one_time"),
            due_date_type="fixed_date",
            due_date=date(2026, 11, 10),
            required_hours=8.0,
        )
        detail = TrainingService.evaluate_requirement_detail(req, [], TODAY)
        assert detail["days_until_due"] == -10


class TestTheThreeReportedDisagreements:
    def test_biannual_hours_ignores_an_unrelated_lapsed_certificate(self):
        """(a) 30 EMS hours in the window; a CPR card from 2023 that lapsed.
        The grader counts the window's matching records only: completed."""
        req = _req(
            frequency=SimpleNamespace(value="biannual"),
            category_ids=["ems"],
            required_hours=24.0,
        )
        records = [
            _record(
                id="ems",
                category_id="ems",
                hours_completed=30.0,
                completion_date=date(2026, 5, 1),
            ),
            _record(
                id="cpr",
                course_name="CPR",
                hours_completed=0.0,
                completion_date=date(2023, 6, 1),
                expiration_date=date(2025, 6, 1),
            ),
        ]
        detail, graded = _both(req, records)
        assert graded.status == TrainingStatus.COMPLETED.value
        _assert_agree(detail, graded)
        assert detail["blocks_activity"] is False

    def test_biannual_courses_with_a_lapsed_newest_expiry(self):
        """(b) The grader marks it expired; the detail called it met."""
        req = _req(
            requirement_type=SimpleNamespace(value="courses"),
            frequency=SimpleNamespace(value="biannual"),
            required_courses=["c1"],
            required_hours=None,
        )
        records = [
            _record(
                course_id="c1",
                completion_date=date(2025, 3, 1),
                expiration_date=date(2026, 3, 1),
            )
        ]
        detail, graded = _both(req, records)
        assert graded.status == "expired"
        _assert_agree(detail, graded)

    def test_hours_with_no_target_is_not_met_by_one_hour(self):
        """(c) The grader leaves it in progress, as the configuration
        warning promises members earn no credit."""
        req = _req(required_hours=0.0)
        detail, graded = _both(req, [_record()])
        assert graded.status == "in_progress"
        _assert_agree(detail, graded)


_CASES = {
    "hours met": (_req(), [_record(hours_completed=30.0)]),
    "hours short": (_req(), [_record(hours_completed=3.0)]),
    "hours none": (_req(), []),
    "hours by training type": (
        _req(training_type=SimpleNamespace(value="fire")),
        [_record(hours_completed=30.0)],
    ),
    "hours rolling": (
        _req(due_date_type="rolling", rolling_period_months=12),
        [_record(hours_completed=30.0, completion_date=date(2025, 12, 5))],
    ),
    "hours quarterly": (
        _req(frequency=SimpleNamespace(value="quarterly"), required_hours=4.0),
        [_record(hours_completed=4.0, completion_date=date(2026, 10, 2))],
    ),
    "courses met": (
        _req(
            requirement_type=SimpleNamespace(value="courses"),
            required_courses=["c1", "c2"],
        ),
        [_record(course_id="c1"), _record(course_id="c2")],
    ),
    "courses short": (
        _req(
            requirement_type=SimpleNamespace(value="courses"),
            required_courses=["c1", "c2"],
        ),
        [_record(course_id="c1")],
    ),
    "certification current": (
        _req(requirement_type=SimpleNamespace(value="certification"), name="EMT"),
        [_record(course_name="EMT", expiration_date=date(2027, 6, 1))],
    ),
    "certification lapsed": (
        _req(requirement_type=SimpleNamespace(value="certification"), name="EMT"),
        [_record(course_name="EMT", expiration_date=date(2026, 6, 1))],
    ),
    "certification never held": (
        _req(requirement_type=SimpleNamespace(value="certification"), name="EMT"),
        [],
    ),
    "calls met": (
        _req(requirement_type=SimpleNamespace(value="calls"), required_calls=2),
        [_record(id="a"), _record(id="b")],
    ),
    "calls short": (
        _req(requirement_type=SimpleNamespace(value="calls"), required_calls=12),
        [_record()],
    ),
    "shifts from records": (
        _req(requirement_type=SimpleNamespace(value="shifts"), required_shifts=1),
        [_record()],
    ),
    "biannual hours current card": (
        _req(frequency=SimpleNamespace(value="biannual")),
        [
            _record(
                hours_completed=30.0,
                completion_date=date(2026, 2, 1),
                expiration_date=date(2027, 2, 1),
            )
        ],
    ),
}


@pytest.mark.parametrize("include_current_month", [True, False])
@pytest.mark.parametrize("case", sorted(_CASES))
def test_detail_agrees_with_the_grader(case, include_current_month):
    req, records = _CASES[case]
    detail, graded = _both(req, records, include_current_month=include_current_month)
    _assert_agree(detail, graded)

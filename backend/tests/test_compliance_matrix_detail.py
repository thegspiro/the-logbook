"""
Tests for the detail-returning compliance evaluator and the extra fields the
compliance matrix serves on top of it.

The triage view needs to say *why* a member is short — "18 of 24 hours",
"target reduced for 2 waived months" — which means the numbers the evaluator
already computes have to survive the return. These tests pin those numbers and,
just as importantly, pin that the original three-tuple contract is unchanged:
``evaluate_member_requirement`` is called from four places and a large existing
suite, and the refactor is only safe while the two agree.
"""

from datetime import date
from types import SimpleNamespace

import pytest

from app.api.v1.endpoints.training import (
    _requirement_target,
    _requirement_target_unit,
)
from app.services.training_compliance import (
    classify_standing,
    evaluate_member_requirement,
    evaluate_member_requirement_detail,
)
from app.services.training_waiver_service import WaiverPeriod

pytestmark = [pytest.mark.unit]

TODAY = date(2026, 9, 5)


def _make_requirement(**kwargs):
    defaults = {
        "id": "req-1",
        "name": "Annual Training Hours",
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
        "category_ids": None,
        "recency_days": None,
        "registry_code": None,
        "registry_name": None,
        "period_start_month": None,
        "period_start_day": None,
        "period_end_month": None,
        "period_end_day": None,
        "include_current_month": None,
    }
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def _make_record(**kwargs):
    from app.models.training import TrainingStatus

    defaults = {
        "id": "rec-1",
        "user_id": "user-1",
        "organization_id": "org-1",
        "course_id": None,
        "course_name": "Test Course",
        "course_code": "TC-101",
        "training_type": None,
        "status": TrainingStatus.COMPLETED,
        "completion_date": date(2026, 3, 15),
        "expiration_date": None,
        "hours_completed": 8.0,
        "certification_number": None,
        "issuing_agency": None,
    }
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


class TestWrapperMatchesDetail:
    """The three-tuple function must stay a pure projection of the detail."""

    @pytest.mark.parametrize(
        ("req_kwargs", "records"),
        [
            ({}, [_make_record(hours_completed=8.0)]),
            ({}, [_make_record(hours_completed=30.0)]),
            ({}, []),
            (
                {
                    "requirement_type": SimpleNamespace(value="shifts"),
                    "required_hours": None,
                    "required_shifts": 6,
                },
                [_make_record(), _make_record(id="rec-2")],
            ),
            (
                {
                    "requirement_type": SimpleNamespace(value="calls"),
                    "required_hours": None,
                    "required_calls": 10,
                },
                [],
            ),
            (
                {
                    "requirement_type": SimpleNamespace(value="certification"),
                    "required_hours": None,
                    "frequency": SimpleNamespace(value="biannual"),
                },
                [_make_record(expiration_date=date(2025, 1, 1))],
            ),
            (
                {
                    "requirement_type": SimpleNamespace(value="courses"),
                    "required_hours": None,
                    "required_courses": ["c1", "c2"],
                },
                [_make_record(course_id="c1")],
            ),
            (
                {
                    "requirement_type": SimpleNamespace(value="skills_evaluation"),
                    "required_hours": None,
                },
                [_make_record(course_name="Annual Training Hours refresher")],
            ),
        ],
    )
    def test_tuple_is_the_detail_projection(self, req_kwargs, records):
        req = _make_requirement(**req_kwargs)
        triple = evaluate_member_requirement(req, records, TODAY)
        detail = evaluate_member_requirement_detail(req, records, TODAY)
        assert triple == (
            detail.status,
            detail.completion_date,
            detail.expiry_date,
        )


class TestHoursProgress:
    def test_reports_hours_logged_against_target(self):
        req = _make_requirement(required_hours=24.0)
        records = [
            _make_record(hours_completed=8.0),
            _make_record(id="rec-2", hours_completed=10.0),
        ]
        ev = evaluate_member_requirement_detail(req, records, TODAY)
        assert ev.status == "in_progress"
        assert ev.progress_current == 18.0
        assert ev.progress_required == 24.0
        assert ev.progress_unit == "hours"
        assert ev.waived_months == 0
        assert ev.base_required == 24.0

    def test_nothing_recorded_still_reports_the_target(self):
        """A zero has to be a zero *against something*, or the row cannot
        explain what the member owes."""
        ev = evaluate_member_requirement_detail(_make_requirement(), [], TODAY)
        assert ev.status == "not_started"
        assert ev.progress_current == 0
        assert ev.progress_required == 24.0

    def test_waiver_lowers_the_target_and_says_by_how_many_months(self):
        req = _make_requirement(required_hours=24.0)
        waivers = [
            WaiverPeriod(
                start_date=date(2026, 6, 1),
                end_date=date(2026, 7, 31),
                requirement_ids=None,
            )
        ]
        ev = evaluate_member_requirement_detail(
            req, [_make_record(hours_completed=18.0)], TODAY, waivers=waivers
        )
        assert ev.waived_months == 2
        assert ev.base_required == 24.0
        # 24 hours prorated over the 10 unwaived months of a 12-month window.
        assert ev.progress_required == 20.0
        assert ev.progress_current == 18.0
        assert ev.status == "in_progress"

        # The reduced target — not the original — is what decides the status:
        # 20 hours would not have met an unwaived 24.
        met = evaluate_member_requirement_detail(
            req, [_make_record(hours_completed=20.0)], TODAY, waivers=waivers
        )
        assert met.status == "completed"
        unwaived = evaluate_member_requirement_detail(
            req, [_make_record(hours_completed=20.0)], TODAY
        )
        assert unwaived.status == "in_progress"

    def test_window_and_as_of_are_reported(self):
        ev = evaluate_member_requirement_detail(_make_requirement(), [], TODAY)
        assert ev.window_start == "2026-01-01"
        assert ev.window_end == "2026-12-31"
        assert ev.as_of == "2026-09-05"

    def test_as_of_excludes_the_in_progress_month_when_configured(self):
        ev = evaluate_member_requirement_detail(
            _make_requirement(), [], TODAY, org_include_current_month=False
        )
        assert ev.as_of == "2026-08-31"


class TestCountableTypes:
    def test_shifts(self):
        req = _make_requirement(
            requirement_type=SimpleNamespace(value="shifts"),
            required_hours=None,
            required_shifts=6,
        )
        records = [_make_record(), _make_record(id="rec-2")]
        ev = evaluate_member_requirement_detail(req, records, TODAY)
        assert (ev.progress_current, ev.progress_required) == (2, 6)
        assert ev.progress_unit == "shifts"

    def test_calls(self):
        req = _make_requirement(
            requirement_type=SimpleNamespace(value="calls"),
            required_hours=None,
            required_calls=10,
        )
        ev = evaluate_member_requirement_detail(req, [_make_record()], TODAY)
        assert (ev.progress_current, ev.progress_required) == (1, 10)
        assert ev.progress_unit == "calls"

    def test_courses(self):
        req = _make_requirement(
            requirement_type=SimpleNamespace(value="courses"),
            required_hours=None,
            required_courses=["c1", "c2", "c3"],
        )
        records = [_make_record(course_id="c1"), _make_record(id="r2", course_id="c2")]
        ev = evaluate_member_requirement_detail(req, records, TODAY)
        assert (ev.progress_current, ev.progress_required) == (2, 3)
        assert ev.progress_unit == "courses"

    def test_certification_has_no_count(self):
        """A cert is held or it is not — a progress bar would be a lie."""
        req = _make_requirement(
            requirement_type=SimpleNamespace(value="certification"),
            required_hours=None,
        )
        ev = evaluate_member_requirement_detail(req, [_make_record()], TODAY)
        assert ev.progress_current is None
        assert ev.progress_required is None
        assert ev.progress_unit is None

    def test_courses_with_an_empty_list_reports_no_count(self):
        req = _make_requirement(
            requirement_type=SimpleNamespace(value="courses"),
            required_hours=None,
            required_courses=[],
        )
        ev = evaluate_member_requirement_detail(req, [], TODAY)
        assert ev.status == "not_started"
        assert ev.progress_required is None


class TestRequirementTargetHelpers:
    @pytest.mark.parametrize(
        ("kwargs", "target", "unit"),
        [
            ({"required_hours": 24.0}, 24.0, "hours"),
            (
                {
                    "requirement_type": SimpleNamespace(value="shifts"),
                    "required_shifts": 6,
                },
                6.0,
                "shifts",
            ),
            (
                {
                    "requirement_type": SimpleNamespace(value="calls"),
                    "required_calls": 10,
                },
                10.0,
                "calls",
            ),
            (
                {
                    "requirement_type": SimpleNamespace(value="courses"),
                    "required_courses": ["a", "b"],
                },
                2.0,
                "courses",
            ),
            (
                {"requirement_type": SimpleNamespace(value="certification")},
                None,
                None,
            ),
        ],
    )
    def test_target_and_unit(self, kwargs, target, unit):
        base = {"required_hours": None}
        base.update(kwargs)
        req = _make_requirement(**base)
        assert _requirement_target(req) == target
        assert _requirement_target_unit(req) == unit


class TestClassifyStanding:
    def test_no_requirements_is_compliant(self):
        assert classify_standing(0, 0) == ("compliant", 100.0)

    def test_percentage_mode(self):
        assert classify_standing(6, 6)[0] == "compliant"
        assert classify_standing(5, 6)[0] == "at_risk"
        assert classify_standing(1, 6)[0] == "non_compliant"

    def test_all_required_mode_needs_every_one(self):
        status, pct = classify_standing(
            5, 6, compliant_threshold=80.0, threshold_type="all_required"
        )
        assert status == "at_risk"
        assert pct == 83.3
        assert classify_standing(6, 6, threshold_type="all_required")[0] == "compliant"

    def test_matches_the_legacy_branch_it_replaced(self):
        """The rule moved out of _evaluate_member_compliance; it must not have
        changed on the way."""

        def legacy(completed, total, compliant_t, at_risk_t, kind):
            pct = round(completed / total * 100, 1)
            if kind == "all_required":
                if completed >= total:
                    return "compliant", pct
                return ("at_risk" if pct >= at_risk_t else "non_compliant"), pct
            if pct >= compliant_t:
                return "compliant", pct
            return ("at_risk" if pct >= at_risk_t else "non_compliant"), pct

        for total in range(1, 8):
            for completed in range(0, total + 1):
                for kind in ("percentage", "all_required"):
                    for compliant_t, at_risk_t in ((100.0, 75.0), (80.0, 50.0)):
                        assert classify_standing(
                            completed, total, compliant_t, at_risk_t, kind
                        ) == legacy(completed, total, compliant_t, at_risk_t, kind)

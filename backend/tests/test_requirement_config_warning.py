"""
Non-blocking misconfiguration warning for training requirements.

A requirement whose type has no target to measure against (e.g. a Course
requirement with no course linked) can never be completed — and before the
compliance fix it even read as 100%/compliant. Creation blocks it; editing does
not, so the response surfaces `config_warning` for the officer UI instead.
"""

from datetime import datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.models.training import RequirementType
from app.schemas.training import (
    TrainingRequirementCreate,
    TrainingRequirementResponse,
    requirement_config_warning,
)


def _orm(**overrides):
    base = dict(
        id=uuid4(),
        organization_id=uuid4(),
        active=True,
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 1),
        created_by=None,
        name="HIPAA Annual Renewal",
        description=None,
        requirement_type=RequirementType.COURSES,
        source="department",
        registry_name=None,
        registry_code=None,
        is_editable=True,
        allows_external_credit=False,
        training_type=None,
        required_hours=None,
        required_courses=[],
        required_shifts=None,
        required_calls=None,
        required_call_types=None,
        required_skills=None,
        checklist_items=None,
        passing_score=None,
        max_attempts=None,
        frequency="annual",
        year=None,
        applies_to_all=True,
        required_roles=None,
        required_positions=None,
        required_membership_types=None,
        start_date=None,
        due_date=None,
        time_limit_days=None,
        due_date_type="calendar_period",
        rolling_period_months=None,
        period_start_month=1,
        period_start_day=1,
        period_end_month=None,
        period_end_day=None,
        include_current_month=None,
        category_ids=None,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


class TestRequirementConfigWarning:
    def test_courses_without_a_course_warns(self):
        msg = requirement_config_warning(
            SimpleNamespace(
                requirement_type=RequirementType.COURSES, required_courses=[]
            )
        )
        assert msg is not None
        assert "course" in msg.lower()

    def test_hours_without_target_warns(self):
        msg = requirement_config_warning(
            SimpleNamespace(requirement_type=RequirementType.HOURS, required_hours=0)
        )
        assert msg is not None
        assert "hours" in msg.lower()

    def test_properly_configured_courses_has_no_warning(self):
        assert (
            requirement_config_warning(
                SimpleNamespace(
                    requirement_type=RequirementType.COURSES,
                    required_courses=["course-1"],
                )
            )
            is None
        )

    def test_checklist_type_is_not_flagged(self):
        # Types without a numeric quantity gate (checklist, certification,
        # skills) are not part of the target rule and never warn.
        assert (
            requirement_config_warning(
                SimpleNamespace(
                    requirement_type=RequirementType.CHECKLIST, checklist_items=None
                )
            )
            is None
        )


class TestResponseComputesWarning:
    def test_response_surfaces_warning_for_courses_without_course(self):
        resp = TrainingRequirementResponse.model_validate(_orm(required_courses=[]))
        assert resp.config_warning is not None
        # Serialized field is present for the frontend.
        assert "config_warning" in resp.model_dump()

    def test_response_no_warning_when_configured(self):
        resp = TrainingRequirementResponse.model_validate(
            _orm(required_courses=["course-1"])
        )
        assert resp.config_warning is None


class TestCreateStillBlocks:
    def test_create_rejects_courses_without_course(self):
        with pytest.raises(ValueError, match="required_courses is required"):
            TrainingRequirementCreate(
                name="HIPAA", requirement_type="courses", frequency="annual"
            )


class TestSingleTopicHoursWarning:
    """A HIPAA/OSHA hours requirement scoped by training type alone counts any
    hour of that type — two CAPCE medical courses met the HIPAA refresher."""

    def _hipaa_hours(self, **overrides):
        return _orm(
            requirement_type=RequirementType.HOURS,
            training_type="continuing_education",
            required_hours=1,
            registry_code="45 CFR 164.530(b)",
            **overrides,
        )

    def test_unscoped_hipaa_hours_requirement_warns(self):
        msg = requirement_config_warning(self._hipaa_hours())
        assert msg is not None
        assert "HIPAA" in msg
        assert "Courses requirement" in msg

    @pytest.mark.parametrize(
        ("code", "topic"),
        [("29 CFR 1910.1030", "bloodborne pathogens"), ("29 CFR 1910.120", "hazmat")],
    )
    def test_osha_refreshers_warn(self, code, topic):
        msg = requirement_config_warning(
            _orm(
                requirement_type=RequirementType.HOURS,
                training_type="refresher",
                required_hours=2,
                registry_code=code,
            )
        )
        assert msg is not None
        assert topic in msg

    def test_category_scoped_requirement_does_not_warn(self):
        assert (
            requirement_config_warning(self._hipaa_hours(category_ids=["cat-1"]))
            is None
        )

    def test_course_scoped_requirement_does_not_warn(self):
        assert (
            requirement_config_warning(self._hipaa_hours(required_courses=["course-1"]))
            is None
        )

    def test_genuine_hour_totals_do_not_warn(self):
        # NFPA 1001's 36 hours of any continuing education is the rule itself.
        assert (
            requirement_config_warning(
                _orm(
                    requirement_type=RequirementType.HOURS,
                    training_type="continuing_education",
                    required_hours=36,
                    registry_code="NFPA 1001",
                )
            )
            is None
        )

    def test_courses_requirement_with_the_code_does_not_warn(self):
        assert (
            requirement_config_warning(
                _orm(
                    registry_code="45 CFR 164.530(b)",
                    required_courses=["course-1"],
                )
            )
            is None
        )

    def test_response_surfaces_the_warning(self):
        resp = TrainingRequirementResponse.model_validate(self._hipaa_hours())
        assert resp.config_warning is not None
        assert "HIPAA" in resp.config_warning

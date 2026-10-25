"""A member who logged exactly the required hours is graded as having met them.

``hours_completed`` is a MySQL ``FLOAT``, and ``SUM()`` over it drifts: ten
records of 0.7 hours come back as 6.99999988, so a ``>=`` against a 7-hour
requirement said "not met". Adding records one at a time with ``+=`` drifts the
same way (0.1, 10.2 and 1.7 accumulate to 11.999999999999998). The built-in
``sum()`` is compensated on the Python versions this runs on (3.12+), so the
paths that use it were exact; they are pinned here anyway, because every hours
requirement is now graded through ``meets_required_hours``, which absorbs the
drift without rounding the total.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.services.competency_matrix_service import CompetencyMatrixService
from app.services.compliance_officer_service import ISOReadinessService
from app.services.training_compliance import _grade_member_requirement
from app.services.training_service import TrainingService
from app.utils.hours import meets_required_hours
from tests.test_hours_requirement_single_rule import TODAY
from tests.test_training_compliance import (
    _make_record,
    _make_requirement,
    _MockSession,
    _one,
    _scalar,
)

pytestmark = pytest.mark.unit

# Three records that land just under five hours when added one at a time.
DRIFTING_PARTS = (0.1, 4.1, 0.8)


def _records(parts):
    return [
        _make_record(id=f"r{i}", hours_completed=hours) for i, hours in enumerate(parts)
    ]


def _accumulate(parts):
    total = 0.0
    for part in parts:
        total += part
    return total


def test_the_parts_really_do_accumulate_below_the_target():
    assert _accumulate(DRIFTING_PARTS) < 5.0


class TestMeetsRequiredHours:
    @pytest.mark.parametrize(
        ("total", "required"),
        [
            (_accumulate(DRIFTING_PARTS), 5.0),
            (6.9999998807907104, 7.0),  # SUM() of ten MySQL FLOAT 0.7s
            (23.999999999999996, 24.0),
            (5.0, 5.0),
            (5.25, 5.0),
        ],
    )
    def test_a_total_equal_to_the_target_meets_it(self, total, required):
        assert meets_required_hours(total, required)

    @pytest.mark.parametrize(
        ("total", "required"),
        [
            (4.9, 5.0),
            (5.0 - 1 / 60, 5.0),  # one minute short
            (999.98, 1000.0),
            (0.0, 0.5),
            (2, 3),  # a whole-number count one short
        ],
    )
    def test_a_real_shortfall_is_still_short(self, total, required):
        assert not meets_required_hours(total, required)

    def test_absent_values_read_as_zero(self):
        assert not meets_required_hours(None, 1.0)
        assert meets_required_hours(None, 0)


class TestEveryGradingPathAgrees:
    def test_compliance_grade(self):
        req = _make_requirement(required_hours=5.0)
        grade = _grade_member_requirement(req, _records(DRIFTING_PARTS), TODAY)
        assert grade.status == "completed"

    def test_my_training_detail(self):
        req = _make_requirement(required_hours=5.0)
        detail = TrainingService.evaluate_requirement_detail(
            req, _records(DRIFTING_PARTS), TODAY
        )
        assert detail["is_met"] is True
        assert detail["progress_percentage"] == 100.0

    async def test_requirement_progress_from_preloaded_records(self):
        req = _make_requirement(id=str(uuid4()), required_hours=5.0)
        progress = await TrainingService(MagicMock()).check_requirement_progress(
            user_id="u1",
            requirement_id=req.id,
            organization_id="org-1",
            waivers=[],
            requirement=req,
            completed_records=_records(DRIFTING_PARTS),
            today=TODAY,
            shift_dates=[],
        )
        assert progress.is_complete is True
        assert progress.percentage_complete == 100.0

    async def test_requirement_progress_from_a_sql_sum(self, monkeypatch):
        monkeypatch.setattr(
            "app.services.training_service.resolve_org_today",
            AsyncMock(return_value=TODAY),
        )
        req = _make_requirement(id=str(uuid4()), required_hours=7.0)
        db = _MockSession([_one(req), _scalar(6.9999998807907104)])
        progress = await TrainingService(db).check_requirement_progress(
            user_id="u1", requirement_id=req.id, organization_id="org-1", waivers=[]
        )
        assert progress.is_complete is True
        assert progress.percentage_complete == 100.0

    def test_competency_matrix(self):
        req = _make_requirement(required_hours=5.0)
        cell = CompetencyMatrixService(MagicMock())._evaluate_requirement_status(
            req, _records(DRIFTING_PARTS), TODAY, TODAY
        )
        assert cell["status"] == "current"

    async def test_iso_readiness(self):
        member_id = str(uuid4())
        # Driver/Operator Training needs 12 hours; these sum to just under it.
        records = [
            SimpleNamespace(
                user_id=member_id,
                training_type="driver_training",
                hours_completed=hours,
                category_id=None,
                course_id=None,
            )
            for hours in (0.1, 10.2, 1.7)
        ]
        assert _accumulate(r.hours_completed for r in records) < 12

        def _scalars(items):
            result = MagicMock()
            result.scalars.return_value.all.return_value = items
            return result

        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _scalars([SimpleNamespace(id=member_id)]),
                _scalars(records),
                _scalars([]),
                _scalars([]),
            ]
        )
        result = await ISOReadinessService(db).get_iso_readiness("org-1", 2026)
        driver = next(
            c for c in result["categories"] if c["name"] == "Driver/Operator Training"
        )
        assert driver["members_meeting_requirement"] == 1

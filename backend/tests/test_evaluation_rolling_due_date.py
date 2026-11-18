"""A rolling evaluation-credited requirement falls due from its evaluations.

Owner decision (2026-11-16): My Training shows a due date for a rolling
evaluated-shifts, evaluated-calls, transports or refusals requirement, and
that date comes from the evidence the count reads. It is the latest counted
evaluation plus the rolling period, as a rolling shifts-worked requirement
falls due from the latest shift worked. It was anchored on training records,
which never count toward these types, so the member saw no due date, or one
from an unrelated record.
"""

import uuid
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from dateutil.relativedelta import relativedelta

from app.models.training import (
    DueDateType,
    RequirementFrequency,
    RequirementSource,
    RequirementType,
    TrainingRequirement,
    TrainingStatus,
)
from app.services.training_compliance import load_evaluation_credits
from app.services.training_service import TrainingService
from tests.test_shift_evaluation_credit import _submit
from tests.test_shift_evaluations import _scene
from tests.test_shift_requirement_counts_attendance import _shift_req

TODAY = date(2026, 6, 15)


def _rolling(**fields):
    """A rolling 12-month evaluated-shifts requirement."""
    return _shift_req(
        requirement_type=SimpleNamespace(value="evaluated_shifts"),
        shift_credited=False,
        due_date_type=SimpleNamespace(value="rolling"),
        rolling_period_months=12,
        required_shifts=4,
        **fields,
    )


def _detail(req, credits, records=()):
    return TrainingService.evaluate_requirement_detail(
        req, list(records), TODAY, evaluation_credits={str(req.id): credits}
    )


@pytest.mark.unit
class TestMyTrainingDueDate:
    def test_anchored_on_the_latest_evaluation(self):
        req = _rolling()
        detail = _detail(req, [(date(2025, 11, 2), 1.0), (date(2026, 1, 10), 1.0)])
        assert detail["due_date"] == str(date(2027, 1, 10))

    def test_an_evaluation_older_than_the_window_makes_it_overdue(self):
        req = _rolling()
        detail = _detail(req, [(date(2025, 3, 1), 1.0)])
        assert detail["due_date"] == str(date(2026, 3, 1))
        assert detail["completed_hours"] == 0

    def test_a_training_record_does_not_anchor_it(self):
        req = _rolling()
        record = SimpleNamespace(
            status=TrainingStatus.COMPLETED,
            completion_date=date(2026, 5, 1),
            expiration_date=None,
            training_type=None,
            course_name="Shifts",
            course_id=None,
            hours_completed=12,
        )
        detail = _detail(req, [], records=[record])
        assert detail["due_date"] is None

    def test_the_freshness_cutoff_still_applies(self):
        req = _rolling(recency_days=90)
        detail = _detail(req, [(date(2026, 1, 10), 1.0)])
        assert detail["due_date"] is None


async def _department_requirement(db, scene) -> TrainingRequirement:
    requirement = TrainingRequirement(
        id=str(uuid.uuid4()),
        organization_id=scene.org_id,
        name=f"Evaluated shifts {uuid.uuid4().hex[:6]}",
        requirement_type=RequirementType.EVALUATED_SHIFTS,
        source=RequirementSource.DEPARTMENT,
        frequency=RequirementFrequency.ANNUAL,
        due_date_type=DueDateType.ROLLING,
        rolling_period_months=12,
        required_shifts=4,
        active=True,
    )
    db.add(requirement)
    await db.flush()
    return requirement


@pytest.mark.integration
class TestLoadedFromEvaluations:
    async def test_check_requirement_progress_reports_it(self, db_session):
        scene = await _scene(db_session)
        requirement = await _department_requirement(db_session, scene)
        await _submit(db_session, scene)

        progress = await TrainingService(db_session).check_requirement_progress(
            scene.trainee.id, requirement.id, scene.org_id
        )

        assert progress.due_date == scene.shift.shift_date + relativedelta(months=12)

    async def test_full_history_reaches_past_the_window(self, db_session):
        scene = await _scene(db_session)
        requirement = await _department_requirement(db_session, scene)
        evaluation = await _submit(db_session, scene)
        old = scene.shift.shift_date - timedelta(days=500)
        evaluation.shift_date = old
        await db_session.commit()
        today = scene.shift.shift_date

        windowed = await load_evaluation_credits(
            db_session, scene.org_id, [scene.trainee.id], [requirement], today, True
        )
        full = await load_evaluation_credits(
            db_session,
            scene.org_id,
            [scene.trainee.id],
            [requirement],
            today,
            True,
            full_history=True,
        )

        assert windowed == {}
        assert full[str(scene.trainee.id)][requirement.id] == [(old, 1.0)]

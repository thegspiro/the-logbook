"""Evaluation credit follows changes made around the evaluation.

The shift-evaluation review (2026-11-13) found credit that stayed put when
something it depended on changed outside the evaluation itself: the
requirement's crediting rule, or the member's place on the shift (removed, or
marked No-show). Each now re-syncs the evaluations it affects. (A shift that
has started cannot be deleted, so an evaluated one never is.)
"""

import uuid

import pytest
from sqlalchemy import func, select

from app.models.training import (
    AssignmentStatus,
    ProgressCreditSource,
    RequirementProgressCredit,
    RequirementType,
    ShiftAssignment,
)
from app.services.scheduling_service import SchedulingService
from app.services.training_program_service import TrainingProgramService
from tests.test_shift_evaluation_credit import _requirement, _submit, _value
from tests.test_shift_evaluations import _scene

pytestmark = pytest.mark.integration


async def _evaluation_credits(db, progress) -> int:
    return (
        await db.execute(
            select(func.count(RequirementProgressCredit.id)).where(
                RequirementProgressCredit.progress_id == progress.id,
                RequirementProgressCredit.source_type
                == ProgressCreditSource.SHIFT_EVALUATION,
            )
        )
    ).scalar_one()


async def _trainee_seat(db, scene) -> ShiftAssignment:
    return (
        await db.execute(
            select(ShiftAssignment).where(
                ShiftAssignment.shift_id == scene.shift.id,
                ShiftAssignment.user_id == scene.trainee.id,
            )
        )
    ).scalar_one()


class TestARuleChangeRestatesTheCredit:
    async def test_switching_what_the_requirement_counts(self, db_session):
        scene = await _scene(db_session)
        progress = await _requirement(
            db_session,
            scene,
            RequirementType.TRANSPORTS,
            required_transports=20,
            required_refusals=20,
        )
        await _submit(db_session, scene)  # 4 transports, 2 refusals
        assert await _value(db_session, progress) == 4

        _, error = await TrainingProgramService(db_session).update_training_requirement(
            uuid.UUID(progress.requirement_id),
            scene.org_id,
            {"requirement_type": RequirementType.REFUSALS},
        )

        assert error is None
        assert await _value(db_session, progress) == 2

    async def test_a_type_evaluations_do_not_count_takes_it_back(self, db_session):
        scene = await _scene(db_session)
        progress = await _requirement(
            db_session,
            scene,
            RequirementType.TRANSPORTS,
            required_transports=20,
            required_shifts=20,
        )
        await _submit(db_session, scene)
        assert await _evaluation_credits(db_session, progress) == 1

        await TrainingProgramService(db_session).update_training_requirement(
            uuid.UUID(progress.requirement_id),
            scene.org_id,
            {"requirement_type": RequirementType.SHIFTS},
        )

        assert await _evaluation_credits(db_session, progress) == 0


class TestTheShiftAndTheSeat:
    async def test_removing_the_member_from_the_shift(self, db_session):
        scene = await _scene(db_session)
        progress = await _requirement(
            db_session, scene, RequirementType.EVALUATED_SHIFTS, required_shifts=10
        )
        await _submit(db_session, scene)
        seat = await _trainee_seat(db_session, scene)

        ok, error = await SchedulingService(db_session).delete_assignment(
            uuid.UUID(seat.id), scene.org_id
        )

        assert ok, error
        assert await _value(db_session, progress) == 0

    async def test_marking_the_member_a_no_show(self, db_session):
        scene = await _scene(db_session)
        progress = await _requirement(
            db_session, scene, RequirementType.EVALUATED_SHIFTS, required_shifts=10
        )
        await _submit(db_session, scene)
        seat = await _trainee_seat(db_session, scene)

        _, error = await SchedulingService(db_session).update_assignment(
            uuid.UUID(seat.id),
            scene.org_id,
            {"assignment_status": AssignmentStatus.NO_SHOW},
        )

        assert error is None
        assert await _value(db_session, progress) == 0

"""A combined evaluation's credit follows the programs it now counts for.

Owner decision (2026-11-16): when a program drops out of a combined
evaluation's scope (its form cleared while the enrollment stays active) and
the evaluation is saved again, the credit it gave that program is taken back.
It was kept, because the credit pass only visited the programs the evaluation
still named.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.shift_evaluation import COMBINED_SCOPE
from app.models.training import (
    ProgramRequirement,
    RequirementFrequency,
    RequirementProgress,
    RequirementProgressStatus,
    RequirementSource,
    RequirementType,
    TrainingModuleConfig,
    TrainingRequirement,
)
from app.services.shift_evaluation_service import ShiftEvaluationService
from tests.test_shift_evaluation_credit import _credits, _value
from tests.test_shift_evaluations import _complete, _enroll, _program, _scene, _template

pytestmark = pytest.mark.integration


async def _shifts_requirement(db, scene, program, enrollment) -> RequirementProgress:
    """A program's own evaluated-shifts requirement and the member's row."""
    requirement = TrainingRequirement(
        id=str(uuid.uuid4()),
        organization_id=scene.org_id,
        name=f"Evaluated shifts {uuid.uuid4().hex[:6]}",
        requirement_type=RequirementType.EVALUATED_SHIFTS,
        source=RequirementSource.DEPARTMENT,
        frequency=RequirementFrequency.ONE_TIME,
        required_shifts=10,
    )
    db.add(requirement)
    await db.flush()
    db.add(
        ProgramRequirement(
            id=str(uuid.uuid4()),
            program_id=program.id,
            requirement_id=requirement.id,
        )
    )
    progress = RequirementProgress(
        id=str(uuid.uuid4()),
        enrollment_id=enrollment.id,
        requirement_id=requirement.id,
        status=RequirementProgressStatus.NOT_STARTED,
        progress_value=0,
        progress_percentage=0,
    )
    db.add(progress)
    await db.flush()
    return progress


async def _combined_scene(db):
    """The trainee in three programs with forms, on a shift still under way,
    with one evaluation counting for all three."""
    scene = await _scene(db)
    # Still under way: a shift's evaluations are fixed once it ends, so only
    # a live one (or an outside shift) can have its combined scope change.
    now = datetime.now(timezone.utc)
    scene.shift.start_time = now - timedelta(hours=6)
    scene.shift.end_time = now + timedelta(hours=6)
    scene.shift.shift_date = scene.shift.start_time.date()
    db.add(
        TrainingModuleConfig(
            organization_id=scene.org_id,
            one_shift_evaluation_for_multiple_programs=True,
        )
    )
    others = []
    for name in ("Driver Candidate", "Paramedic Bridge"):
        form = await _template(db, scene.org_id, scene.officer.id, f"{name} Form")
        program = await _program(db, scene.org_id, name, form.id)
        enrollment = await _enroll(db, scene.org_id, scene.trainee, program)
        enrollment.enrolled_at = scene.enrollment.enrolled_at
        others.append((program, enrollment))
    await db.flush()
    rows = [await _shifts_requirement(db, scene, scene.program, scene.enrollment)]
    for program, enrollment in others:
        rows.append(await _shifts_requirement(db, scene, program, enrollment))
    return scene, others, rows


async def _save(db, scene):
    return await ShiftEvaluationService(db).save(
        scene.shift,
        scene.trainee.id,
        COMBINED_SCOPE,
        scene.org_id,
        _complete(),
        scene.officer,
    )


class TestADroppedProgramLosesTheCredit:
    async def test_saving_again_takes_back_the_dropped_programs_credit(
        self, db_session
    ):
        scene, others, (emt, driver, bridge) = await _combined_scene(db_session)
        evaluation = await _save(db_session, scene)
        assert len(evaluation.enrollment_ids) == 3
        for row in (emt, driver, bridge):
            assert await _value(db_session, row) == 1

        driver_program, _ = others[0]
        driver_program.shift_evaluation_template_id = None
        await db_session.commit()
        evaluation = await _save(db_session, scene)

        assert len(evaluation.enrollment_ids) == 2
        assert await _value(db_session, driver) == 0
        assert await _credits(db_session, driver) == 0
        # The programs it still counts for keep theirs, once each.
        for row in (emt, bridge):
            assert await _value(db_session, row) == 1
            assert await _credits(db_session, row) == 1

    async def test_a_save_that_drops_nothing_leaves_every_credit(self, db_session):
        scene, _, rows = await _combined_scene(db_session)
        await _save(db_session, scene)

        await _save(db_session, scene)

        for row in rows:
            assert await _value(db_session, row) == 1
            assert await _credits(db_session, row) == 1

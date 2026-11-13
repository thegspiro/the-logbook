"""Regression tests for the 2026-11-13 review of the shift-evaluation work.

Each class names the finding it pins down. Every test here failed against the
code as merged in #3884, #3902, #3922, #3956 and #4264.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

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
from app.services.shift_evaluation_service import (
    COMBINED_SCOPE,
    ShiftEvaluationService,
)
from tests.test_shift_evaluation_credit import _value
from tests.test_shift_evaluations import (
    _complete,
    _enroll,
    _program,
    _requirements,
    _scene,
    _template,
)

pytestmark = pytest.mark.integration


async def _progress(db, scene, program, enrollment, requirement_type, **targets):
    """A credited requirement on ``program``, with the member's progress row."""
    requirement = TrainingRequirement(
        id=str(uuid.uuid4()),
        organization_id=scene.org_id,
        name=f"{requirement_type.value} {uuid.uuid4().hex[:6]}",
        requirement_type=requirement_type,
        source=RequirementSource.DEPARTMENT,
        frequency=RequirementFrequency.ONE_TIME,
        **targets,
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


class TestOnlyProgramsJoinedByTheShiftDate:
    """A shift counts only toward programs the member had joined by its date."""

    async def test_a_department_shift_before_the_enrollment_asks_for_nothing(
        self, db_session
    ):
        scene = await _scene(db_session)
        scene.enrollment.enrolled_at = datetime.now(timezone.utc) + timedelta(days=2)
        await db_session.flush()

        reqs = await _requirements(db_session, scene)

        assert [r.member.id for r in reqs] == []

    async def test_a_combined_evaluation_skips_a_program_joined_after_the_shift(
        self, db_session
    ):
        scene = await _scene(db_session)
        db_session.add(
            TrainingModuleConfig(
                organization_id=scene.org_id,
                one_shift_evaluation_for_multiple_programs=True,
            )
        )
        driver_form = await _template(
            db_session, scene.org_id, scene.officer.id, "Driver Evaluation"
        )
        driver = await _program(
            db_session, scene.org_id, "Driver Candidate", driver_form.id
        )
        later = await _enroll(db_session, scene.org_id, scene.trainee, driver)
        later.enrolled_at = datetime.now(timezone.utc) + timedelta(days=2)
        await db_session.flush()
        emt_transports = await _progress(
            db_session,
            scene,
            scene.program,
            scene.enrollment,
            RequirementType.TRANSPORTS,
            required_transports=20,
        )
        driver_transports = await _progress(
            db_session,
            scene,
            driver,
            later,
            RequirementType.TRANSPORTS,
            required_transports=20,
        )

        [req] = await _requirements(db_session, scene)
        assert req.scope_key == COMBINED_SCOPE
        assert req.enrollment_ids == [scene.enrollment.id]
        assert [t.name for t in req.templates] == ["EMT Shift Evaluation"]

        await ShiftEvaluationService(db_session).save(
            scene.shift,
            scene.trainee.id,
            COMBINED_SCOPE,
            scene.org_id,
            _complete(),
            scene.officer,
        )

        assert await _value(db_session, emt_transports) == 4
        assert await _value(db_session, driver_transports) == 0

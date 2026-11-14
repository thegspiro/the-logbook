"""Evaluations credit a department requirement linked into a program.

Owner decision (2026-11-14): a department requirement of an evaluation type
(evaluated shifts, transports, refusals) linked into a program with "Link
existing" is credited by the member's shift evaluations, as the program's own
would be. A linked row reads the compliance grader (W26-1), so the grader
counts the evaluations — the same ones, worth the same units, that the
program credit path counts — and a training record no longer stands in for
them through the type-matching fallback.
"""

import uuid
from datetime import date

import pytest
from sqlalchemy import select

from app.models.training import (
    ProgramRequirement,
    RequirementFrequency,
    RequirementProgress,
    RequirementProgressStatus,
    RequirementSource,
    RequirementType,
    ShiftCompletionReport,
    TrainingModuleConfig,
    TrainingRecord,
    TrainingRequirement,
    TrainingStatus,
    TrainingType,
)
from app.services.shift_completion_service import ShiftCompletionService
from app.services.shift_evaluation_service import ShiftEvaluationService
from app.services.training_program_service import TrainingProgramService
from tests.test_shift_evaluations import _complete, _scene

pytestmark = pytest.mark.integration


async def _linked(db, scene, requirement_type, **fields):
    """A department requirement, linked into the scene's program."""
    requirement = TrainingRequirement(
        id=str(uuid.uuid4()),
        organization_id=scene.org_id,
        name=fields.pop("name", f"{requirement_type.value} {uuid.uuid4().hex[:6]}"),
        requirement_type=requirement_type,
        source=RequirementSource.DEPARTMENT,
        frequency=RequirementFrequency.ONE_TIME,
        active=True,
        **fields,
    )
    db.add(requirement)
    await db.flush()
    db.add(
        ProgramRequirement(
            id=str(uuid.uuid4()),
            program_id=scene.program.id,
            requirement_id=requirement.id,
            is_required=True,
            owns_requirement=False,
        )
    )
    progress = RequirementProgress(
        id=str(uuid.uuid4()),
        enrollment_id=scene.enrollment.id,
        requirement_id=requirement.id,
        status=RequirementProgressStatus.NOT_STARTED,
        progress_value=0,
        progress_percentage=0,
    )
    db.add(progress)
    await db.flush()
    assert await TrainingProgramService(db)._is_linked_row(progress)
    return progress


async def _row(db, progress) -> RequirementProgress:
    return (
        await db.execute(
            select(RequirementProgress)
            .where(RequirementProgress.id == progress.id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def _value(db, progress) -> float:
    return float((await _row(db, progress)).progress_value or 0)


async def _read(db, scene) -> None:
    """What every program-progress read does before it shows a linked row."""
    await TrainingProgramService(db).refresh_linked_progress([scene.enrollment])


async def _submit(db, scene, **overrides):
    return await ShiftEvaluationService(db).save(
        scene.shift,
        scene.trainee.id,
        scene.enrollment.id,
        scene.org_id,
        _complete(**overrides),
        scene.officer,
    )


class TestALinkedRequirementIsCreditedByEvaluations:
    async def test_a_submitted_evaluation_credits_the_linked_rows(self, db_session):
        scene = await _scene(db_session)
        shifts = await _linked(
            db_session, scene, RequirementType.EVALUATED_SHIFTS, required_shifts=10
        )
        transports = await _linked(
            db_session, scene, RequirementType.TRANSPORTS, required_transports=20
        )

        await _submit(db_session, scene)

        # Submission alone refreshes the linked rows; no read needed.
        assert await _value(db_session, shifts) == 1
        assert await _value(db_session, transports) == 4
        row = await _row(db_session, transports)
        assert row.progress_percentage == 20
        assert row.status == RequirementProgressStatus.IN_PROGRESS

    async def test_the_target_completes_the_linked_row(self, db_session):
        scene = await _scene(db_session)
        refusals = await _linked(
            db_session, scene, RequirementType.REFUSALS, required_refusals=2
        )

        await _submit(db_session, scene)

        row = await _row(db_session, refusals)
        assert float(row.progress_value or 0) == 2
        assert row.status == RequirementProgressStatus.COMPLETED

    async def test_the_lowest_rating_withholds_the_shift_when_asked(self, db_session):
        scene = await _scene(db_session)
        counted = await _linked(
            db_session, scene, RequirementType.EVALUATED_SHIFTS, required_shifts=10
        )
        strict = await _linked(
            db_session,
            scene,
            RequirementType.EVALUATED_SHIFTS,
            required_shifts=10,
            evaluation_excludes_lowest_rating=True,
        )
        body = _complete().model_dump()
        body["responses"]["als_assist"] = {"rating": 1, "comment": "Needs work"}

        await _submit(db_session, scene, responses=body["responses"])
        await _read(db_session, scene)

        assert await _value(db_session, counted) == 1
        assert await _value(db_session, strict) == 0

    async def test_a_draft_does_not_count(self, db_session):
        scene = await _scene(db_session)
        shifts = await _linked(
            db_session, scene, RequirementType.EVALUATED_SHIFTS, required_shifts=10
        )

        await _submit(db_session, scene, submit=False)
        await _read(db_session, scene)
        assert await _value(db_session, shifts) == 0

        await _submit(db_session, scene)
        assert await _value(db_session, shifts) == 1


class TestOnlyAnEvaluationTheMemberCanSeeCounts:
    async def _review_required(self, db, scene):
        db.add(
            TrainingModuleConfig(
                organization_id=scene.org_id, report_review_required=True
            )
        )
        await db.flush()

    async def _report(self, db, scene, status):
        report = ShiftCompletionReport(
            id=str(uuid.uuid4()),
            organization_id=scene.org_id,
            shift_id=scene.shift.id,
            trainee_id=scene.trainee.id,
            officer_id=scene.officer.id,
            shift_date=scene.shift.shift_date,
            hours_on_shift=12.0,
            review_status=status,
        )
        db.add(report)
        await db.flush()
        return report

    async def test_not_until_the_report_is_approved_and_not_after_a_flag(
        self, db_session
    ):
        scene = await _scene(db_session)
        await self._review_required(db_session, scene)
        shifts = await _linked(
            db_session, scene, RequirementType.EVALUATED_SHIFTS, required_shifts=10
        )
        report = await self._report(db_session, scene, "pending_review")

        await _submit(db_session, scene)
        await _read(db_session, scene)
        assert await _value(db_session, shifts) == 0

        review = ShiftCompletionService(db_session)
        await review.review_report(
            report.id, scene.org_id, str(scene.officer.id), "approved"
        )
        assert await _value(db_session, shifts) == 1

        await review.review_report(
            report.id, scene.org_id, str(scene.officer.id), "flagged"
        )
        assert await _value(db_session, shifts) == 0


class TestATrainingRecordIsNotAnEvaluation:
    async def test_a_record_of_the_matching_type_does_not_complete_it(self, db_session):
        scene = await _scene(db_session)
        shifts = await _linked(
            db_session,
            scene,
            RequirementType.EVALUATED_SHIFTS,
            name="Evaluated Ride-Alongs",
            required_shifts=1,
            training_type=TrainingType.CONTINUING_EDUCATION,
        )
        db_session.add(
            TrainingRecord(
                id=str(uuid.uuid4()),
                organization_id=scene.org_id,
                user_id=scene.trainee.id,
                course_name="Evaluated Ride-Alongs",
                training_type=TrainingType.CONTINUING_EDUCATION,
                status=TrainingStatus.COMPLETED,
                completion_date=date.today(),
                hours_completed=12,
            )
        )
        await db_session.flush()

        await _read(db_session, scene)

        row = await _row(db_session, shifts)
        assert row.status == RequirementProgressStatus.NOT_STARTED
        assert float(row.progress_value or 0) == 0

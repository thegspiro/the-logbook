"""Program credit from shift evaluations, against real tables.

Pins the crediting rules agreed for the evaluation requirement types:

  * evaluated shifts count one per submitted evaluation, or only those with no
    item at the form's lowest rating when the requirement says so;
  * transports and refusals count the totals the evaluation records;
  * credit lands when the member can see the evaluation: at submission, or
    once that shift's report is approved where the department reviews reports;
  * an edit restates the credit, and hiding the evaluation again takes it back;
  * re-running the sync never counts an evaluation twice;
  * the member's stats show an average per form, on that form's own scale.
"""

import uuid

import pytest
from sqlalchemy import func, select

from app.models.training import (
    ProgramRequirement,
    ProgressCreditSource,
    RequirementFrequency,
    RequirementProgress,
    RequirementProgressCredit,
    RequirementProgressStatus,
    RequirementSource,
    RequirementType,
    ShiftCompletionReport,
    TrainingModuleConfig,
    TrainingRequirement,
)
from app.services.shift_completion_service import ShiftCompletionService
from app.services.shift_evaluation_service import ShiftEvaluationService
from app.services.training_module_config_service import TrainingModuleConfigService
from app.services.training_program_service import TrainingProgramService
from tests.test_shift_evaluations import _complete, _scene

pytestmark = pytest.mark.integration


async def _requirement(db, scene, requirement_type, **targets):
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
            program_id=scene.program.id,
            requirement_id=requirement.id,
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
    return progress


async def _value(db, progress) -> float:
    await db.refresh(progress)
    return float(progress.progress_value or 0)


async def _credits(db, progress) -> int:
    return (
        await db.execute(
            select(func.count(RequirementProgressCredit.id)).where(
                RequirementProgressCredit.progress_id == progress.id,
                RequirementProgressCredit.source_type
                == ProgressCreditSource.SHIFT_EVALUATION,
            )
        )
    ).scalar_one()


async def _submit(db, scene, **overrides):
    return await ShiftEvaluationService(db).save(
        scene.shift,
        scene.trainee.id,
        scene.enrollment.id,
        scene.org_id,
        _complete(**overrides),
        scene.officer,
    )


def _with_rating(item_key: str, rating: int, comment: str = "Needs work"):
    body = _complete().model_dump()
    body["responses"][item_key] = {"rating": rating, "comment": comment}
    return body["responses"]


class TestWhatAnEvaluationIsWorth:
    async def test_a_submission_credits_one_shift_and_its_totals(self, db_session):
        scene = await _scene(db_session)
        shifts = await _requirement(
            db_session, scene, RequirementType.EVALUATED_SHIFTS, required_shifts=10
        )
        transports = await _requirement(
            db_session, scene, RequirementType.TRANSPORTS, required_transports=20
        )
        refusals = await _requirement(
            db_session, scene, RequirementType.REFUSALS, required_refusals=4
        )

        await _submit(db_session, scene)

        assert await _value(db_session, shifts) == 1
        assert await _value(db_session, transports) == 4
        assert await _value(db_session, refusals) == 2
        assert refusals.progress_percentage == 50
        assert refusals.status == RequirementProgressStatus.IN_PROGRESS

    async def test_a_draft_credits_nothing(self, db_session):
        scene = await _scene(db_session)
        shifts = await _requirement(
            db_session, scene, RequirementType.EVALUATED_SHIFTS, required_shifts=10
        )

        await _submit(db_session, scene, submit=False)

        assert await _value(db_session, shifts) == 0
        assert await _credits(db_session, shifts) == 0

    async def test_the_lowest_rating_withholds_the_shift_when_asked(self, db_session):
        scene = await _scene(db_session)
        counted = await _requirement(
            db_session, scene, RequirementType.EVALUATED_SHIFTS, required_shifts=10
        )
        strict = await _requirement(
            db_session,
            scene,
            RequirementType.EVALUATED_SHIFTS,
            required_shifts=10,
            evaluation_excludes_lowest_rating=True,
        )

        await _submit(db_session, scene, responses=_with_rating("als_assist", 1))

        assert await _value(db_session, counted) == 1
        assert await _value(db_session, strict) == 0

    async def test_a_rating_above_the_lowest_still_counts(self, db_session):
        scene = await _scene(db_session)
        strict = await _requirement(
            db_session,
            scene,
            RequirementType.EVALUATED_SHIFTS,
            required_shifts=10,
            evaluation_excludes_lowest_rating=True,
        )

        await _submit(db_session, scene, responses=_with_rating("als_assist", 2))

        assert await _value(db_session, strict) == 1

    async def test_reaching_the_target_completes_the_requirement(self, db_session):
        scene = await _scene(db_session)
        refusals = await _requirement(
            db_session, scene, RequirementType.REFUSALS, required_refusals=2
        )

        await _submit(db_session, scene)

        await db_session.refresh(refusals)
        assert refusals.status == RequirementProgressStatus.COMPLETED


class TestCreditFollowsTheEvaluation:
    async def test_saving_again_does_not_count_twice(self, db_session):
        scene = await _scene(db_session)
        shifts = await _requirement(
            db_session, scene, RequirementType.EVALUATED_SHIFTS, required_shifts=10
        )

        evaluation = await _submit(db_session, scene)
        await _submit(db_session, scene)
        await ShiftEvaluationService(db_session).sync_credit(evaluation, scene.org_id)

        assert await _value(db_session, shifts) == 1
        assert await _credits(db_session, shifts) == 1

    async def test_an_edit_restates_the_totals(self, db_session):
        scene = await _scene(db_session)
        transports = await _requirement(
            db_session, scene, RequirementType.TRANSPORTS, required_transports=20
        )

        await _submit(db_session, scene)
        await _submit(
            db_session,
            scene,
            statistics={"calls": 7, "transports": 6, "refusals": 1},
        )

        assert await _value(db_session, transports) == 6
        assert await _credits(db_session, transports) == 1

    async def test_an_edit_to_zero_takes_the_credit_back(self, db_session):
        scene = await _scene(db_session)
        transports = await _requirement(
            db_session, scene, RequirementType.TRANSPORTS, required_transports=20
        )

        await _submit(db_session, scene)
        await _submit(
            db_session,
            scene,
            statistics={"calls": 7, "transports": 0, "refusals": 0},
        )

        assert await _value(db_session, transports) == 0
        assert await _credits(db_session, transports) == 0

    async def test_another_evaluations_credit_is_untouched(self, db_session):
        scene = await _scene(db_session)
        transports = await _requirement(
            db_session, scene, RequirementType.TRANSPORTS, required_transports=20
        )
        transports.progress_value = 5
        await db_session.flush()

        await _submit(db_session, scene)

        assert await _value(db_session, transports) == 9


class TestCreditWaitsForReview:
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

    async def test_nothing_until_the_report_is_approved(self, db_session):
        scene = await _scene(db_session)
        await self._review_required(db_session, scene)
        shifts = await _requirement(
            db_session, scene, RequirementType.EVALUATED_SHIFTS, required_shifts=10
        )
        report = await self._report(db_session, scene, "pending_review")

        await _submit(db_session, scene)
        assert await _value(db_session, shifts) == 0

        await ShiftCompletionService(db_session).review_report(
            report.id, scene.org_id, str(scene.officer.id), "approved"
        )
        assert await _value(db_session, shifts) == 1

    async def test_flagging_an_approved_report_takes_it_back(self, db_session):
        scene = await _scene(db_session)
        await self._review_required(db_session, scene)
        shifts = await _requirement(
            db_session, scene, RequirementType.EVALUATED_SHIFTS, required_shifts=10
        )
        report = await self._report(db_session, scene, "approved")
        await _submit(db_session, scene)
        assert await _value(db_session, shifts) == 1

        await ShiftCompletionService(db_session).review_report(
            report.id, scene.org_id, str(scene.officer.id), "flagged"
        )

        assert await _value(db_session, shifts) == 0
        assert await _credits(db_session, shifts) == 0

    async def test_turning_review_off_releases_the_credit(self, db_session):
        scene = await _scene(db_session)
        await self._review_required(db_session, scene)
        shifts = await _requirement(
            db_session, scene, RequirementType.EVALUATED_SHIFTS, required_shifts=10
        )
        await self._report(db_session, scene, "pending_review")
        await _submit(db_session, scene)
        assert await _value(db_session, shifts) == 0

        await TrainingModuleConfigService(db_session).update_config(
            scene.org_id, report_review_required=False
        )

        assert await _value(db_session, shifts) == 1


class TestAveragesByForm:
    async def test_one_average_per_form_on_its_own_scale(self, db_session):
        scene = await _scene(db_session)
        await _submit(db_session, scene, responses=_with_rating("als_assist", 1))

        averages = await ShiftEvaluationService(db_session).averages_by_form(
            scene.trainee.id, scene.org_id
        )

        # Fifteen items at 3 and one at 1, out of the example form's 4.
        assert averages == [
            {
                "template_id": scene.template_id,
                "form_name": "EMT Shift Evaluation",
                "scale_max": 4,
                "average": round((15 * 3 + 1) / 16, 1),
                "evaluations": 1,
            }
        ]

    async def test_the_member_view_waits_for_review(self, db_session):
        scene = await _scene(db_session)
        db_session.add(
            TrainingModuleConfig(
                organization_id=scene.org_id, report_review_required=True
            )
        )
        await db_session.flush()
        await _submit(db_session, scene)
        service = ShiftEvaluationService(db_session)

        assert (
            await service.averages_by_form(
                scene.trainee.id, scene.org_id, member_view=True
            )
            == []
        )
        assert len(await service.averages_by_form(scene.trainee.id, scene.org_id)) == 1


class TestOnlyEvaluationsCredit:
    async def test_an_officer_cannot_apply_a_training_record(self, db_session):
        scene = await _scene(db_session)
        progress = await _requirement(
            db_session, scene, RequirementType.TRANSPORTS, required_transports=20
        )

        applied, error = await TrainingProgramService(
            db_session
        ).apply_training_to_requirement(
            user_id=scene.trainee.id,
            organization_id=scene.org_id,
            program_id=scene.program.id,
            requirement_id=progress.requirement_id,
            hours=2.0,
            verified_by=scene.officer.id,
            source_id=str(uuid.uuid4()),
        )

        assert applied is False
        assert error == (
            "That requirement is credited by shift evaluations, not by "
            "training records"
        )
        await db_session.refresh(progress)
        assert progress.status == RequirementProgressStatus.NOT_STARTED

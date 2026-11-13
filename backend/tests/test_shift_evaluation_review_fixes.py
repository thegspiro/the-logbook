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
from tests.test_shift_evaluation_links import _with_positions
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


async def _save(db, scene, body):
    return await ShiftEvaluationService(db).save(
        scene.shift,
        scene.trainee.id,
        scene.enrollment.id,
        scene.org_id,
        body,
        scene.officer,
    )


class TestASubmittedEvaluationStaysComplete:
    """Re-saving a submitted evaluation cannot strip it below a submission."""

    async def test_a_draft_save_cannot_empty_it(self, db_session):
        scene = await _scene(db_session)
        submitted = await _save(db_session, scene, _complete())
        rated = submitted.rated_count

        with pytest.raises(ValueError, match="Finish the evaluation"):
            await _save(
                db_session,
                scene,
                _complete(submit=False, responses={}, statistics={}),
            )

        await db_session.refresh(submitted)
        assert submitted.status == "submitted"
        assert submitted.rated_count == rated
        assert submitted.statistics["transports"] == 4

    async def test_a_complete_draft_save_still_updates_it(self, db_session):
        scene = await _scene(db_session)
        await _save(db_session, scene, _complete())

        again = await _save(
            db_session,
            scene,
            _complete(
                submit=False, statistics={"calls": 7, "transports": 5, "refusals": 1}
            ),
        )

        assert again.status == "submitted"
        assert again.statistics["transports"] == 5


class TestCountsAreCheckedAtSubmission:
    """A draft may hold counts the officer has not finished entering."""

    async def test_a_draft_keeps_counts_that_do_not_add_up_yet(self, db_session):
        scene = await _scene(db_session)
        counts = {"calls": 1, "transports": 4, "refusals": 2}

        draft = await _save(
            db_session, scene, _complete(submit=False, statistics=counts)
        )

        assert draft.status == "draft"
        assert draft.statistics == counts

    async def test_a_submission_is_refused(self, db_session):
        scene = await _scene(db_session)

        with pytest.raises(ValueError, match="cannot exceed the number of calls"):
            await _save(
                db_session,
                scene,
                _complete(statistics={"calls": 1, "transports": 4, "refusals": 2}),
            )


class TestAConflictIsRetriedOnce:
    async def test_a_conflict_that_persists_is_raised_not_recursed(
        self, db_session, monkeypatch
    ):
        from sqlalchemy.exc import IntegrityError

        scene = await _scene(db_session)
        await _save(db_session, scene, _complete(submit=False))
        commits = 0

        async def always_conflict():
            nonlocal commits
            commits += 1
            raise IntegrityError("INSERT", {}, Exception("duplicate"))

        async def keep_loaded():
            # The retry limit is what is under test; a real rollback would
            # expire the loaded rows this test then reads.
            return None

        monkeypatch.setattr(db_session, "commit", always_conflict)
        monkeypatch.setattr(db_session, "rollback", keep_loaded)

        with pytest.raises(IntegrityError):
            await _save(db_session, scene, _complete(submit=False))
        assert commits == 2


class TestARacingFirstSaveLandsOnTheRow:
    async def test_the_retry_reads_nothing_the_rollback_expired(
        self, db_session, monkeypatch
    ):
        from sqlalchemy.exc import IntegrityError

        scene = await _scene(db_session)
        await _save(db_session, scene, _complete(submit=False))
        real_commit = db_session.commit
        failed = False

        async def conflict_once():
            nonlocal failed
            if not failed:
                failed = True
                raise IntegrityError("INSERT", {}, Exception("duplicate"))
            await real_commit()

        async def expire_like_a_rollback():
            # What a rollback does to every loaded row, without undoing the
            # fixture's own transaction.
            db_session.expire_all()

        monkeypatch.setattr(db_session, "commit", conflict_once)
        monkeypatch.setattr(db_session, "rollback", expire_like_a_rollback)

        saved = await ShiftEvaluationService(db_session).save(
            scene.shift,
            str(scene.trainee.id),
            str(scene.enrollment.id),
            scene.org_id,
            _complete(),
            scene.officer,
        )

        assert failed
        assert saved.status == "submitted"


class TestNobodyReadsTheirOwnEvaluationEarly:
    """The evaluated member sees their evaluation only as a member would.

    Being the shift's officer, or holding training.manage, lets a member open
    everyone else's evaluations, not read their own draft or one still waiting
    on review.
    """

    async def _officer_evaluated(self, db):
        """The trainee is the shift's officer; another officer drafts theirs."""
        scene = await _scene(db)
        scene.shift.shift_officer_id = scene.trainee.id
        await db.flush()
        draft = await ShiftEvaluationService(db).save(
            scene.shift,
            scene.trainee.id,
            scene.enrollment.id,
            scene.org_id,
            _complete(submit=False),
            scene.officer,
        )
        return scene, draft

    async def test_the_form_opens_without_their_answers(self, db_session):
        from app.api.v1.endpoints import shift_evaluations as endpoints

        scene, _ = await self._officer_evaluated(db_session)

        form = await endpoints.get_shift_evaluation_form(
            shift_id=uuid.UUID(scene.shift.id),
            member_id=uuid.UUID(scene.trainee.id),
            scope_key=scene.enrollment.id,
            template_id=None,
            db=db_session,
            current_user=await _with_positions(db_session, scene.trainee),
        )

        assert form.evaluation is None
        assert form.requirement.evaluation is None

    async def test_the_roster_keeps_their_status_without_the_scores(self, db_session):
        from app.api.v1.endpoints import shift_evaluations as endpoints

        scene, draft = await self._officer_evaluated(db_session)

        roster = await endpoints.get_shift_evaluation_roster(
            shift_id=uuid.UUID(scene.shift.id),
            db=db_session,
            current_user=await _with_positions(db_session, scene.trainee),
        )

        [own] = [r for r in roster.requirements if r.member_id == scene.trainee.id]
        assert own.evaluation is not None
        assert own.evaluation.status == "draft"
        assert own.evaluation.average_rating is None
        assert own.evaluation.rated_count == 0
        assert own.evaluation.low_rating_count == 0

    async def test_a_training_officer_cannot_read_their_own_draft(
        self, db_session, monkeypatch
    ):
        from fastapi import HTTPException

        from app.api.v1.endpoints import shift_evaluations as endpoints

        scene, draft = await self._officer_evaluated(db_session)
        monkeypatch.setattr(endpoints, "_manages_training", lambda user: True)
        trainee = await _with_positions(db_session, scene.trainee)

        with pytest.raises(HTTPException) as refused:
            await endpoints.get_shift_evaluation(
                evaluation_id=uuid.UUID(draft.id), db=db_session, current_user=trainee
            )
        assert refused.value.status_code == 404

        listed = await endpoints.list_member_shift_evaluations(
            member_id=uuid.UUID(scene.trainee.id),
            start_date=None,
            end_date=None,
            db=db_session,
            current_user=trainee,
        )
        assert listed == []


class TestWithNoReportItWaitsForCloseOut:
    """Owner decision (2026-11-13): under report review, an evaluation of a
    member with no report of their own on the shift is visible, and credits,
    once the shift is closed out."""

    async def _review_required(self, db, scene):
        db.add(
            TrainingModuleConfig(
                organization_id=scene.org_id, report_review_required=True
            )
        )
        await db.flush()

    async def test_hidden_while_open_then_visible_and_credited_at_close_out(
        self, db_session
    ):
        from app.services.scheduling_service import SchedulingService

        scene = await _scene(db_session)
        await self._review_required(db_session, scene)
        shifts = await _progress(
            db_session,
            scene,
            scene.program,
            scene.enrollment,
            RequirementType.EVALUATED_SHIFTS,
            required_shifts=10,
        )
        service = ShiftEvaluationService(db_session)
        evaluation = await _save(db_session, scene, _complete())

        assert not await service.visible_to_member(evaluation, scene.org_id)
        assert await _value(db_session, shifts) == 0

        _, error = await SchedulingService(db_session).finalize_shift(
            uuid.UUID(scene.shift.id), scene.org_id, str(scene.officer.id)
        )
        assert error is None

        await db_session.refresh(evaluation)
        assert await service.visible_to_member(evaluation, scene.org_id)
        assert await _value(db_session, shifts) == 1

        _, error = await SchedulingService(db_session).reopen_shift(
            uuid.UUID(scene.shift.id), scene.org_id
        )
        assert error is None

        await db_session.refresh(evaluation)
        assert not await service.visible_to_member(evaluation, scene.org_id)
        assert await _value(db_session, shifts) == 0

    async def test_a_report_on_file_still_decides(self, db_session):
        from app.models.training import ShiftCompletionReport

        scene = await _scene(db_session)
        await self._review_required(db_session, scene)
        scene.shift.is_finalized = True
        db_session.add(
            ShiftCompletionReport(
                id=str(uuid.uuid4()),
                organization_id=scene.org_id,
                shift_id=scene.shift.id,
                trainee_id=scene.trainee.id,
                officer_id=scene.officer.id,
                shift_date=scene.shift.shift_date,
                hours_on_shift=12.0,
                review_status="pending_review",
            )
        )
        await db_session.flush()
        evaluation = await _save(db_session, scene, _complete())

        assert not await ShiftEvaluationService(db_session).visible_to_member(
            evaluation, scene.org_id
        )


async def _second_shift(db, scene):
    """Another ended shift, the day before, with the same crew."""
    from app.models.training import AssignmentStatus, Shift, ShiftAssignment

    start = scene.shift.start_time - timedelta(days=1)
    shift = Shift(
        id=str(uuid.uuid4()),
        organization_id=scene.org_id,
        shift_date=start.date(),
        start_time=start,
        end_time=start + timedelta(hours=12),
        shift_officer_id=scene.officer.id,
        created_by=scene.officer.id,
        platoon="B",
    )
    db.add(shift)
    db.add(
        ShiftAssignment(
            id=str(uuid.uuid4()),
            organization_id=scene.org_id,
            shift_id=shift.id,
            user_id=scene.trainee.id,
            position="ems",
            assignment_status=AssignmentStatus.CONFIRMED,
        )
    )
    await db.flush()
    return shift


class TestRevokedCreditReopensTheRequirement:
    """Owner decision (2026-11-13): an evaluation requirement completed by
    its credit goes back to In progress when the credit falls below target,
    but one an officer marked complete by hand stays complete."""

    async def test_falling_below_target_reopens_it(self, db_session):
        scene = await _scene(db_session)
        transports = await _progress(
            db_session,
            scene,
            scene.program,
            scene.enrollment,
            RequirementType.TRANSPORTS,
            required_transports=5,
        )
        await _save(
            db_session,
            scene,
            _complete(statistics={"calls": 7, "transports": 5, "refusals": 0}),
        )
        await db_session.refresh(transports)
        assert transports.status == RequirementProgressStatus.COMPLETED

        await _save(
            db_session,
            scene,
            _complete(statistics={"calls": 7, "transports": 2, "refusals": 0}),
        )

        await db_session.refresh(transports)
        assert float(transports.progress_value) == 2
        assert transports.status == RequirementProgressStatus.IN_PROGRESS
        assert transports.progress_percentage < 100

    async def test_an_officers_completion_stays(self, db_session):
        scene = await _scene(db_session)
        transports = await _progress(
            db_session,
            scene,
            scene.program,
            scene.enrollment,
            RequirementType.TRANSPORTS,
            required_transports=50,
        )
        transports.status = RequirementProgressStatus.COMPLETED
        await db_session.flush()

        await _save(db_session, scene, _complete())

        await db_session.refresh(transports)
        assert transports.status == RequirementProgressStatus.COMPLETED
        assert float(transports.progress_value) == 4

    async def test_a_completed_requirement_still_takes_credit(self, db_session):
        scene = await _scene(db_session)
        transports = await _progress(
            db_session,
            scene,
            scene.program,
            scene.enrollment,
            RequirementType.TRANSPORTS,
            required_transports=5,
        )
        # A second requirement still open, so meeting the first does not
        # complete the whole enrollment (which would call for no more
        # evaluations).
        await _progress(
            db_session,
            scene,
            scene.program,
            scene.enrollment,
            RequirementType.EVALUATED_SHIFTS,
            required_shifts=10,
        )
        await _save(
            db_session,
            scene,
            _complete(statistics={"calls": 7, "transports": 5, "refusals": 0}),
        )
        earlier = await _second_shift(db_session, scene)
        await ShiftEvaluationService(db_session).save(
            earlier,
            scene.trainee.id,
            scene.enrollment.id,
            scene.org_id,
            _complete(statistics={"calls": 7, "transports": 3, "refusals": 0}),
            scene.officer,
        )
        assert await _value(db_session, transports) == 8

        # So taking the first one back leaves the member at target.
        await _save(
            db_session,
            scene,
            _complete(statistics={"calls": 7, "transports": 2, "refusals": 0}),
        )
        await db_session.refresh(transports)
        assert float(transports.progress_value) == 5
        assert transports.status == RequirementProgressStatus.COMPLETED


class TestAWaivedTargetIsWholeShifts:
    """A waiver prorates an evaluation target to whole shifts, as it does a
    shift or call target: nobody can be evaluated on part of a shift."""

    async def test_the_implied_target_is_a_whole_number(self, db_session, monkeypatch):
        from datetime import date

        from app.services import training_program_service
        from app.services.training_waiver_service import WaiverPeriod

        scene = await _scene(db_session)
        scene.enrollment.enrolled_at = datetime.now(timezone.utc) - timedelta(days=330)
        await db_session.flush()
        shifts = await _progress(
            db_session,
            scene,
            scene.program,
            scene.enrollment,
            RequirementType.EVALUATED_SHIFTS,
            required_shifts=5,
        )
        today = date.today()
        month_start = (today.replace(day=1) - timedelta(days=95)).replace(day=1)
        month_end = (month_start + timedelta(days=32)).replace(day=1) - timedelta(
            days=1
        )

        async def one_month_waived(*args, **kwargs):
            return [WaiverPeriod(month_start, month_end)]

        monkeypatch.setattr(
            training_program_service, "fetch_user_waivers", one_month_waived
        )

        _, error = await training_program_service.TrainingProgramService(
            db_session
        ).update_requirement_progress(
            progress_id=shifts.id,
            organization_id=scene.org_id,
            updates=training_program_service.RequirementProgressUpdate(
                progress_value=3
            ),
        )
        assert error is None

        await db_session.refresh(shifts)
        implied_target = 3 / (shifts.progress_percentage / 100)
        assert implied_target < 5
        assert implied_target == pytest.approx(round(implied_target))

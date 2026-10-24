"""What deactivating a pipeline or a requirement means for everything else.

Three department decisions, each pinned here against a real database:

1. A deactivated pipeline is skipped as a *prerequisite* of other pipelines —
   nobody is blocked by it — and applies again once reactivated. The stored
   ``prerequisite_program_ids`` list is never rewritten.
2. A deactivated *requirement* is not required for pipeline or phase
   completion while it stays inactive, matching compliance grading. Recorded
   progress on it is kept, and the change is applied to in-progress
   enrollments straight away.
3. Deactivating a pipeline from its edit form (``PATCH active: false``)
   withdraws in-progress members exactly as deleting a pipeline with
   graduates does, and is audited as ``program_deactivated``.

DB-backed throughout, so marked ``integration`` (pitfall #30b).
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from app.models.training import (
    EnrollmentStatus,
    ProgramEnrollment,
    ProgramPhase,
    ProgramRequirement,
    ProgramStructureType,
    RequirementFrequency,
    RequirementProgress,
    RequirementProgressStatus,
    RequirementType,
    TrainingProgram,
    TrainingRequirement,
)
from app.schemas.training_program import (
    ProgramEnrollmentCreate,
    TrainingProgramCreate,
    TrainingProgramUpdate,
)
from app.services.training_program_service import (
    PROGRAM_DEACTIVATED_WITHDRAWAL_REASON,
    TrainingProgramService,
)

pytestmark = pytest.mark.integration


def _uid() -> str:
    return str(uuid.uuid4())


async def _program(svc, org_id, admin_id, name, **fields):
    program, error = await svc.create_training_program(
        TrainingProgramCreate(name=name, **fields), org_id, admin_id
    )
    assert error is None, error
    return program


async def _set_active(svc, org_id, program_id, active: bool) -> None:
    _, error = await svc.update_training_program(
        uuid.UUID(str(program_id)), org_id, TrainingProgramUpdate(active=active)
    )
    assert error is None, error


async def _reload_enrollment(db_session, enrollment_id) -> ProgramEnrollment:
    result = await db_session.execute(
        select(ProgramEnrollment)
        .where(ProgramEnrollment.id == str(enrollment_id))
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


# ---------------------------------------------------------------------------
# 1. An inactive prerequisite pipeline blocks nobody
# ---------------------------------------------------------------------------


class TestInactivePrerequisiteIsSkipped:
    async def test_enrollment_is_allowed_while_it_is_inactive_and_blocked_after(
        self, db_session, setup_org_and_admin
    ):
        org_id, member_id = setup_org_and_admin
        svc = TrainingProgramService(db_session)
        recruit = await _program(svc, org_id, member_id, "Recruit School")
        driver = await _program(
            svc,
            org_id,
            member_id,
            "Driver Operator",
            prerequisite_program_ids=[recruit.id],
        )

        async def eligibility_status() -> str:
            rows = await svc.get_enrollment_eligibility(uuid.UUID(driver.id), org_id)
            assert rows is not None
            return next(r for r in rows if str(r["user_id"]) == member_id)["status"]

        def enroll():
            return svc.enroll_member(
                ProgramEnrollmentCreate(
                    user_id=uuid.UUID(member_id), program_id=uuid.UUID(driver.id)
                ),
                org_id,
            )

        # Active prerequisite, not completed: blocked.
        assert await eligibility_status() == "prerequisite"

        # Deactivated: skipped by the eligibility picker and by enrollment.
        await _set_active(svc, org_id, recruit.id, False)
        assert await eligibility_status() == "eligible"
        assert await svc.missing_prerequisites([recruit.id], [member_id], org_id) == {}
        # The stored list is untouched; the detail lists it, flagged.
        stored = (
            await db_session.execute(
                select(TrainingProgram)
                .where(TrainingProgram.id == driver.id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        assert stored.prerequisite_program_ids == [recruit.id]
        await svc.attach_prerequisite_summaries([stored], org_id)
        assert stored.prerequisite_programs == [
            {"id": recruit.id, "name": "Recruit School", "active": False}
        ]

        enrollment, error = await enroll()
        assert error is None, error
        assert enrollment is not None

        # Withdraw them again so the next enrollment is not refused as a
        # duplicate, then reactivate the prerequisite: the gate is back.
        enrollment.status = EnrollmentStatus.WITHDRAWN
        await db_session.flush()
        await _set_active(svc, org_id, recruit.id, True)
        assert await eligibility_status() == "prerequisite"
        enrollment, error = await enroll()
        assert enrollment is None
        assert error == "Must first complete: Recruit School"

    async def test_bulk_enrollment_follows_the_same_rule(
        self, db_session, setup_org_and_admin
    ):
        org_id, member_id = setup_org_and_admin
        svc = TrainingProgramService(db_session)
        recruit = await _program(svc, org_id, member_id, "Recruit School")
        driver = await _program(
            svc,
            org_id,
            member_id,
            "Driver Operator",
            prerequisite_program_ids=[recruit.id],
        )
        await _set_active(svc, org_id, recruit.id, False)

        enrollments, errors = await svc.bulk_enroll_members(
            uuid.UUID(driver.id), [uuid.UUID(member_id)], org_id
        )

        assert errors == []
        assert len(enrollments) == 1


# ---------------------------------------------------------------------------
# 2. An inactive requirement is not required for completion
# ---------------------------------------------------------------------------


def _requirement(org_id: str, name: str) -> TrainingRequirement:
    return TrainingRequirement(
        id=_uid(),
        organization_id=org_id,
        name=name,
        requirement_type=RequirementType.HOURS,
        required_hours=4.0,
        frequency=RequirementFrequency.ONE_TIME,
        applies_to_all=False,
        active=True,
    )


def _progress(enrollment_id: str, requirement_id: str, pct: float):
    return RequirementProgress(
        id=_uid(),
        enrollment_id=enrollment_id,
        requirement_id=requirement_id,
        status=(
            RequirementProgressStatus.COMPLETED
            if pct >= 100
            else RequirementProgressStatus.IN_PROGRESS
        ),
        progress_value=4.0 * pct / 100,
        progress_percentage=pct,
    )


async def _flexible_program(db, org_id, member_id):
    """A two-requirement flexible program; the member has finished one."""
    program = TrainingProgram(
        id=_uid(),
        organization_id=org_id,
        name="Hazmat Ops",
        structure_type=ProgramStructureType.FLEXIBLE,
        active=True,
    )
    done = _requirement(org_id, "Hazmat Awareness")
    retiring = _requirement(org_id, "Legacy Decon Drill")
    db.add_all([program, done, retiring])
    await db.flush()
    for order, requirement in enumerate((done, retiring)):
        db.add(
            ProgramRequirement(
                id=_uid(),
                program_id=program.id,
                requirement_id=requirement.id,
                is_required=True,
                sort_order=order,
            )
        )
    running = ProgramEnrollment(
        id=_uid(),
        organization_id=org_id,
        user_id=member_id,
        program_id=program.id,
        status=EnrollmentStatus.ACTIVE,
        progress_percentage=50.0,
    )
    paused = ProgramEnrollment(
        id=_uid(),
        organization_id=org_id,
        user_id=member_id,
        program_id=program.id,
        status=EnrollmentStatus.ON_HOLD,
        progress_percentage=50.0,
    )
    db.add_all([running, paused])
    await db.flush()
    for enrollment in (running, paused):
        db.add_all(
            [
                _progress(enrollment.id, done.id, 100.0),
                _progress(enrollment.id, retiring.id, 0.0),
            ]
        )
    await db.flush()
    return program, done, retiring, running, paused


class TestInactiveRequirementIsNotRequired:
    async def test_deactivating_completes_the_program_and_reactivating_restores_it(
        self, db_session, setup_org_and_admin, monkeypatch
    ):
        org_id, member_id = setup_org_and_admin
        svc = TrainingProgramService(db_session)
        completion_notice = AsyncMock()
        evoc = AsyncMock()
        monkeypatch.setattr(svc, "_notify_program_completion", completion_notice)
        monkeypatch.setattr(svc, "_handle_evoc_completion", evoc)
        program, done, retiring, running, paused = await _flexible_program(
            db_session, org_id, member_id
        )
        assert set(await svc.get_required_requirement_ids(program_id=program.id)) == {
            done.id,
            retiring.id,
        }

        _, error = await svc.update_training_requirement(
            uuid.UUID(retiring.id), org_id, {"active": False}
        )
        assert error is None, error

        assert await svc.get_required_requirement_ids(program_id=program.id) == [
            done.id
        ]
        running_now = await _reload_enrollment(db_session, running.id)
        assert running_now.progress_percentage == 100.0
        # Completion goes through the normal rollup, side effects included.
        assert running_now.status == EnrollmentStatus.COMPLETED
        assert running_now.completed_at is not None
        completion_notice.assert_awaited_once()
        evoc.assert_awaited_once()
        # On hold is recalculated but never auto-completed.
        paused_now = await _reload_enrollment(db_session, paused.id)
        assert paused_now.progress_percentage == 100.0
        assert paused_now.status == EnrollmentStatus.ON_HOLD
        # Recorded progress on the inactive requirement is kept.
        kept = await db_session.execute(
            select(RequirementProgress).where(
                RequirementProgress.requirement_id == retiring.id
            )
        )
        assert len(kept.scalars().all()) == 2

        _, error = await svc.update_training_requirement(
            uuid.UUID(retiring.id), org_id, {"active": True}
        )
        assert error is None, error

        assert set(await svc.get_required_requirement_ids(program_id=program.id)) == {
            done.id,
            retiring.id,
        }
        paused_now = await _reload_enrollment(db_session, paused.id)
        assert paused_now.progress_percentage == 50.0
        # A graduate is not reopened by a reactivation.
        running_now = await _reload_enrollment(db_session, running.id)
        assert running_now.status == EnrollmentStatus.COMPLETED
        completion_notice.assert_awaited_once()

    async def test_an_inactive_requirement_no_longer_holds_a_phase_open(
        self, db_session, setup_org_and_admin, monkeypatch
    ):
        org_id, member_id = setup_org_and_admin
        svc = TrainingProgramService(db_session)
        program = TrainingProgram(
            id=_uid(),
            organization_id=org_id,
            name="Recruit Academy",
            structure_type=ProgramStructureType.PHASES,
            active=True,
        )
        done = _requirement(org_id, "Orientation Hours")
        retiring = _requirement(org_id, "Legacy Ladder Drill")
        later = _requirement(org_id, "Live Burn")
        db_session.add_all([program, done, retiring, later])
        await db_session.flush()
        first = ProgramPhase(
            id=_uid(), program_id=program.id, phase_number=1, name="Orientation"
        )
        second = ProgramPhase(
            id=_uid(), program_id=program.id, phase_number=2, name="Fireground"
        )
        db_session.add_all([first, second])
        await db_session.flush()
        for phase, requirement in ((first, done), (first, retiring), (second, later)):
            db_session.add(
                ProgramRequirement(
                    id=_uid(),
                    program_id=program.id,
                    phase_id=phase.id,
                    requirement_id=requirement.id,
                    is_required=True,
                    sort_order=0,
                )
            )
        enrollment = ProgramEnrollment(
            id=_uid(),
            organization_id=org_id,
            user_id=member_id,
            program_id=program.id,
            status=EnrollmentStatus.ACTIVE,
            current_phase_id=first.id,
        )
        db_session.add(enrollment)
        await db_session.flush()
        db_session.add_all(
            [
                _progress(enrollment.id, done.id, 100.0),
                _progress(enrollment.id, retiring.id, 0.0),
                _progress(enrollment.id, later.id, 0.0),
            ]
        )
        await db_session.flush()
        assert not await svc._is_phase_complete(enrollment.id, uuid.UUID(first.id))

        # Through the requirement library's delete, which deactivates a
        # requirement a pipeline still links.
        from app.api.v1.endpoints import training as training_endpoints

        monkeypatch.setattr(training_endpoints, "log_audit_event", AsyncMock())
        await training_endpoints.delete_requirement(
            requirement_id=uuid.UUID(retiring.id),
            db=db_session,
            current_user=SimpleNamespace(
                id=member_id, username="chief", organization_id=org_id
            ),
        )

        assert await svc._is_phase_complete(enrollment.id, uuid.UUID(first.id))
        now = await _reload_enrollment(db_session, enrollment.id)
        assert str(now.current_phase_id) == second.id
        assert now.progress_percentage == 50.0
        assert now.status == EnrollmentStatus.ACTIVE


# ---------------------------------------------------------------------------
# 3. Deactivating from the edit form withdraws in-progress members
# ---------------------------------------------------------------------------


class TestDeactivatingFromTheEditForm:
    async def test_patch_active_false_withdraws_in_progress_and_is_audited(
        self, db_session, setup_org_and_admin, monkeypatch
    ):
        from app.api.v1.endpoints import training_programs

        org_id, member_id = setup_org_and_admin
        svc = TrainingProgramService(db_session)
        program = await _program(svc, org_id, member_id, "Engine Company Ops")
        by_status = {}
        for status in (
            EnrollmentStatus.ACTIVE,
            EnrollmentStatus.ON_HOLD,
            EnrollmentStatus.COMPLETED,
            EnrollmentStatus.FAILED,
            EnrollmentStatus.EXPIRED,
        ):
            row = ProgramEnrollment(
                id=_uid(),
                organization_id=org_id,
                user_id=member_id,
                program_id=program.id,
                status=status,
            )
            db_session.add(row)
            by_status[status] = row.id
        await db_session.flush()
        audit = AsyncMock()
        monkeypatch.setattr(training_programs, "log_audit_event", audit)
        user = SimpleNamespace(id=member_id, username="chief", organization_id=org_id)

        updated = await training_programs.update_training_program(
            program_id=uuid.UUID(program.id),
            updates=TrainingProgramUpdate(active=False),
            db=db_session,
            current_user=user,
        )

        assert updated.active is False
        for status in (EnrollmentStatus.ACTIVE, EnrollmentStatus.ON_HOLD):
            row = await _reload_enrollment(db_session, by_status[status])
            assert row.status == EnrollmentStatus.WITHDRAWN
            assert row.withdrawal_reason == PROGRAM_DEACTIVATED_WITHDRAWAL_REASON
            assert row.withdrawn_at is not None
        for status in (
            EnrollmentStatus.COMPLETED,
            EnrollmentStatus.FAILED,
            EnrollmentStatus.EXPIRED,
        ):
            row = await _reload_enrollment(db_session, by_status[status])
            assert row.status == status
            assert row.withdrawal_reason is None
        audit.assert_awaited_once()
        assert audit.await_args.kwargs["event_data"] == {
            "program_id": program.id,
            "action": "program_deactivated",
        }
        assert audit.await_args.kwargs["severity"] == "warning"

        # Reactivating restores the flag only: nobody is re-enrolled.
        audit.reset_mock()
        await training_programs.update_training_program(
            program_id=uuid.UUID(program.id),
            updates=TrainingProgramUpdate(active=True),
            db=db_session,
            current_user=user,
        )
        row = await _reload_enrollment(db_session, by_status[EnrollmentStatus.ACTIVE])
        assert row.status == EnrollmentStatus.WITHDRAWN
        assert audit.await_args.kwargs["event_data"]["action"] == (
            "program_reactivated"
        )

    async def test_an_ordinary_edit_withdraws_nobody(
        self, db_session, setup_org_and_admin
    ):
        org_id, member_id = setup_org_and_admin
        svc = TrainingProgramService(db_session)
        program = await _program(svc, org_id, member_id, "Engine Company Ops")
        enrollment = ProgramEnrollment(
            id=_uid(),
            organization_id=org_id,
            user_id=member_id,
            program_id=program.id,
            status=EnrollmentStatus.ACTIVE,
        )
        db_session.add(enrollment)
        await db_session.flush()

        _, error = await svc.update_training_program(
            uuid.UUID(program.id),
            org_id,
            TrainingProgramUpdate(name="Engine Ops", active=True),
        )

        assert error is None, error
        row = await _reload_enrollment(db_session, enrollment.id)
        assert row.status == EnrollmentStatus.ACTIVE


# ---------------------------------------------------------------------------
# 4. Nothing active left: an empty required set is not a passing set
# ---------------------------------------------------------------------------


async def _viewer(db_session, user_id):
    """The fixture's member as the endpoints read them, permissions loaded up
    front: a lazy load inside an async session raises."""
    from sqlalchemy.orm import selectinload

    from app.models.user import User

    result = await db_session.execute(
        select(User)
        .options(selectinload(User.positions), selectinload(User.roles))
        .where(User.id == user_id)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


class TestNoActiveRequirementsCompletesNobody:
    async def test_every_required_item_inactive_completes_nobody_and_says_so(
        self, db_session, setup_org_and_admin, monkeypatch
    ):
        from app.api.v1.endpoints import training_programs

        org_id, member_id = setup_org_and_admin
        svc = TrainingProgramService(db_session)
        completion_notice = AsyncMock()
        monkeypatch.setattr(svc, "_notify_program_completion", completion_notice)
        program, done, retiring, running, _ = await _flexible_program(
            db_session, org_id, member_id
        )
        # Both items are recorded at 100% while both are deactivated, so the
        # only thing standing between the member and an automatic completion
        # is the rule itself.
        for row in (
            await db_session.execute(
                select(RequirementProgress).where(
                    RequirementProgress.enrollment_id == running.id
                )
            )
        ).scalars():
            row.progress_percentage = 100.0
            row.status = RequirementProgressStatus.COMPLETED
        done.active = False
        retiring.active = False
        await db_session.flush()

        await svc.recalculate_enrollments_for_requirement(retiring.id, org_id)

        now = await _reload_enrollment(db_session, running.id)
        assert now.status == EnrollmentStatus.ACTIVE
        assert now.completed_at is None
        assert now.progress_percentage == 50.0
        completion_notice.assert_not_awaited()

        viewer = await _viewer(db_session, member_id)
        progress = await training_programs.get_enrollment_progress(
            enrollment_id=uuid.UUID(running.id), db=db_session, current_user=viewer
        )
        assert progress.no_active_requirements is True
        assert progress.completed_requirements == 0
        assert progress.total_requirements == 0
        assert progress.enrollment.status == EnrollmentStatus.ACTIVE

        detail = await training_programs.get_training_program(
            program_id=uuid.UUID(program.id), db=db_session, current_user=viewer
        )
        assert detail.no_active_requirements is True
        assert detail.total_required == 0

        # One requirement back: the flag clears and the rollup resumes.
        done.active = True
        await db_session.flush()
        await svc.recalculate_enrollments_for_requirement(done.id, org_id)
        progress = await training_programs.get_enrollment_progress(
            enrollment_id=uuid.UUID(running.id), db=db_session, current_user=viewer
        )
        assert progress.no_active_requirements is False
        assert (await _reload_enrollment(db_session, running.id)).status == (
            EnrollmentStatus.COMPLETED
        )

    async def test_a_phase_whose_required_items_are_all_inactive_is_not_complete(
        self, db_session, setup_org_and_admin
    ):
        from app.api.v1.endpoints import training_programs

        org_id, member_id = setup_org_and_admin
        svc = TrainingProgramService(db_session)
        program = TrainingProgram(
            id=_uid(),
            organization_id=org_id,
            name="Recruit Academy",
            structure_type=ProgramStructureType.PHASES,
            active=True,
        )
        retired = _requirement(org_id, "Legacy Ladder Drill")
        later = _requirement(org_id, "Live Burn")
        db_session.add_all([program, retired, later])
        await db_session.flush()
        first = ProgramPhase(
            id=_uid(), program_id=program.id, phase_number=1, name="Orientation"
        )
        second = ProgramPhase(
            id=_uid(), program_id=program.id, phase_number=2, name="Fireground"
        )
        db_session.add_all([first, second])
        await db_session.flush()
        for phase, requirement in ((first, retired), (second, later)):
            db_session.add(
                ProgramRequirement(
                    id=_uid(),
                    program_id=program.id,
                    phase_id=phase.id,
                    requirement_id=requirement.id,
                    is_required=True,
                    sort_order=0,
                )
            )
        enrollment = ProgramEnrollment(
            id=_uid(),
            organization_id=org_id,
            user_id=member_id,
            program_id=program.id,
            status=EnrollmentStatus.ACTIVE,
            current_phase_id=first.id,
        )
        db_session.add(enrollment)
        await db_session.flush()
        db_session.add_all(
            [
                _progress(enrollment.id, retired.id, 100.0),
                _progress(enrollment.id, later.id, 0.0),
            ]
        )
        retired.active = False
        await db_session.flush()

        await svc.recalculate_enrollments_for_requirement(retired.id, org_id)

        assert not await svc._is_phase_complete(enrollment.id, uuid.UUID(first.id))
        now = await _reload_enrollment(db_session, enrollment.id)
        assert str(now.current_phase_id) == first.id
        assert now.status == EnrollmentStatus.ACTIVE
        assert await svc.phases_without_active_requirements(program.id) == [first.id]

        viewer = await _viewer(db_session, member_id)
        progress = await training_programs.get_enrollment_progress(
            enrollment_id=uuid.UUID(enrollment.id),
            db=db_session,
            current_user=viewer,
        )
        assert progress.phases_without_active_requirements == [first.id]
        # The pipeline as a whole still has an active requirement.
        assert progress.no_active_requirements is False

        # An officer can still move the member on by hand.
        moved, error = await svc.advance_enrollment_phase(
            uuid.UUID(enrollment.id), org_id, force=True
        )
        assert error is None, error
        assert str(moved.current_phase_id) == second.id

    async def test_a_phase_with_nothing_required_is_still_complete(
        self, db_session, setup_org_and_admin
    ):
        org_id, member_id = setup_org_and_admin
        svc = TrainingProgramService(db_session)
        program = TrainingProgram(
            id=_uid(),
            organization_id=org_id,
            name="Recruit Academy",
            structure_type=ProgramStructureType.PHASES,
            active=True,
        )
        optional = _requirement(org_id, "Station Tour")
        db_session.add_all([program, optional])
        await db_session.flush()
        phase = ProgramPhase(
            id=_uid(), program_id=program.id, phase_number=1, name="Welcome"
        )
        db_session.add(phase)
        await db_session.flush()
        db_session.add(
            ProgramRequirement(
                id=_uid(),
                program_id=program.id,
                phase_id=phase.id,
                requirement_id=optional.id,
                is_required=False,
                sort_order=0,
            )
        )
        await db_session.flush()

        assert await svc._is_phase_complete(_uid(), uuid.UUID(phase.id))
        assert await svc.phases_without_active_requirements(program.id) == []

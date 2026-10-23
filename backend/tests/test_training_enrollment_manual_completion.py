"""An officer marks a member's whole pipeline enrollment complete by hand.

``POST /training/programs/enrollments/{id}/complete`` — training.manage, a
required reason, audited with the unmet count, and completed through the same
claim and side effects as the automatic rollup so the two cannot drift
(pitfall #29).

DB-backed throughout, so marked ``integration`` (pitfall #30b). The race test
uses real connections rather than ``db_session``: it needs two transactions.
"""

import asyncio
import uuid
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import PermissionChecker
from app.api.v1.endpoints import training_programs
from app.core.database import database_manager
from app.models.training import (
    EnrollmentStatus,
    ProgramEnrollment,
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
    MemberProgramProgress,
    ProgramEnrollmentComplete,
    ProgramEnrollmentResponse,
    RequirementProgressUpdate,
)
from app.services.training_program_service import TrainingProgramService

pytestmark = pytest.mark.integration


def _uid() -> str:
    return str(uuid.uuid4())


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


async def _half_done(db, org_id, member_id, status=EnrollmentStatus.ACTIVE):
    """A two-requirement program; the member has finished one of the two."""
    program = TrainingProgram(
        id=_uid(),
        organization_id=org_id,
        name="Driver Operator",
        structure_type=ProgramStructureType.FLEXIBLE,
        active=True,
    )
    done = _requirement(org_id, "Pump Ops")
    open_item = _requirement(org_id, "Aerial Ops")
    db.add_all([program, done, open_item])
    await db.flush()
    for order, requirement in enumerate((done, open_item)):
        db.add(
            ProgramRequirement(
                id=_uid(),
                program_id=program.id,
                requirement_id=requirement.id,
                is_required=True,
                sort_order=order,
            )
        )
    enrollment = ProgramEnrollment(
        id=_uid(),
        organization_id=org_id,
        user_id=member_id,
        program_id=program.id,
        status=status,
        progress_percentage=50.0,
    )
    db.add(enrollment)
    await db.flush()
    unmet_row = _progress(enrollment.id, open_item.id, 0.0)
    db.add_all([_progress(enrollment.id, done.id, 100.0), unmet_row])
    await db.flush()
    return program, enrollment, unmet_row


async def _reload(db, model, row_id):
    result = await db.execute(
        select(model)
        .where(model.id == str(row_id))
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


def _officer(org_id):
    # The endpoint reads only these; the permission gate is a dependency,
    # exercised on its own below.
    return SimpleNamespace(
        id=_uid(), organization_id=org_id, username="training-officer"
    )


@pytest.fixture
def side_effects(monkeypatch):
    """Spy the completion side effects on the class: the endpoint builds its
    own service instance."""
    notice = AsyncMock()
    evoc = AsyncMock()
    audit = AsyncMock()
    monkeypatch.setattr(TrainingProgramService, "_notify_program_completion", notice)
    monkeypatch.setattr(TrainingProgramService, "_handle_evoc_completion", evoc)
    monkeypatch.setattr(training_programs, "log_audit_event", audit)
    return SimpleNamespace(notice=notice, evoc=evoc, audit=audit)


async def _complete(db, enrollment_id, org_id, reason="Signed off by the chief"):
    return await training_programs.complete_enrollment(
        enrollment_id=uuid.UUID(str(enrollment_id)),
        payload=ProgramEnrollmentComplete(reason=reason),
        db=db,
        current_user=_officer(org_id),
    )


class TestManualCompletion:
    async def test_completes_an_active_enrollment_through_the_normal_path(
        self, db_session, setup_org_and_admin, side_effects
    ):
        org_id, member_id = setup_org_and_admin
        program, enrollment, unmet_row = await _half_done(db_session, org_id, member_id)

        returned = await _complete(db_session, enrollment.id, org_id)

        now = await _reload(db_session, ProgramEnrollment, enrollment.id)
        assert now.status == EnrollmentStatus.COMPLETED
        assert now.completed_at is not None
        assert returned.status == EnrollmentStatus.COMPLETED
        assert returned.program.name == "Driver Operator"
        # The same side effects as an automatic completion, once each.
        side_effects.notice.assert_awaited_once()
        side_effects.evoc.assert_awaited_once()
        assert side_effects.evoc.await_args.args[0].id == program.id
        # What the member had not met stays unmet on record.
        row = await _reload(db_session, RequirementProgress, unmet_row.id)
        assert row.progress_percentage == 0.0
        assert row.status == RequirementProgressStatus.IN_PROGRESS

    async def test_the_audit_event_carries_the_reason_and_the_unmet_count(
        self, db_session, setup_org_and_admin, side_effects
    ):
        org_id, member_id = setup_org_and_admin
        program, enrollment, _ = await _half_done(db_session, org_id, member_id)

        await _complete(db_session, enrollment.id, org_id, reason="  Chief's call  ")

        side_effects.audit.assert_awaited_once()
        kwargs = side_effects.audit.await_args.kwargs
        assert kwargs["event_type"] == "training_enrollment_completed_manually"
        assert kwargs["username"] == "training-officer"
        data = kwargs["event_data"]
        assert data["reason"] == "Chief's call"
        assert data["unmet_required_count"] == 1
        assert data["enrollment_id"] == enrollment.id
        assert data["target_user_id"] == member_id
        assert data["program_id"] == program.id
        assert data["program_name"] == "Driver Operator"

    async def test_an_on_hold_enrollment_may_be_completed(
        self, db_session, setup_org_and_admin, side_effects
    ):
        org_id, member_id = setup_org_and_admin
        _, enrollment, _ = await _half_done(
            db_session, org_id, member_id, status=EnrollmentStatus.ON_HOLD
        )

        await _complete(db_session, enrollment.id, org_id)

        now = await _reload(db_session, ProgramEnrollment, enrollment.id)
        assert now.status == EnrollmentStatus.COMPLETED
        side_effects.notice.assert_awaited_once()

    async def test_a_later_progress_edit_does_not_undo_it(
        self, db_session, setup_org_and_admin, side_effects
    ):
        org_id, member_id = setup_org_and_admin
        _, enrollment, unmet_row = await _half_done(db_session, org_id, member_id)
        await _complete(db_session, enrollment.id, org_id)

        # Still short of 100%: the rollup's "fell back below 100%" reopening
        # is for an automatic completion, not an officer's decision.
        svc = TrainingProgramService(db_session)
        _, error = await svc.update_requirement_progress(
            uuid.UUID(unmet_row.id),
            org_id,
            RequirementProgressUpdate(progress_value=1.0),
        )
        assert error is None, error

        now = await _reload(db_session, ProgramEnrollment, enrollment.id)
        assert now.status == EnrollmentStatus.COMPLETED
        assert now.completed_at is not None
        side_effects.notice.assert_awaited_once()

    async def test_automatic_completion_runs_the_same_side_effects(
        self, db_session, setup_org_and_admin, monkeypatch
    ):
        org_id, member_id = setup_org_and_admin
        _, enrollment, unmet_row = await _half_done(db_session, org_id, member_id)
        after = AsyncMock()
        monkeypatch.setattr(
            TrainingProgramService, "_after_enrollment_completed", after
        )
        unmet_row.progress_percentage = 100.0
        await db_session.flush()

        await TrainingProgramService(db_session)._recalculate_enrollment_progress(
            enrollment.id
        )

        now = await _reload(db_session, ProgramEnrollment, enrollment.id)
        assert now.status == EnrollmentStatus.COMPLETED
        after.assert_awaited_once()


class TestManualCompletionRefusals:
    def test_the_route_requires_training_manage(self):
        route = next(
            r
            for r in training_programs.router.routes
            if getattr(r, "path", "") == "/enrollments/{enrollment_id}/complete"
        )
        checkers = [
            dep.call
            for dep in route.dependant.dependencies
            if isinstance(dep.call, PermissionChecker)
        ]
        assert [c.required_permissions for c in checkers] == [["training.manage"]]

    async def test_a_member_without_the_permission_is_refused(
        self, db_session, setup_org_and_admin
    ):
        from sqlalchemy.orm import selectinload

        from app.models.user import User

        _, member_id = setup_org_and_admin
        member = (
            await db_session.execute(
                select(User)
                .options(selectinload(User.positions), selectinload(User.roles))
                .where(User.id == member_id)
            )
        ).scalar_one()

        with pytest.raises(HTTPException) as refused:
            await PermissionChecker(["training.manage"])(current_user=member)
        assert refused.value.status_code == 403

    async def test_another_departments_enrollment_is_not_found(
        self, db_session, setup_org_and_admin, side_effects
    ):
        org_id, member_id = setup_org_and_admin
        _, enrollment, _ = await _half_done(db_session, org_id, member_id)

        with pytest.raises(HTTPException) as refused:
            await _complete(db_session, enrollment.id, _uid())
        assert refused.value.status_code == 404

        now = await _reload(db_session, ProgramEnrollment, enrollment.id)
        assert now.status == EnrollmentStatus.ACTIVE
        side_effects.notice.assert_not_awaited()
        side_effects.audit.assert_not_awaited()

    @pytest.mark.parametrize("reason", ["", "   ", "x" * 501])
    def test_a_blank_or_overlong_reason_is_refused(self, reason):
        with pytest.raises(ValidationError):
            ProgramEnrollmentComplete(reason=reason)

    async def test_the_reason_is_required(self):
        with pytest.raises(ValidationError):
            ProgramEnrollmentComplete.model_validate({})

    @pytest.mark.parametrize(
        "status",
        [
            EnrollmentStatus.COMPLETED,
            EnrollmentStatus.WITHDRAWN,
            EnrollmentStatus.FAILED,
            EnrollmentStatus.EXPIRED,
        ],
    )
    async def test_a_finished_enrollment_is_refused_without_a_second_notice(
        self, db_session, setup_org_and_admin, side_effects, status
    ):
        org_id, member_id = setup_org_and_admin
        _, enrollment, _ = await _half_done(
            db_session, org_id, member_id, status=status
        )

        with pytest.raises(HTTPException) as refused:
            await _complete(db_session, enrollment.id, org_id)
        assert refused.value.status_code == 409
        if status == EnrollmentStatus.COMPLETED:
            assert refused.value.detail == "This enrollment is already complete"

        now = await _reload(db_session, ProgramEnrollment, enrollment.id)
        assert now.status == status
        side_effects.notice.assert_not_awaited()
        side_effects.evoc.assert_not_awaited()
        side_effects.audit.assert_not_awaited()


# ---------------------------------------------------------------------------
# Two officers at once: one completion, one set of side effects
# ---------------------------------------------------------------------------

_HOLD_SECONDS = 0.3


async def _seed_race() -> tuple[str, str]:
    org_id, user_id, program_id, enrollment_id = (_uid() for _ in range(4))
    async with database_manager.engine.connect() as conn:
        async with conn.begin():
            await conn.execute(
                text(
                    "INSERT INTO organizations "
                    "(id, name, organization_type, slug, timezone, active) "
                    "VALUES (:id, 'Manual Completion Race Dept', 'fire_department', "
                    ":slug, 'UTC', 1)"
                ),
                {"id": org_id, "slug": f"complete-race-{org_id[:8]}"},
            )
            await conn.execute(
                text(
                    "INSERT INTO users (id, organization_id, username, first_name, "
                    "last_name, email, password_hash, status) VALUES (:id, :org, "
                    ":un, 'Complete', 'Racer', :em, 'hashed', 'active')"
                ),
                {
                    "id": user_id,
                    "org": org_id,
                    "un": f"complete-race-{user_id[:8]}",
                    "em": f"complete-race-{user_id[:8]}@test.com",
                },
            )
            await conn.execute(
                text(
                    "INSERT INTO training_programs (id, organization_id, name) "
                    "VALUES (:id, :org, 'Probationary')"
                ),
                {"id": program_id, "org": org_id},
            )
            await conn.execute(
                text(
                    "INSERT INTO program_enrollments (id, organization_id, user_id, "
                    "program_id, enrolled_at, progress_percentage, status) VALUES "
                    "(:id, :org, :user, :program, NOW(), 0, 'active')"
                ),
                {
                    "id": enrollment_id,
                    "org": org_id,
                    "user": user_id,
                    "program": program_id,
                },
            )
    return org_id, enrollment_id


async def _cleanup_race(org_id: str) -> None:
    async with database_manager.engine.connect() as conn:
        async with conn.begin():
            for statement in (
                "DELETE FROM program_enrollments WHERE organization_id = :o",
                "DELETE FROM training_programs WHERE organization_id = :o",
                "DELETE FROM users WHERE organization_id = :o",
                "DELETE FROM organizations WHERE id = :o",
            ):
                await conn.execute(text(statement), {"o": org_id})


@pytest.mark.usefixtures("_initialize_database")
async def test_two_concurrent_completions_complete_once(monkeypatch):
    org_id, enrollment_id = await _seed_race()
    locked = asyncio.Event()
    counted = []
    after = AsyncMock()
    monkeypatch.setattr(TrainingProgramService, "_after_enrollment_completed", after)
    real_count = TrainingProgramService._unmet_required_count

    # The unmet count runs between the status check and the claim, so holding
    # the first caller there holds it inside the window the race lives in.
    async def hold_the_first(self, *args, **kwargs):
        counted.append(1)
        if len(counted) == 1:
            locked.set()
            await asyncio.sleep(_HOLD_SECONDS)
        return await real_count(self, *args, **kwargs)

    monkeypatch.setattr(TrainingProgramService, "_unmet_required_count", hold_the_first)

    async def complete(reason, after_event=None):
        if after_event is not None:
            await after_event.wait()
        async with database_manager.engine.connect() as conn:
            session = AsyncSession(bind=conn, expire_on_commit=False)
            try:
                _, error, _ = await TrainingProgramService(
                    session
                ).complete_enrollment_manually(
                    uuid.UUID(enrollment_id), org_id, reason=reason
                )
                await session.commit()
                return error or "completed"
            finally:
                await session.close()

    try:
        results = await asyncio.gather(
            complete("First officer's reason"),
            complete("Second officer's reason", after_event=locked),
        )
        async with database_manager.engine.connect() as conn:
            stored, stored_reason = (
                await conn.execute(
                    text(
                        "SELECT status, completion_reason FROM program_enrollments "
                        "WHERE id = :e"
                    ),
                    {"e": enrollment_id},
                )
            ).one()
    finally:
        await _cleanup_race(org_id)

    assert results == [
        "completed",
        "This enrollment is already complete",
    ], f"two concurrent completions returned {results}"
    assert stored == "completed"
    # The losing call's reason never reaches the winner's completion.
    assert stored_reason == "First officer's reason"
    after.assert_awaited_once()
    # The second caller waited on the row lock and then saw the completion,
    # rather than reaching the count (and the claim) on a stale read.
    assert len(counted) == 1


# ---------------------------------------------------------------------------
# The stored reason: written by the claim, cleared whenever the enrollment
# stops being COMPLETED, and kept from the member's own view
# ---------------------------------------------------------------------------


async def _with_reason(db, org_id, member_id, status, reason="Stale reason"):
    """An enrollment in ``status`` already carrying a completion reason."""
    program, enrollment, unmet_row = await _half_done(
        db, org_id, member_id, status=status
    )
    enrollment.completion_reason = reason
    await db.flush()
    return program, enrollment, unmet_row


class TestCompletionReasonIsStored:
    async def test_manual_completion_stores_the_trimmed_reason(
        self, db_session, setup_org_and_admin, side_effects
    ):
        org_id, member_id = setup_org_and_admin
        _, enrollment, _ = await _half_done(db_session, org_id, member_id)

        returned = await _complete(
            db_session, enrollment.id, org_id, reason="  Chief's call  "
        )

        now = await _reload(db_session, ProgramEnrollment, enrollment.id)
        assert now.completion_reason == "Chief's call"
        # And the audit event still carries it.
        data = side_effects.audit.await_args.kwargs["event_data"]
        assert data["reason"] == "Chief's call"
        # The endpoint's response includes it.
        response = ProgramEnrollmentResponse.model_validate(returned)
        assert response.completion_reason == "Chief's call"

    async def test_automatic_completion_stores_null(
        self, db_session, setup_org_and_admin, monkeypatch
    ):
        org_id, member_id = setup_org_and_admin
        # A reason on an active row should never exist; seeded here so the
        # test proves the automatic claim writes NULL rather than leaving
        # whatever the row held.
        _, enrollment, unmet_row = await _with_reason(
            db_session, org_id, member_id, EnrollmentStatus.ACTIVE
        )
        monkeypatch.setattr(
            TrainingProgramService, "_after_enrollment_completed", AsyncMock()
        )
        unmet_row.progress_percentage = 100.0
        await db_session.flush()

        await TrainingProgramService(db_session)._recalculate_enrollment_progress(
            enrollment.id
        )

        now = await _reload(db_session, ProgramEnrollment, enrollment.id)
        assert now.status == EnrollmentStatus.COMPLETED
        assert now.completion_reason is None

    async def test_a_lost_claim_does_not_write_its_reason(
        self, db_session, setup_org_and_admin
    ):
        org_id, member_id = setup_org_and_admin
        _, enrollment, _ = await _with_reason(
            db_session,
            org_id,
            member_id,
            EnrollmentStatus.COMPLETED,
            reason="The winner's reason",
        )

        claimed = await TrainingProgramService(db_session)._claim_completion(
            enrollment.id,
            (EnrollmentStatus.ACTIVE, EnrollmentStatus.ON_HOLD),
            completion_reason="The loser's reason",
        )

        assert claimed is False
        now = await _reload(db_session, ProgramEnrollment, enrollment.id)
        assert now.completion_reason == "The winner's reason"


class TestCompletionReasonIsCleared:
    async def test_reopening_when_progress_falls_clears_it(
        self, db_session, setup_org_and_admin, side_effects
    ):
        org_id, member_id = setup_org_and_admin
        # Every item met, but paused: the rollup would not complete it, so an
        # officer does, at 100%.
        _, enrollment, unmet_row = await _half_done(
            db_session, org_id, member_id, status=EnrollmentStatus.ON_HOLD
        )
        unmet_row.progress_percentage = 100.0
        unmet_row.progress_value = 4.0
        unmet_row.status = RequirementProgressStatus.COMPLETED
        enrollment.progress_percentage = 100.0
        await db_session.flush()
        await _complete(db_session, enrollment.id, org_id)
        assert (
            await _reload(db_session, ProgramEnrollment, enrollment.id)
        ).completion_reason == "Signed off by the chief"

        _, error = await TrainingProgramService(db_session).update_requirement_progress(
            uuid.UUID(unmet_row.id),
            org_id,
            RequirementProgressUpdate(progress_value=1.0),
        )
        assert error is None, error

        now = await _reload(db_session, ProgramEnrollment, enrollment.id)
        assert now.status == EnrollmentStatus.ACTIVE
        assert now.completion_reason is None

    async def test_starting_a_new_cycle_clears_it(
        self, db_session, setup_org_and_admin, side_effects
    ):
        org_id, member_id = setup_org_and_admin
        _, enrollment, _ = await _half_done(db_session, org_id, member_id)
        await _complete(db_session, enrollment.id, org_id)

        returned = await training_programs.reset_enrollment_progress(
            enrollment_id=uuid.UUID(enrollment.id),
            db=db_session,
            current_user=_officer(org_id),
        )

        now = await _reload(db_session, ProgramEnrollment, enrollment.id)
        assert now.status == EnrollmentStatus.ACTIVE
        assert now.completion_reason is None
        assert returned.completion_reason is None

    async def test_a_recert_reset_clears_it(
        self, db_session, setup_org_and_admin, side_effects, monkeypatch
    ):
        org_id, member_id = setup_org_and_admin
        program, enrollment, _ = await _half_done(db_session, org_id, member_id)
        await _complete(db_session, enrollment.id, org_id)
        program.recert_enabled = True
        enrollment = await _reload(db_session, ProgramEnrollment, enrollment.id)
        enrollment.next_recert_reset_at = date(2020, 1, 1)
        await db_session.flush()
        monkeypatch.setattr(
            TrainingProgramService, "_safe_notify_recert_reset", AsyncMock()
        )

        reset = await TrainingProgramService(db_session).auto_reset_if_due(
            enrollment, today=date(2026, 10, 23)
        )

        assert reset is True
        now = await _reload(db_session, ProgramEnrollment, enrollment.id)
        assert now.status == EnrollmentStatus.ACTIVE
        assert now.completion_reason is None

    async def test_the_reopen_endpoint_clears_it(
        self, db_session, setup_org_and_admin, side_effects
    ):
        org_id, member_id = setup_org_and_admin
        # Only an expired enrollment can be reopened, and none should carry a
        # reason; a stale one must still not survive onto the active row.
        _, enrollment, _ = await _with_reason(
            db_session, org_id, member_id, EnrollmentStatus.EXPIRED
        )

        returned = await training_programs.reopen_enrollment(
            enrollment_id=uuid.UUID(enrollment.id),
            payload=None,
            db=db_session,
            current_user=_officer(org_id),
        )

        now = await _reload(db_session, ProgramEnrollment, enrollment.id)
        assert now.status == EnrollmentStatus.ACTIVE
        assert now.completion_reason is None
        assert returned.completion_reason is None

    async def test_an_officer_withdrawing_a_completed_enrollment_clears_it(
        self, db_session, setup_org_and_admin, side_effects
    ):
        org_id, member_id = setup_org_and_admin
        _, enrollment, _ = await _half_done(db_session, org_id, member_id)
        await _complete(db_session, enrollment.id, org_id)

        withdrawn, error = await TrainingProgramService(db_session).withdraw_enrollment(
            uuid.UUID(enrollment.id),
            org_id,
            acting_user_id=_uid(),
            can_manage=True,
            reason="Left the department",
        )

        assert error is None, error
        now = await _reload(db_session, ProgramEnrollment, enrollment.id)
        assert now.status == EnrollmentStatus.WITHDRAWN
        assert now.completion_reason is None


class TestCompletionReasonVisibility:
    """The reason is an officer's note: a member reading their own enrollment
    does not get it; an officer reading it does."""

    async def _completed(self, db, org_id, member_id):
        _, enrollment, _ = await _half_done(db, org_id, member_id)
        await _complete(db, enrollment.id, org_id)
        return enrollment

    @pytest.mark.parametrize("officer", [True, False])
    async def test_my_enrollments(
        self, db_session, setup_org_and_admin, side_effects, monkeypatch, officer
    ):
        org_id, member_id = setup_org_and_admin
        await self._completed(db_session, org_id, member_id)
        monkeypatch.setattr(
            training_programs,
            "can_view_officer_training_data",
            lambda user: officer,
        )

        rows = await training_programs.get_my_enrollments(
            status=None,
            db=db_session,
            current_user=SimpleNamespace(id=member_id, organization_id=org_id),
        )

        reasons = [
            ProgramEnrollmentResponse.model_validate(r).completion_reason for r in rows
        ]
        expected = "Signed off by the chief" if officer else None
        assert reasons == [expected]

    @pytest.mark.parametrize("officer", [True, False])
    async def test_enrollment_progress(
        self, db_session, setup_org_and_admin, side_effects, monkeypatch, officer
    ):
        org_id, member_id = setup_org_and_admin
        enrollment = await self._completed(db_session, org_id, member_id)
        monkeypatch.setattr(
            training_programs,
            "can_view_officer_training_data",
            lambda user: officer,
        )

        progress = await training_programs.get_enrollment_progress(
            enrollment_id=uuid.UUID(enrollment.id),
            db=db_session,
            # The member themself, so the view_all check is not reached.
            current_user=SimpleNamespace(id=member_id, organization_id=org_id),
        )

        body = MemberProgramProgress.model_validate(progress)
        expected = "Signed off by the chief" if officer else None
        assert body.enrollment.completion_reason == expected
        assert body.enrollment.status == "completed"

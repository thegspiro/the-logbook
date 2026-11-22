"""A progress update answers with the saved row even when milestones fail.

``_recalculate_enrollment_progress`` runs milestone processing as a best-effort
step and, if it raises, calls ``db.rollback()`` to recover the session. A
rollback expires every object the session holds. ``update_requirement_progress``
then returned its ``progress`` row without reading it again, so serializing
the response lazy-loaded it on the async session (MissingGreenlet) and
``PATCH /training/programs/progress/{id}`` answered 500. The progress itself
had already been committed. The enrollment the recalculation went on to use
was expired the same way.

The ``db_session`` fixture joins an outer transaction with
``join_transaction_mode="create_savepoint"``, so the service's ``rollback()``
there only rolls back a SAVEPOINT, which SQLAlchemy answers by expiring the
objects changed inside it (``_restore_snapshot(dirty_only=transaction.nested)``)
rather than all of them. The fixture alone therefore cannot show this bug.
``_production_rollback`` restores what a top-level rollback does in production:
roll back, then expire every object in the session.
"""

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints import training_programs as program_endpoints
from app.models.training import (
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
from app.models.user import Organization, User, UserStatus
from app.schemas.training_program import (
    RequirementProgressResponse,
    RequirementProgressUpdate,
)
from app.services import training_program_service
from tests.waiver_request_support import assign, make_position

pytestmark = pytest.mark.integration


def _uid():
    return str(uuid.uuid4())


async def _officer_and_progress(db):
    org = Organization(
        id=_uid(),
        name="Milestone Failure Department",
        slug=f"ms-fail-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db.add(org)
    await db.flush()
    handle = uuid.uuid4().hex[:10]
    member = User(
        id=_uid(),
        organization_id=org.id,
        username=f"recruit-{handle}",
        email=f"{handle}@ms-fail.test",
        first_name="Riley",
        last_name="Recruit",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    officer = User(
        id=_uid(),
        organization_id=org.id,
        username=f"officer-{handle}",
        email=f"officer-{handle}@ms-fail.test",
        first_name="Casey",
        last_name="Officer",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db.add_all([member, officer])
    await db.flush()
    position = await make_position(
        db, org.id, "Training Officer", permissions=["training.manage"]
    )
    await assign(db, officer.id, position)
    program = TrainingProgram(
        id=_uid(),
        organization_id=org.id,
        name="New Probationary Member",
        structure_type=ProgramStructureType.FLEXIBLE,
        active=True,
    )
    requirement = TrainingRequirement(
        id=_uid(),
        organization_id=org.id,
        name="Orientation Class",
        requirement_type=RequirementType.HOURS,
        required_hours=4.0,
        frequency=RequirementFrequency.ONE_TIME,
        applies_to_all=False,
        active=True,
    )
    db.add_all([program, requirement])
    await db.flush()
    db.add(
        ProgramRequirement(
            id=_uid(),
            program_id=program.id,
            requirement_id=requirement.id,
            is_required=True,
            sort_order=0,
        )
    )
    enrollment = ProgramEnrollment(
        id=_uid(),
        organization_id=org.id,
        user_id=member.id,
        program_id=program.id,
    )
    db.add(enrollment)
    await db.flush()
    progress = RequirementProgress(
        id=_uid(),
        enrollment_id=enrollment.id,
        requirement_id=requirement.id,
        status=RequirementProgressStatus.IN_PROGRESS,
        progress_value=1.0,
        progress_percentage=25.0,
    )
    db.add(progress)
    await db.flush()
    db.expunge_all()
    officer = (
        await db.execute(
            select(User)
            .options(selectinload(User.positions), selectinload(User.roles))
            .where(User.id == officer.id)
        )
    ).scalar_one()
    return officer, progress.id


def _production_rollback(db):
    savepoint_rollback = db.rollback

    async def rollback():
        await savepoint_rollback()
        db.expire_all()

    return patch.object(db, "rollback", rollback)


class TestProgressUpdateWhenMilestonesFail:
    async def test_the_saved_progress_is_returned(self, db_session):
        officer, progress_id = await _officer_and_progress(db_session)

        with (
            patch(
                "app.services.program_milestones.process_enrollments",
                AsyncMock(side_effect=RuntimeError("milestone store unavailable")),
            ) as milestones,
            _production_rollback(db_session),
        ):
            response = await program_endpoints.update_requirement_progress(
                progress_id=uuid.UUID(progress_id),
                updates=RequirementProgressUpdate(progress_value=2.0),
                db=db_session,
                current_user=officer,
            )

        assert milestones.await_count == 1
        body = RequirementProgressResponse.model_validate(response)
        assert str(body.id) == progress_id
        assert body.progress_value == 2.0
        assert body.requirement is not None
        assert body.requirement.name == "Orientation Class"

    async def test_the_requirement_completion_step_still_runs(self, db_session):
        officer, progress_id = await _officer_and_progress(db_session)
        notify = training_program_service.notify_completed_requirements
        outcomes = []

        async def recording_notify(db, enrollment, *, send):
            try:
                sent = await notify(db, enrollment, send=send)
            except Exception as exc:
                outcomes.append(type(exc).__name__)
                raise
            outcomes.append("ran")
            return sent

        with (
            patch(
                "app.services.program_milestones.process_enrollments",
                AsyncMock(side_effect=RuntimeError("milestone store unavailable")),
            ),
            _production_rollback(db_session),
            patch.object(
                training_program_service,
                "notify_completed_requirements",
                recording_notify,
            ),
        ):
            await program_endpoints.update_requirement_progress(
                progress_id=uuid.UUID(progress_id),
                updates=RequirementProgressUpdate(progress_value=2.0),
                db=db_session,
                current_user=officer,
            )

        # The step is best-effort, so a failure here is only logged; it used to
        # fail on the enrollment the milestone rollback had expired.
        assert outcomes == ["ran"]

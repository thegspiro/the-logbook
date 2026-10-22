"""Deleting a pipeline phase must not wipe progress another phase still tracks.

``delete_program_phase`` used to delete every RequirementProgress row for the
phase's requirements across the program's enrollments, even when a second
phase of the same program still linked that requirement — so a member's
signed-off work reset to zero on a phase nobody had touched. It must mirror
``remove_requirement_from_program``: keep progress a sibling link still
tracks, and remove an owned requirement only once nothing links it.
"""

import uuid

import pytest
from sqlalchemy import select

from app.models.training import (
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
from app.models.user import Organization, User, UserStatus
from app.services.training_program_service import TrainingProgramService

pytestmark = pytest.mark.integration


def _uid():
    return str(uuid.uuid4())


def _requirement(org_id, name):
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


async def _program_with_two_phases(db):
    org = Organization(
        id=_uid(),
        name="Phase Delete Department",
        slug=f"phase-del-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db.add(org)
    await db.flush()
    handle = uuid.uuid4().hex[:10]
    member = User(
        id=_uid(),
        organization_id=org.id,
        username=f"recruit-{handle}",
        email=f"{handle}@phase-delete.test",
        first_name="Riley",
        last_name="Recruit",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db.add(member)
    program = TrainingProgram(
        id=_uid(),
        organization_id=org.id,
        name="Recruit Academy",
        structure_type=ProgramStructureType.PHASES,
        active=True,
    )
    db.add(program)
    shared = _requirement(org.id, "CPR Certification")
    owned_only_here = _requirement(org.id, "Hose Handling Drill")
    db.add_all([shared, owned_only_here])
    await db.flush()
    first = ProgramPhase(
        id=_uid(), program_id=program.id, phase_number=1, name="Orientation"
    )
    second = ProgramPhase(
        id=_uid(), program_id=program.id, phase_number=2, name="Fireground"
    )
    db.add_all([first, second])
    await db.flush()
    db.add_all(
        [
            ProgramRequirement(
                id=_uid(),
                program_id=program.id,
                phase_id=first.id,
                requirement_id=shared.id,
                is_required=True,
                sort_order=0,
                owns_requirement=True,
            ),
            ProgramRequirement(
                id=_uid(),
                program_id=program.id,
                phase_id=second.id,
                requirement_id=shared.id,
                is_required=True,
                sort_order=0,
                owns_requirement=False,
            ),
            ProgramRequirement(
                id=_uid(),
                program_id=program.id,
                phase_id=first.id,
                requirement_id=owned_only_here.id,
                is_required=True,
                sort_order=1,
                owns_requirement=True,
            ),
        ]
    )
    enrollment = ProgramEnrollment(
        id=_uid(),
        organization_id=org.id,
        user_id=member.id,
        program_id=program.id,
        current_phase_id=second.id,
    )
    db.add(enrollment)
    await db.flush()
    db.add_all(
        [
            RequirementProgress(
                id=_uid(),
                enrollment_id=enrollment.id,
                requirement_id=shared.id,
                status=RequirementProgressStatus.COMPLETED,
                progress_value=4.0,
                progress_percentage=100.0,
            ),
            RequirementProgress(
                id=_uid(),
                enrollment_id=enrollment.id,
                requirement_id=owned_only_here.id,
                status=RequirementProgressStatus.IN_PROGRESS,
                progress_value=2.0,
                progress_percentage=50.0,
            ),
        ]
    )
    await db.flush()
    return org, program, first, shared, owned_only_here, enrollment


async def _progress_requirement_ids(db, enrollment_id):
    result = await db.execute(
        select(RequirementProgress.requirement_id).where(
            RequirementProgress.enrollment_id == enrollment_id
        )
    )
    return {str(r[0]) for r in result.all()}


class TestDeletePhaseKeepsSiblingProgress:
    async def test_progress_survives_on_a_requirement_another_phase_links(
        self, db_session
    ):
        org, program, first, shared, _owned, enrollment = (
            await _program_with_two_phases(db_session)
        )

        ok, error = await TrainingProgramService(db_session).delete_program_phase(
            uuid.UUID(first.id), uuid.UUID(program.id), org.id
        )

        assert ok is True
        assert error is None
        progress_ids = await _progress_requirement_ids(db_session, enrollment.id)
        assert shared.id in progress_ids
        # The owning link went with the phase, but the second phase still
        # links the requirement, so the library row must stay too.
        assert await db_session.get(TrainingRequirement, shared.id) is not None

    async def test_owned_requirement_only_on_the_deleted_phase_is_removed(
        self, db_session
    ):
        org, program, first, _shared, owned, enrollment = (
            await _program_with_two_phases(db_session)
        )

        ok, _error = await TrainingProgramService(db_session).delete_program_phase(
            uuid.UUID(first.id), uuid.UUID(program.id), org.id
        )

        assert ok is True
        progress_ids = await _progress_requirement_ids(db_session, enrollment.id)
        assert owned.id not in progress_ids
        remaining = await db_session.execute(
            select(TrainingRequirement.id).where(TrainingRequirement.id == owned.id)
        )
        assert remaining.scalar_one_or_none() is None

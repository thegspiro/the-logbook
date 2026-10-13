"""PATCH /programs/{program_id}/requirements/{id} must only touch that program's link.

The endpoint used to load the link by org alone, commit the edit (and any
progress recompute), and only then compare the link's program with the one in
the path, so a wrong program id answered 400 while the change stayed saved.
"""

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints import training_programs as program_endpoints
from app.models.training import (
    ProgramRequirement,
    ProgramStructureType,
    RequirementFrequency,
    RequirementType,
    TrainingProgram,
    TrainingRequirement,
)
from app.models.user import Organization, User, UserStatus
from app.schemas.training_program import ProgramRequirementUpdate

pytestmark = pytest.mark.integration


def _uid():
    return str(uuid.uuid4())


async def _department(db):
    org = Organization(
        id=_uid(),
        name="Scope Department",
        slug=f"scope-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db.add(org)
    await db.flush()
    handle = uuid.uuid4().hex[:10]
    officer = User(
        id=_uid(),
        organization_id=org.id,
        username=f"officer-{handle}",
        email=f"{handle}@scope.test",
        first_name="Casey",
        last_name="Officer",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db.add(officer)
    requirement = TrainingRequirement(
        id=_uid(),
        organization_id=org.id,
        name="CPR Certification",
        requirement_type=RequirementType.HOURS,
        required_hours=4.0,
        frequency=RequirementFrequency.ONE_TIME,
        applies_to_all=False,
        active=True,
    )
    db.add(requirement)
    programs = []
    for name in ("Recruit Academy", "Driver Operator"):
        program = TrainingProgram(
            id=_uid(),
            organization_id=org.id,
            name=name,
            structure_type=ProgramStructureType.FLEXIBLE,
            active=True,
        )
        db.add(program)
        programs.append(program)
    await db.flush()
    link = ProgramRequirement(
        id=_uid(),
        program_id=programs[0].id,
        requirement_id=requirement.id,
        is_required=True,
        sort_order=0,
        custom_deadline_days=30,
    )
    db.add(link)
    await db.flush()
    # The endpoint reads the officer's attributes after its own commits.
    await db.execute(
        select(User)
        .options(selectinload(User.positions), selectinload(User.roles))
        .where(User.id == officer.id)
        .execution_options(populate_existing=True)
    )
    return officer, programs, link


async def _patch(db, officer, program, link, **changes):
    return await program_endpoints.update_program_requirement(
        program_id=uuid.UUID(program.id),
        program_requirement_id=uuid.UUID(link.id),
        updates=ProgramRequirementUpdate(**changes),
        db=db,
        current_user=officer,
    )


class TestPatchIsScopedToThePathsProgram:
    async def test_a_link_from_another_program_is_not_found_and_not_changed(
        self, db_session
    ):
        officer, (academy, driver), link = await _department(db_session)

        with pytest.raises(HTTPException) as caught:
            await _patch(
                db_session,
                officer,
                driver,
                link,
                is_required=False,
                sort_order=9,
                custom_deadline_days=5,
            )

        assert caught.value.status_code == 404
        stored = await db_session.get(ProgramRequirement, link.id)
        await db_session.refresh(stored)
        assert stored.program_id == academy.id
        assert stored.is_required is True
        assert stored.sort_order == 0
        assert stored.custom_deadline_days == 30

    async def test_the_owning_program_still_edits_its_link(self, db_session):
        officer, (academy, _driver), link = await _department(db_session)

        updated = await _patch(
            db_session, officer, academy, link, sort_order=3, custom_deadline_days=45
        )

        assert updated.sort_order == 3
        stored = await db_session.get(ProgramRequirement, link.id)
        await db_session.refresh(stored)
        assert stored.sort_order == 3
        assert stored.custom_deadline_days == 45

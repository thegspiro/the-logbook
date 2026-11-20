"""POST /programs/{program_id}/requirements/reorder must return serializable links.

The response model nests each link's ``requirement``. The service loaded the
links without that relationship, so building the response triggered a lazy
load on an async session (MissingGreenlet) and the reorder answered 500 —
after the new order had already been committed.
"""

import uuid

import pytest
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
from app.schemas.training_program import (
    ProgramRequirementResponse,
    RequirementReorderRequest,
)

pytestmark = pytest.mark.integration


def _uid():
    return str(uuid.uuid4())


async def _program_with_two_links(db):
    org = Organization(
        id=_uid(),
        name="Reorder Department",
        slug=f"reorder-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db.add(org)
    await db.flush()
    handle = uuid.uuid4().hex[:10]
    officer = User(
        id=_uid(),
        organization_id=org.id,
        username=f"officer-{handle}",
        email=f"{handle}@reorder.test",
        first_name="Casey",
        last_name="Officer",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db.add(officer)
    program = TrainingProgram(
        id=_uid(),
        organization_id=org.id,
        name="New Probationary Member",
        structure_type=ProgramStructureType.FLEXIBLE,
        active=True,
    )
    db.add(program)
    links = []
    for index, name in enumerate(("Orientation Exam", "Orientation Class")):
        requirement = TrainingRequirement(
            id=_uid(),
            organization_id=org.id,
            name=name,
            requirement_type=RequirementType.HOURS,
            required_hours=1.0,
            frequency=RequirementFrequency.ONE_TIME,
            applies_to_all=False,
            active=True,
        )
        db.add(requirement)
        await db.flush()
        link = ProgramRequirement(
            id=_uid(),
            program_id=program.id,
            requirement_id=requirement.id,
            is_required=True,
            sort_order=index,
        )
        db.add(link)
        links.append(link)
    await db.flush()
    # The endpoint reads the officer's attributes after its own commit.
    await db.execute(
        select(User)
        .options(selectinload(User.positions), selectinload(User.roles))
        .where(User.id == officer.id)
        .execution_options(populate_existing=True)
    )
    # Start from a clean identity map, as a fresh request would: nothing about
    # the links' relationships is already loaded.
    db.expunge_all()
    officer = await db.get(User, officer.id)
    return officer, program.id, [link.id for link in links]


class TestReorderResponse:
    async def test_moving_a_requirement_up_returns_the_links_with_names(
        self, db_session
    ):
        officer, program_id, (exam_id, class_id) = await _program_with_two_links(
            db_session
        )

        links = await program_endpoints.reorder_program_requirements(
            program_id=uuid.UUID(program_id),
            payload=RequirementReorderRequest(
                program_requirement_ids=[uuid.UUID(class_id), uuid.UUID(exam_id)]
            ),
            db=db_session,
            current_user=officer,
        )

        body = [
            ProgramRequirementResponse.model_validate(link).model_dump()
            for link in links
        ]
        assert [str(item["id"]) for item in body] == [class_id, exam_id]
        assert [item["sort_order"] for item in body] == [0, 1]
        assert [item["requirement"]["name"] for item in body] == [
            "Orientation Class",
            "Orientation Exam",
        ]

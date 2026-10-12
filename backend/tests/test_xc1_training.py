"""
XC-1 sweep for the training module: client-supplied foreign keys must name a
row in the caller's organization before they are stored.

Each fixed path is exercised three ways where it applies: a foreign-org id is
refused and nothing is written, an in-org id still succeeds, and an optional
FK left empty still succeeds. DB-backed, so marked ``integration``.
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import func, select, text

from app.api.v1.endpoints.training import (
    create_category,
    create_course,
    create_records_bulk,
    create_requirement,
    update_category,
    update_course,
    update_requirement,
)
from app.api.v1.endpoints.training_module_config import _assert_apparatus_ids_in_org
from app.models.event import Event
from app.models.location import Location
from app.models.training import (
    BasicApparatus,
    CompetencyMatrix,
    SkillEvaluation,
    TrainingCategory,
    TrainingCourse,
    TrainingRecord,
    TrainingRequirement,
)
from app.models.user import Position
from app.schemas.training import (
    BulkTrainingRecordCreate,
    TrainingCategoryCreate,
    TrainingCategoryUpdate,
    TrainingCourseCreate,
    TrainingCourseUpdate,
    TrainingRequirementCreate,
    TrainingRequirementUpdate,
)
from app.schemas.training_program import (
    TrainingProgramCreate,
    TrainingProgramUpdate,
    TrainingRequirementEnhancedCreate,
)
from app.schemas.training_session import TrainingSessionCreate
from app.services.training_enhancement_service import CompetencyService
from app.services.training_program_service import TrainingProgramService
from app.services.training_session_service import TrainingSessionService

pytestmark = pytest.mark.integration


async def _org(db) -> tuple[str, SimpleNamespace]:
    """An organization plus one member, returned as an acting user."""
    org_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'XC1 Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"xc1-{org_id[:8]}"},
    )
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Pat', 'Officer', :em, 'x', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"xc1-{user_id[:8]}",
            "em": f"xc1-{user_id[:8]}@test.com",
        },
    )
    await db.flush()
    user = SimpleNamespace(
        id=user_id, organization_id=org_id, username=f"xc1-{user_id[:8]}"
    )
    return org_id, user


async def _category(db, org_id: str, name: str = "Fire") -> str:
    category = TrainingCategory(organization_id=org_id, name=name)
    db.add(category)
    await db.flush()
    return str(category.id)


async def _course(db, org_id: str, name: str = "Ladders") -> str:
    course = TrainingCourse(
        organization_id=org_id, name=name, training_type="continuing_education"
    )
    db.add(course)
    await db.flush()
    return str(course.id)


async def _count(db, model, org_id: str) -> int:
    return (
        await db.execute(
            select(func.count())
            .select_from(model)
            .where(model.organization_id == org_id)
        )
    ).scalar_one()


@pytest.fixture
async def two_orgs(db_session):
    org_a, user_a = await _org(db_session)
    org_b, _ = await _org(db_session)
    return org_a, user_a, org_b


def _course_payload(**kw) -> TrainingCourseCreate:
    return TrainingCourseCreate(
        name="Pump Ops", training_type="continuing_education", **kw
    )


class TestCourseReferences:
    async def test_foreign_category_is_refused(self, db_session, two_orgs):
        org_a, user, org_b = two_orgs
        foreign = await _category(db_session, org_b)

        with pytest.raises(HTTPException) as exc:
            await create_course(
                _course_payload(category_ids=[foreign]), db_session, user
            )

        assert exc.value.status_code == 400
        assert await _count(db_session, TrainingCourse, org_a) == 0

    async def test_foreign_prerequisite_is_refused(self, db_session, two_orgs):
        org_a, user, org_b = two_orgs
        foreign = await _course(db_session, org_b)

        with pytest.raises(HTTPException) as exc:
            await create_course(
                _course_payload(prerequisites=[foreign]), db_session, user
            )

        assert exc.value.status_code == 400
        assert await _count(db_session, TrainingCourse, org_a) == 0

    async def test_in_org_references_and_none_are_accepted(self, db_session, two_orgs):
        org_a, user, _ = two_orgs
        category = await _category(db_session, org_a)
        prereq = await _course(db_session, org_a)

        linked = await create_course(
            _course_payload(category_ids=[category], prerequisites=[prereq]),
            db_session,
            user,
        )
        bare = await create_course(_course_payload(), db_session, user)

        assert linked.category_ids == [category]
        assert linked.prerequisites == [prereq]
        assert bare.category_ids is None

    async def test_update_refuses_foreign_and_leaves_row_alone(
        self, db_session, two_orgs
    ):
        org_a, user, org_b = two_orgs
        course_id = await _course(db_session, org_a)
        foreign = await _category(db_session, org_b)

        with pytest.raises(HTTPException) as exc:
            await update_course(
                uuid.UUID(course_id),
                TrainingCourseUpdate(category_ids=[foreign]),
                db_session,
                user,
            )
        assert exc.value.status_code == 400

        own = await _category(db_session, org_a)
        updated = await update_course(
            uuid.UUID(course_id),
            TrainingCourseUpdate(category_ids=[own]),
            db_session,
            user,
        )
        assert updated.category_ids == [own]


class TestCategoryParent:
    async def test_foreign_parent_is_refused_on_create(self, db_session, two_orgs):
        org_a, user, org_b = two_orgs
        foreign = await _category(db_session, org_b)

        with pytest.raises(HTTPException) as exc:
            await create_category(
                TrainingCategoryCreate(
                    name="Ventilation", parent_category_id=uuid.UUID(foreign)
                ),
                db_session,
                user,
            )

        assert exc.value.status_code == 400
        assert await _count(db_session, TrainingCategory, org_a) == 0

    async def test_in_org_parent_and_none_are_accepted(self, db_session, two_orgs):
        org_a, user, _ = two_orgs
        parent = await _category(db_session, org_a)

        child = await create_category(
            TrainingCategoryCreate(
                name="Ventilation", parent_category_id=uuid.UUID(parent)
            ),
            db_session,
            user,
        )
        root = await create_category(
            TrainingCategoryCreate(name="EMS"), db_session, user
        )

        assert str(child.parent_category_id) == parent
        assert root.parent_category_id is None

    async def test_update_refuses_foreign_parent_but_allows_clearing(
        self, db_session, two_orgs
    ):
        org_a, user, org_b = two_orgs
        parent = await _category(db_session, org_a, "Fire")
        child_id = await _category(db_session, org_a, "Ventilation")
        foreign = await _category(db_session, org_b)

        with pytest.raises(HTTPException) as exc:
            await update_category(
                uuid.UUID(child_id),
                TrainingCategoryUpdate(parent_category_id=uuid.UUID(foreign)),
                db_session,
                user,
            )
        assert exc.value.status_code == 400

        moved = await update_category(
            uuid.UUID(child_id),
            TrainingCategoryUpdate(parent_category_id=uuid.UUID(parent)),
            db_session,
            user,
        )
        assert str(moved.parent_category_id) == parent

        cleared = await update_category(
            uuid.UUID(child_id),
            TrainingCategoryUpdate(parent_category_id=None),
            db_session,
            user,
        )
        assert cleared.parent_category_id is None


def _requirement_payload(**kw) -> TrainingRequirementCreate:
    return TrainingRequirementCreate(
        name="Annual Hours",
        requirement_type="hours",
        required_hours=12,
        frequency="annual",
        **kw,
    )


class TestRequirementCategories:
    async def test_foreign_category_is_refused_on_create(self, db_session, two_orgs):
        org_a, user, org_b = two_orgs
        foreign = await _category(db_session, org_b)

        with pytest.raises(HTTPException) as exc:
            await create_requirement(
                _requirement_payload(category_ids=[foreign]), db_session, user
            )

        assert exc.value.status_code == 400
        assert await _count(db_session, TrainingRequirement, org_a) == 0

    async def test_in_org_category_and_none_are_accepted(self, db_session, two_orgs):
        org_a, user, _ = two_orgs
        category = await _category(db_session, org_a)

        linked = await create_requirement(
            _requirement_payload(category_ids=[category]), db_session, user
        )
        bare = await create_requirement(_requirement_payload(), db_session, user)

        assert linked.category_ids == [category]
        assert not bare.category_ids

    async def test_update_refuses_foreign_category(self, db_session, two_orgs):
        org_a, user, org_b = two_orgs
        requirement = await create_requirement(_requirement_payload(), db_session, user)
        foreign = await _category(db_session, org_b)

        with pytest.raises(HTTPException) as exc:
            await update_requirement(
                uuid.UUID(str(requirement.id)),
                TrainingRequirementUpdate(category_ids=[foreign]),
                db_session,
                user,
            )
        assert exc.value.status_code == 400

        own = await _category(db_session, org_a)
        updated = await update_requirement(
            uuid.UUID(str(requirement.id)),
            TrainingRequirementUpdate(category_ids=[own]),
            db_session,
            user,
        )
        assert updated.category_ids == [own]


class TestBulkRecordCategory:
    def _payload(self, user_id: str, category_id: str | None):
        return BulkTrainingRecordCreate(
            records=[
                {
                    "user_id": user_id,
                    "course_name": "Company Drill",
                    "hours_completed": 2,
                    "category_id": category_id,
                }
            ]
        )

    async def test_foreign_category_fails_the_row(self, db_session, two_orgs):
        org_a, user, org_b = two_orgs
        foreign = await _category(db_session, org_b)

        result = await create_records_bulk(
            self._payload(user.id, foreign), BackgroundTasks(), db_session, user
        )

        assert result.created == 0
        assert result.failed == 1
        assert await _count(db_session, TrainingRecord, org_a) == 0

    async def test_in_org_category_and_none_are_recorded(self, db_session, two_orgs):
        org_a, user, _ = two_orgs
        category = await _category(db_session, org_a)

        with_category = await create_records_bulk(
            self._payload(user.id, category), BackgroundTasks(), db_session, user
        )
        without = await create_records_bulk(
            self._payload(user.id, None), BackgroundTasks(), db_session, user
        )

        assert with_category.created == 1
        assert without.created == 1
        assert await _count(db_session, TrainingRecord, org_a) == 2


class TestTrainingSessionLocation:
    def _payload(self, location_id) -> TrainingSessionCreate:
        start = datetime.now(timezone.utc) + timedelta(days=7)
        return TrainingSessionCreate(
            title="Hose Operations",
            start_datetime=start,
            end_datetime=start + timedelta(hours=3),
            requires_rsvp=False,
            use_existing_course=False,
            course_name="Hose Operations",
            training_type="skills_practice",
            credit_hours=3.0,
            location_id=location_id,
        )

    async def _location(self, db, org_id: str) -> str:
        location = Location(organization_id=org_id, name="Station 1 Bay")
        db.add(location)
        await db.flush()
        return str(location.id)

    async def test_foreign_location_is_refused_before_the_event(
        self, db_session, two_orgs
    ):
        org_a, user, org_b = two_orgs
        foreign = await self._location(db_session, org_b)

        session, error = await TrainingSessionService(
            db_session
        ).create_training_session(
            self._payload(uuid.UUID(foreign)), uuid.UUID(org_a), uuid.UUID(user.id)
        )

        assert session is None
        assert error == "Invalid location"
        assert await _count(db_session, Event, org_a) == 0

    async def test_in_org_location_and_none_pass_validation(self, db_session, two_orgs):
        org_a, _, _ = two_orgs
        own = await self._location(db_session, org_a)
        svc = TrainingSessionService(db_session)

        assert (
            await svc._validate_linkage_ids(
                self._payload(uuid.UUID(own)), uuid.UUID(org_a)
            )
            is None
        )
        assert (
            await svc._validate_linkage_ids(self._payload(None), uuid.UUID(org_a))
            is None
        )


class TestCompetencyMatrixReferences:
    async def _skill(self, db, org_id: str) -> str:
        skill = SkillEvaluation(organization_id=org_id, name="Ladder Raise")
        db.add(skill)
        await db.flush()
        return str(skill.id)

    async def _position(self, db, org_id: str) -> str:
        position = Position(
            organization_id=org_id,
            name="Engineer",
            slug=f"engineer-{uuid.uuid4().hex[:6]}",
        )
        db.add(position)
        await db.flush()
        return str(position.id)

    def _data(self, skill_id: str, **kw) -> dict:
        return {
            "name": "Firefighter I",
            "position": "firefighter",
            "skill_requirements": [
                {
                    "skill_evaluation_id": skill_id,
                    "required_level": "competent",
                    "priority": "required",
                }
            ],
            **kw,
        }

    async def test_foreign_skill_is_refused(self, db_session, two_orgs):
        org_a, user, org_b = two_orgs
        foreign = await self._skill(db_session, org_b)

        with pytest.raises(ValueError, match="Invalid skill evaluation"):
            await CompetencyService(db_session).create_matrix(
                org_a, self._data(foreign), user.id
            )
        assert await _count(db_session, CompetencyMatrix, org_a) == 0

    async def test_foreign_role_is_refused(self, db_session, two_orgs):
        org_a, user, org_b = two_orgs
        own_skill = await self._skill(db_session, org_a)
        foreign_role = await self._position(db_session, org_b)

        with pytest.raises(ValueError, match="Invalid role"):
            await CompetencyService(db_session).create_matrix(
                org_a, self._data(own_skill, role_id=foreign_role), user.id
            )
        assert await _count(db_session, CompetencyMatrix, org_a) == 0

    async def test_in_org_references_and_no_role_are_accepted(
        self, db_session, two_orgs
    ):
        org_a, user, org_b = two_orgs
        own_skill = await self._skill(db_session, org_a)
        own_role = await self._position(db_session, org_a)
        svc = CompetencyService(db_session)

        with_role = await svc.create_matrix(
            org_a, self._data(own_skill, role_id=own_role), user.id
        )
        without_role = await svc.create_matrix(org_a, self._data(own_skill), user.id)
        assert with_role.role_id == own_role
        assert without_role.role_id is None

        foreign = await self._skill(db_session, org_b)
        with pytest.raises(ValueError, match="Invalid skill evaluation"):
            await svc.update_matrix(
                str(with_role.id),
                org_a,
                {"skill_requirements": self._data(foreign)["skill_requirements"]},
            )
        # A partial update that carries no reference is not re-validated.
        renamed = await svc.update_matrix(str(with_role.id), org_a, {"name": "FF II"})
        assert renamed.name == "FF II"


class TestManualEntryApparatus:
    async def _apparatus(self, db, org_id: str) -> str:
        apparatus = BasicApparatus(
            organization_id=org_id, unit_number="E1", name="Engine 1"
        )
        db.add(apparatus)
        await db.flush()
        return str(apparatus.id)

    async def test_foreign_apparatus_is_refused(self, db_session, two_orgs):
        org_a, _, org_b = two_orgs
        own = await self._apparatus(db_session, org_a)
        foreign = await self._apparatus(db_session, org_b)

        with pytest.raises(HTTPException) as exc:
            await _assert_apparatus_ids_in_org(db_session, [own, foreign], org_a)
        assert exc.value.status_code == 400

    async def test_in_org_apparatus_and_empty_are_accepted(self, db_session, two_orgs):
        org_a, _, _ = two_orgs
        own = await self._apparatus(db_session, org_a)

        await _assert_apparatus_ids_in_org(db_session, [own], org_a)
        await _assert_apparatus_ids_in_org(db_session, None, org_a)
        await _assert_apparatus_ids_in_org(db_session, [], org_a)


async def _skill(db, org_id: str) -> str:
    skill = SkillEvaluation(organization_id=org_id, name="SCBA Donning")
    db.add(skill)
    await db.flush()
    return str(skill.id)


async def _position(db, org_id: str) -> str:
    position = Position(
        organization_id=org_id,
        name="Probationary",
        slug=f"probie-{uuid.uuid4().hex[:6]}",
    )
    db.add(position)
    await db.flush()
    return str(position.id)


def _skills_payload(**kw) -> TrainingRequirementCreate:
    return TrainingRequirementCreate(
        name="Skill Sign-offs",
        requirement_type="skills_evaluation",
        frequency="annual",
        **kw,
    )


class TestRequirementRequiredSkills:
    """required_skills holds SkillEvaluation ids, on both the training and the
    program requirement paths."""

    async def test_endpoint_refuses_foreign_skill_on_create(self, db_session, two_orgs):
        org_a, user, org_b = two_orgs
        foreign = await _skill(db_session, org_b)

        with pytest.raises(HTTPException) as exc:
            await create_requirement(
                _skills_payload(required_skills=[foreign]), db_session, user
            )

        assert exc.value.status_code == 400
        assert await _count(db_session, TrainingRequirement, org_a) == 0

    async def test_endpoint_accepts_own_skill_and_refuses_foreign_on_update(
        self, db_session, two_orgs
    ):
        org_a, user, org_b = two_orgs
        own = await _skill(db_session, org_a)
        requirement = await create_requirement(
            _skills_payload(required_skills=[own]), db_session, user
        )
        assert requirement.required_skills == [own]

        foreign = await _skill(db_session, org_b)
        with pytest.raises(HTTPException) as exc:
            await update_requirement(
                uuid.UUID(str(requirement.id)),
                TrainingRequirementUpdate(required_skills=[foreign]),
                db_session,
                user,
            )
        assert exc.value.status_code == 400

    async def test_program_service_refuses_foreign_skill(self, db_session, two_orgs):
        org_a, user, org_b = two_orgs
        svc = TrainingProgramService(db_session)
        foreign = await _skill(db_session, org_b)
        own = await _skill(db_session, org_a)

        refused, error = await svc.create_training_requirement(
            TrainingRequirementEnhancedCreate(
                name="Sign-offs",
                requirement_type="skills_evaluation",
                frequency="annual",
                required_skills=[foreign],
            ),
            org_a,
            user.id,
        )
        assert refused is None
        assert error == "Invalid required skill"

        created, error = await svc.create_training_requirement(
            TrainingRequirementEnhancedCreate(
                name="Sign-offs",
                requirement_type="skills_evaluation",
                frequency="annual",
                required_skills=[own],
            ),
            org_a,
            user.id,
        )
        assert error is None
        assert created.required_skills == [own]

        updated, error = await svc.update_training_requirement(
            created.id, org_a, {"required_skills": [foreign]}
        )
        assert updated is None
        assert error == "Invalid required skill"


class TestProgramTargetRoles:
    """target_roles holds Position ids (the schema accepts UUIDs only)."""

    async def test_create_refuses_foreign_and_accepts_own(self, db_session, two_orgs):
        org_a, user, org_b = two_orgs
        svc = TrainingProgramService(db_session)
        foreign = await _position(db_session, org_b)
        own = await _position(db_session, org_a)

        refused, error = await svc.create_training_program(
            TrainingProgramCreate(name="Recruit", target_roles=[foreign]),
            org_a,
            user.id,
        )
        assert refused is None
        assert error == "Invalid target position"

        program, error = await svc.create_training_program(
            TrainingProgramCreate(name="Recruit", target_roles=[own]),
            org_a,
            user.id,
        )
        assert error is None
        assert program.target_roles == [own]

        updated, error = await svc.update_training_program(
            program.id, org_a, TrainingProgramUpdate(target_roles=[foreign])
        )
        assert updated is None
        assert error == "Invalid target position"

    async def test_import_keeps_only_this_departments_positions(
        self, db_session, two_orgs
    ):
        org_a, user, org_b = two_orgs
        foreign = await _position(db_session, org_b)
        own = await _position(db_session, org_a)

        result = await TrainingProgramService(db_session).import_program_from_json(
            {
                "program": {
                    "name": "Shared Recruit School",
                    "structure_type": "flexible",
                    "target_roles": [foreign, own],
                },
                "phases": [],
                "milestones": [],
            },
            org_a,
            user.id,
        )

        assert result.program is not None
        assert result.program.target_roles == [own]

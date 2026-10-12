"""The department's choice of practical-skills system.

A department runs Skills Testing (station sheets, validated by an officer) or
shift-report sign-offs (skills ticked as demonstrated on a shift report), not
both. These pin what the choice changes on the server:

  * the single reader every caller uses, and how it treats a department that
    never chose, or a value it does not recognise;
  * a shift report approved under Skills Testing records no sign-off, so no
    competency or program credit arrives behind the officer's back;
  * the training hub's skills-test review row follows the choice;
  * choosing is administering, so ``training.configure`` alone cannot do it.
"""

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.skills_testing import SkillTemplate, SkillTest
from app.models.training import (
    MemberCompetency,
    SkillCheckoff,
    SkillEvaluation,
    TrainingModuleConfig,
)
from app.models.user import Organization, Position, User, UserStatus
from app.schemas.training_module_config import (
    MEMBER_DISCLOSURE_FIELDS,
    TrainingModuleConfigResponse,
)
from app.services.admin_hub_service import MODULE_REGISTRY, AdminHubService
from app.services.shift_completion_service import ShiftCompletionService
from app.services.training_module_config_service import (
    get_practical_skills_method,
)

pytestmark = pytest.mark.integration


async def _org(db_session: AsyncSession) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Skills Method Department",
        slug=f"skills-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _user(db_session, org, *, permissions: list[str] | None = None) -> User:
    handle = uuid.uuid4().hex[:10]
    positions: list[Position] = []
    if permissions:
        position = Position(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            name=f"Officer {handle}",
            slug=f"officer-{handle}",
            permissions=permissions,
        )
        db_session.add(position)
        await db_session.flush()
        positions.append(position)
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"skills-{handle}",
        email=f"{handle}@skills.test",
        first_name="Alex",
        last_name="Lee",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    # Assigned even when empty: an unloaded collection is deferred IO under
    # asyncio, not "no permissions".
    user.positions = positions
    db_session.add(user)
    await db_session.flush()
    return user


async def _choose(db_session, org, method: str | None) -> None:
    db_session.add(
        TrainingModuleConfig(organization_id=org.id, practical_skills_method=method)
    )
    await db_session.flush()


class TestReader:
    async def test_a_department_that_never_chose_runs_skills_testing(self, db_session):
        org = await _org(db_session)

        assert await get_practical_skills_method(db_session, org.id) == (
            "skills_testing"
        )
        # Reading must not create the config row as a side effect.
        rows = await db_session.execute(
            select(func.count(TrainingModuleConfig.id)).where(
                TrainingModuleConfig.organization_id == org.id
            )
        )
        assert rows.scalar() == 0

    async def test_a_null_choice_reads_as_skills_testing(self, db_session):
        org = await _org(db_session)
        await _choose(db_session, org, None)

        assert await get_practical_skills_method(db_session, org.id) == (
            "skills_testing"
        )

    async def test_returns_the_departments_choice(self, db_session):
        org = await _org(db_session)
        await _choose(db_session, org, "shift_signoffs")

        assert await get_practical_skills_method(db_session, org.id) == (
            "shift_signoffs"
        )

    async def test_an_unrecognised_value_reads_as_the_default(self, db_session):
        # A scheduled task or an approval must not fail on a stray value.
        org = await _org(db_session)
        await _choose(db_session, org, "something_else")

        assert await get_practical_skills_method(db_session, org.id) == (
            "skills_testing"
        )

    async def test_the_settings_response_reports_skills_testing_for_null(
        self, db_session
    ):
        org = await _org(db_session)
        await _choose(db_session, org, None)
        config = (
            await db_session.execute(
                select(TrainingModuleConfig).where(
                    TrainingModuleConfig.organization_id == org.id
                )
            )
        ).scalar_one()

        response = TrainingModuleConfigResponse.model_validate(config)

        assert response.practical_skills_method == "skills_testing"


class TestShiftReportSignOffs:
    async def _approve_demonstrated(self, db_session, org, officer, trainee):
        skill = SkillEvaluation(organization_id=org.id, name="SCBA Donning")
        db_session.add(skill)
        await db_session.flush()
        matched = await ShiftCompletionService(db_session)._create_skill_checkoffs(
            organization_id=uuid.UUID(org.id),
            trainee_id=trainee.id,
            officer_id=uuid.UUID(officer.id),
            skills_observed=[
                {"skill_name": "scba donning", "demonstrated": True, "score": 4}
            ],
        )
        checkoffs = (
            await db_session.execute(
                select(func.count(SkillCheckoff.id)).where(
                    SkillCheckoff.organization_id == org.id
                )
            )
        ).scalar()
        competencies = (
            await db_session.execute(
                select(func.count(MemberCompetency.id)).where(
                    MemberCompetency.organization_id == org.id
                )
            )
        ).scalar()
        return matched, checkoffs, competencies, skill

    async def test_signs_off_for_a_department_on_shift_signoffs(self, db_session):
        org = await _org(db_session)
        officer = await _user(db_session, org)
        trainee = await _user(db_session, org)
        await _choose(db_session, org, "shift_signoffs")

        matched, checkoffs, competencies, skill = await self._approve_demonstrated(
            db_session, org, officer, trainee
        )

        assert matched == [skill.id]
        assert checkoffs == 1
        assert competencies == 1

    async def test_records_nothing_for_a_department_on_skills_testing(self, db_session):
        org = await _org(db_session)
        officer = await _user(db_session, org)
        trainee = await _user(db_session, org)
        await _choose(db_session, org, "skills_testing")

        matched, checkoffs, competencies, _ = await self._approve_demonstrated(
            db_session, org, officer, trainee
        )

        # Nothing matched, so nothing credits a program step either.
        assert matched == []
        assert checkoffs == 0
        assert competencies == 0

    async def test_records_nothing_for_a_department_that_never_chose(self, db_session):
        org = await _org(db_session)
        officer = await _user(db_session, org)
        trainee = await _user(db_session, org)

        matched, checkoffs, _, _ = await self._approve_demonstrated(
            db_session, org, officer, trainee
        )

        assert matched == []
        assert checkoffs == 0


class TestTrainingHub:
    async def _pending_test(self, db_session, org, member):
        template = SkillTemplate(
            organization_id=org.id,
            name="Ladder Raise",
            sections=[{"title": "Raise", "criteria": []}],
            status="published",
        )
        db_session.add(template)
        await db_session.flush()
        now = datetime.now(timezone.utc).replace(microsecond=0)
        db_session.add(
            SkillTest(
                organization_id=org.id,
                template_id=template.id,
                candidate_id=member.id,
                examiner_id=member.id,
                status="completed",
                result="pass",
                started_at=now,
                completed_at=now,
                created_at=now,
            )
        )
        await db_session.flush()

    async def _queue(self, db_session, officer) -> dict:
        ctx = await AdminHubService(db_session)._context(officer)
        items = await MODULE_REGISTRY["training"].attention(ctx)
        return {item.key: item for item in items}

    async def test_reports_tests_awaiting_validation_under_skills_testing(
        self, db_session
    ):
        org = await _org(db_session)
        officer = await _user(db_session, org, permissions=["training.manage"])
        member = await _user(db_session, org)
        await self._pending_test(db_session, org, member)

        assert "skill_tests_awaiting_validation" in await self._queue(
            db_session, officer
        )

    async def test_drops_the_row_for_a_department_on_shift_signoffs(self, db_session):
        # The records tab the row opens is hidden for this department.
        org = await _org(db_session)
        officer = await _user(db_session, org, permissions=["training.manage"])
        member = await _user(db_session, org)
        await _choose(db_session, org, "shift_signoffs")
        await self._pending_test(db_session, org, member)

        assert "skill_tests_awaiting_validation" not in await self._queue(
            db_session, officer
        )

    async def test_the_tests_passed_metric_says_why_it_is_unavailable(self, db_session):
        org = await _org(db_session)
        officer = await _user(db_session, org, permissions=["training.manage"])
        await _choose(db_session, org, "shift_signoffs")
        ctx = await AdminHubService(db_session)._context(officer)
        metric = next(
            m
            for m in MODULE_REGISTRY["training"].metrics
            if m.key == "skills_tests_passed"
        )

        reason = await metric.availability(ctx)

        assert reason == "The department records skills on shift reports"


def test_choosing_the_system_needs_training_manage():
    """`training.configure` writes only the member-disclosure subset."""
    assert "practical_skills_method" not in MEMBER_DISCLOSURE_FIELDS


async def test_an_unknown_method_is_refused_on_save():
    from pydantic import ValidationError

    from app.schemas.training_module_config import TrainingModuleConfigUpdate

    with pytest.raises(ValidationError):
        TrainingModuleConfigUpdate(practical_skills_method="both")


async def test_the_backfill_query_is_valid_sql(db_session):
    """The migration's backfill runs against the real tables.

    Executed inside the test's rolled-back transaction, against a department
    that signs off on shift reports and has never run a test, and one that
    has done both.
    """
    signoffs = await _org(db_session)
    both = await _org(db_session)
    for org in (signoffs, both):
        member = await _user(db_session, org)
        skill = SkillEvaluation(organization_id=org.id, name="Hose Advance")
        db_session.add(skill)
        await db_session.flush()
        db_session.add(
            SkillCheckoff(
                organization_id=org.id,
                user_id=member.id,
                skill_evaluation_id=skill.id,
                evaluator_id=member.id,
                status="passed",
            )
        )
        await _choose(db_session, org, None)
    tester = await _user(db_session, both)
    template = SkillTemplate(
        organization_id=both.id,
        name="Hose Advance",
        sections=[{"title": "Advance", "criteria": []}],
        status="published",
    )
    db_session.add(template)
    await db_session.flush()
    db_session.add(
        SkillTest(
            organization_id=both.id,
            template_id=template.id,
            candidate_id=tester.id,
            examiner_id=tester.id,
            status="completed",
            result="pass",
        )
    )
    await db_session.flush()

    # Loaded by path: `alembic` on the import path is the library, not the
    # migrations directory.
    import importlib.util
    from pathlib import Path

    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "20261012_1535_bde76b481a16_practical_skills_method.py"
    )
    spec = importlib.util.spec_from_file_location("practical_skills_migration", path)
    assert spec is not None
    assert spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    await db_session.execute(text(migration.backfill_statement(has_skill_tests=True)))

    assert await get_practical_skills_method(db_session, signoffs.id) == (
        "shift_signoffs"
    )
    assert await get_practical_skills_method(db_session, both.id) == ("skills_testing")

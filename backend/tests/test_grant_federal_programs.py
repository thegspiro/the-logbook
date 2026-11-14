"""The four Federal Programs are real opportunities of every department.

Owner decision, 2026-11-01 ("Grants — Opportunities Could Not Be Edited":
seed as opportunities). Pinned here:

* a department gets AFG, SAFER, FP&S and Firehouse Subs as active
  opportunities, with the text the page's cards carried; a second call adds
  nothing; a code the department already holds — retired, or typed in by
  hand — is not given again; another department is untouched (#14);
* a department created through onboarding has them;
* migration ``3c1f5e2a9d47`` gives them to departments that existed before,
  with rows present (pitfall #35): a held code is skipped, a re-run adds
  nothing, and the downgrade removes only untouched seeded rows;
* the migration's frozen copy matches the service's list.
"""

import importlib.util
import uuid
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.grant import (
    DeadlineType,
    GrantApplication,
    GrantCategory,
    GrantOpportunity,
)
from app.models.user import Organization
from app.services.grant_federal_programs import (
    FEDERAL_PROGRAM_CODES,
    FEDERAL_PROGRAMS,
    seed_federal_program_opportunities,
)
from app.services.onboarding import OnboardingService

_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261106_0619_3c1f5e2a9d47_seed_the_four_federal_programs_as_grant_.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("_federal_programs", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _migration()


@pytest.mark.unit
class TestTheMigrationCarriesTheSamePrograms:
    def test_frozen_copy_matches_the_service(self):
        frozen = {
            code: (name, agency, description, category)
            for code, name, agency, description, category in MIGRATION.PROGRAMS
        }
        live = {
            p["federal_program_code"]: (
                p["name"],
                p["agency"],
                p["description"],
                p["category"].value,
            )
            for p in FEDERAL_PROGRAMS
        }
        assert frozen == live
        assert set(FEDERAL_PROGRAM_CODES) == {"AFG", "SAFER", "FP&S", "FIREHOUSE_SUBS"}


async def _org(db: AsyncSession, label: str) -> str:
    org = Organization(
        id=str(uuid.uuid4()),
        name=f"{label} VFD",
        slug=f"federal-{label}-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db.add(org)
    await db.flush()
    return org.id


async def _held(db: AsyncSession, org_id: str) -> list[GrantOpportunity]:
    result = await db.execute(
        select(GrantOpportunity)
        .where(GrantOpportunity.organization_id == org_id)
        .order_by(GrantOpportunity.federal_program_code)
    )
    return list(result.scalars().all())


def _hand_entered(org_id: str, code: str, **kw) -> GrantOpportunity:
    return GrantOpportunity(
        organization_id=org_id,
        name=f"Our own {code} entry",
        federal_program_code=code,
        **kw,
    )


@pytest.mark.integration
class TestSeedingADepartment:
    async def test_the_four_programs_as_active_startable_opportunities(
        self, db_session
    ):
        org_id = await _org(db_session, "new")
        assert await seed_federal_program_opportunities(db_session, org_id) == 4
        held = {o.federal_program_code: o for o in await _held(db_session, org_id)}
        assert set(held) == set(FEDERAL_PROGRAM_CODES)
        afg = held["AFG"]
        assert afg.name == "Assistance to Firefighters Grant (AFG)"
        assert afg.agency == "FEMA"
        assert afg.category == GrantCategory.EQUIPMENT
        assert afg.deadline_type == DeadlineType.RECURRING
        assert afg.description.startswith("Provides funding for critically")
        assert all(o.is_active for o in held.values())
        assert held["SAFER"].category == GrantCategory.STAFFING
        assert held["FP&S"].category == GrantCategory.PREVENTION
        assert held["FIREHOUSE_SUBS"].agency == "Firehouse Subs Foundation"

    async def test_a_second_call_adds_nothing(self, db_session):
        org_id = await _org(db_session, "twice")
        await seed_federal_program_opportunities(db_session, org_id)
        assert await seed_federal_program_opportunities(db_session, org_id) == 0
        assert len(await _held(db_session, org_id)) == 4

    async def test_a_held_code_is_not_given_again(self, db_session):
        org_id = await _org(db_session, "held")
        db_session.add_all(
            [
                _hand_entered(org_id, "AFG"),
                _hand_entered(org_id, "SAFER", is_active=False),
            ]
        )
        await db_session.flush()
        assert await seed_federal_program_opportunities(db_session, org_id) == 2
        held = await _held(db_session, org_id)
        assert len(held) == 4
        safer = next(o for o in held if o.federal_program_code == "SAFER")
        assert safer.is_active is False
        assert safer.name == "Our own SAFER entry"

    async def test_another_department_is_untouched(self, db_session):
        org_id = await _org(db_session, "mine")
        other = await _org(db_session, "theirs")
        await seed_federal_program_opportunities(db_session, org_id)
        assert await _held(db_session, other) == []

    async def test_a_department_set_up_through_onboarding_has_them(self, db_session):
        org = await OnboardingService(db_session).create_organization(
            name="Onboarded Fire Dept",
            slug=f"onboarded-{uuid.uuid4().hex[:8]}",
            identifier_type="fdid",
            fdid="99999",
            timezone="America/Chicago",
            mailing_address_line1="100 Main St",
            mailing_city="Springfield",
            mailing_state="IL",
            mailing_zip="62701",
        )
        codes = {o.federal_program_code for o in await _held(db_session, org.id)}
        assert codes == set(FEDERAL_PROGRAM_CODES)


async def _run(db: AsyncSession, step: str) -> None:
    def go(session):
        context = MigrationContext.configure(session.connection())
        with Operations.context(context):
            getattr(MIGRATION, step)()

    await db.run_sync(go)
    db.expire_all()


@pytest.mark.integration
class TestTheMigration:
    async def test_existing_departments_get_them_once(self, db_session):
        bare = await _org(db_session, "bare")
        partial = await _org(db_session, "partial")
        db_session.add(_hand_entered(partial, "FP&S", is_active=False))
        await db_session.flush()

        await _run(db_session, "upgrade")
        bare_codes = [o.federal_program_code for o in await _held(db_session, bare)]
        assert sorted(bare_codes) == sorted(FEDERAL_PROGRAM_CODES)
        partial_rows = await _held(db_session, partial)
        assert len(partial_rows) == 4
        fps = [o for o in partial_rows if o.federal_program_code == "FP&S"]
        assert [o.name for o in fps] == ["Our own FP&S entry"]
        assert fps[0].is_active is False
        afg = next(
            o for o in await _held(db_session, bare) if o.federal_program_code == "AFG"
        )
        assert afg.is_active is True
        assert afg.match_required is False
        assert afg.deadline_type == DeadlineType.RECURRING

        await _run(db_session, "upgrade")
        assert len(await _held(db_session, bare)) == 4
        assert len(await _held(db_session, partial)) == 4

    async def test_the_downgrade_keeps_what_a_department_used(self, db_session):
        org_id = await _org(db_session, "down")
        db_session.add(_hand_entered(org_id, "AFG"))
        await db_session.flush()
        await _run(db_session, "upgrade")
        safer = next(
            o
            for o in await _held(db_session, org_id)
            if o.federal_program_code == "SAFER"
        )
        db_session.add(
            GrantApplication(
                organization_id=org_id,
                opportunity_id=safer.id,
                grant_program_name=safer.name,
            )
        )
        await db_session.flush()

        await _run(db_session, "downgrade")
        left = {o.federal_program_code: o.name for o in await _held(db_session, org_id)}
        assert left == {
            "AFG": "Our own AFG entry",
            "SAFER": "Staffing for Adequate Fire and Emergency Response (SAFER)",
        }

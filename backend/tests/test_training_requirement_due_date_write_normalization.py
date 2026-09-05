"""
Tests that the training requirement create/update endpoints normalize
``due_date`` at write time, rather than relying solely on the
``days_until_due`` calculators (``check_requirement_progress``,
``evaluate_requirement_detail``) to ignore a stale value at read time.

RequirementModal.tsx seeds its ``due_date`` form field from the existing
row and only clears/edits it on the ``fixed_date`` screen, so switching a
requirement to any other ``due_date_type`` can still submit the old
``due_date`` alongside it. Codex found that even after those calculators
were fixed to ignore a stale value (TR3-1 rounds 6-7), other readers that
expose ``requirement.due_date`` directly -- the requirements dashboard
widget (``training.py``'s own list endpoint), the requirement detail page
-- still showed it. The fix here is at the source: the create/update
endpoints null out ``due_date`` whenever the resulting ``due_date_type``
isn't ``fixed_date`` (or unset, for legacy rows), so no reader can ever
see a stale value regardless of which field it reads.
"""

import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace
from uuid import UUID

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.training import create_requirement, update_requirement
from app.models.training import TrainingRequirement
from app.schemas.training import TrainingRequirementCreate, TrainingRequirementUpdate

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


_NOW = datetime.now(timezone.utc)


@pytest.fixture
async def org_and_user(db_session: AsyncSession):
    """Insert a minimal organization and user, returning a duck-typed
    current_user (only .id/.organization_id are read by the endpoint
    functions under test). A real user row is needed for create_requirement,
    whose created_by column has a FOREIGN KEY on users.id."""
    org_id = _uid()
    user_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, :otype, :slug, :tz)"
        ),
        {
            "id": org_id,
            "name": "Test Dept",
            "otype": "fire_department",
            "slug": f"test-{org_id[:8]}",
            "tz": "UTC",
        },
    )
    await db_session.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, :ln, :em, :pw, 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"jsmith-{user_id[:8]}",
            "fn": "John",
            "ln": "Smith",
            "em": f"jsmith-{user_id[:8]}@test.com",
            "pw": "hashed",
        },
    )
    await db_session.flush()
    return SimpleNamespace(id=user_id, organization_id=org_id)


async def _insert_fixed_date_requirement(
    db_session: AsyncSession, org_id: str, *, due_date: date
) -> str:
    """A pre-existing requirement configured as fixed_date, for update tests."""
    req_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO training_requirements "
            "(id, organization_id, name, requirement_type, source, "
            "required_hours, frequency, due_date_type, due_date, "
            "applies_to_all, active, created_at, updated_at) "
            "VALUES (:id, :org_id, :name, 'hours', 'department', "
            ":hours, 'annual', 'fixed_date', :due_date, "
            "1, 1, :now, :now)"
        ),
        {
            "id": req_id,
            "org_id": org_id,
            "name": "Annual Training Hours",
            "hours": 24.0,
            "due_date": due_date,
            "now": _NOW,
        },
    )
    await db_session.flush()
    return req_id


class TestUpdateRequirementNormalizesDueDate:
    async def test_switching_away_from_fixed_date_clears_the_stale_due_date(
        self, db_session: AsyncSession, org_and_user
    ):
        current_user = org_and_user
        stale_due = date(2020, 1, 1)
        req_id = await _insert_fixed_date_requirement(
            db_session, current_user.organization_id, due_date=stale_due
        )

        # The frontend still submits the old due_date alongside the new
        # due_date_type when switching away from fixed_date -- reproduced
        # here directly rather than assumed.
        await update_requirement(
            requirement_id=UUID(req_id),
            requirement_update=TrainingRequirementUpdate(
                due_date_type="rolling",
                rolling_period_months=24,
                due_date=stale_due,
            ),
            db=db_session,
            current_user=current_user,
        )

        result = await db_session.execute(
            select(TrainingRequirement).where(TrainingRequirement.id == req_id)
        )
        updated = result.scalar_one()
        assert updated.due_date_type == "rolling"
        assert updated.due_date is None

    async def test_switching_to_calendar_period_clears_the_stale_due_date(
        self, db_session: AsyncSession, org_and_user
    ):
        """Same normalization applies to calendar_period, not just
        rolling/certification_period -- TR3-1 round 7's finding."""
        current_user = org_and_user
        stale_due = date(2020, 1, 1)
        req_id = await _insert_fixed_date_requirement(
            db_session, current_user.organization_id, due_date=stale_due
        )

        await update_requirement(
            requirement_id=UUID(req_id),
            requirement_update=TrainingRequirementUpdate(
                due_date_type="calendar_period", due_date=stale_due
            ),
            db=db_session,
            current_user=current_user,
        )

        result = await db_session.execute(
            select(TrainingRequirement).where(TrainingRequirement.id == req_id)
        )
        updated = result.scalar_one()
        assert updated.due_date_type == "calendar_period"
        assert updated.due_date is None

    async def test_a_genuine_fixed_date_update_keeps_its_due_date(
        self, db_session: AsyncSession, org_and_user
    ):
        """The normalization must not clear a legitimate fixed_date due_date."""
        current_user = org_and_user
        req_id = await _insert_fixed_date_requirement(
            db_session, current_user.organization_id, due_date=date(2020, 1, 1)
        )
        new_due = date(2027, 6, 1)

        await update_requirement(
            requirement_id=UUID(req_id),
            requirement_update=TrainingRequirementUpdate(due_date=new_due),
            db=db_session,
            current_user=current_user,
        )

        result = await db_session.execute(
            select(TrainingRequirement).where(TrainingRequirement.id == req_id)
        )
        updated = result.scalar_one()
        assert updated.due_date_type == "fixed_date"
        assert updated.due_date == new_due

    async def test_touching_an_already_stale_row_cleans_it_up(
        self, db_session: AsyncSession, org_and_user
    ):
        """A row that already carries a stale due_date from before this
        normalization existed gets cleaned up the next time it's touched,
        even if the update itself doesn't mention due_date at all."""
        current_user = org_and_user
        req_id = _uid()
        await db_session.execute(
            text(
                "INSERT INTO training_requirements "
                "(id, organization_id, name, requirement_type, source, "
                "required_hours, frequency, due_date_type, due_date, "
                "applies_to_all, active, created_at, updated_at) "
                "VALUES (:id, :org_id, :name, 'hours', 'department', "
                ":hours, 'annual', 'certification_period', :due_date, "
                "1, 1, :now, :now)"
            ),
            {
                "id": req_id,
                "org_id": current_user.organization_id,
                "name": "Pre-existing stale requirement",
                "hours": 24.0,
                "due_date": date(2020, 1, 1),
                "now": _NOW,
            },
        )
        await db_session.flush()

        await update_requirement(
            requirement_id=UUID(req_id),
            requirement_update=TrainingRequirementUpdate(name="Renamed"),
            db=db_session,
            current_user=current_user,
        )

        result = await db_session.execute(
            select(TrainingRequirement).where(TrainingRequirement.id == req_id)
        )
        updated = result.scalar_one()
        assert updated.name == "Renamed"
        assert updated.due_date is None


class TestCreateRequirementNormalizesDueDate:
    async def test_creating_a_non_fixed_date_requirement_ignores_a_sent_due_date(
        self, db_session: AsyncSession, org_and_user
    ):
        current_user = org_and_user
        created = await create_requirement(
            requirement=TrainingRequirementCreate(
                name="Rolling Hours",
                requirement_type="hours",
                required_hours=24.0,
                frequency="annual",
                due_date_type="rolling",
                rolling_period_months=24,
                due_date=date(2020, 1, 1),
            ),
            db=db_session,
            current_user=current_user,
        )

        assert created.due_date_type == "rolling"
        assert created.due_date is None

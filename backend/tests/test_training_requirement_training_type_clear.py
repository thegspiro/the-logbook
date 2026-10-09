"""
Widening a training requirement back to "any training type" must persist.

RequirementModal.tsx used to omit ``training_type`` when the officer chose
"Any Type", and an update omits a key to mean "leave it alone", so a
requirement narrowed to continuing education stayed narrowed after the
officer widened it and saved for everyone. The form now sends an explicit
``null``; these tests pin the backend half of that contract for both the
"everyone" and the "new members only" save paths.
"""

import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace
from uuid import UUID

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.training import update_requirement
from app.models.training import TrainingRequirement
from app.schemas.training import TrainingRequirementUpdate

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def current_user(db_session: AsyncSession):
    org_id = _uid()
    user_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Test Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"test-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'John', 'Smith', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"jsmith-{user_id[:8]}",
            "em": f"jsmith-{user_id[:8]}@test.com",
        },
    )
    await db_session.flush()
    return SimpleNamespace(
        id=user_id, organization_id=org_id, username=f"jsmith-{user_id[:8]}"
    )


async def _insert_ce_rolling_requirement(db_session: AsyncSession, org_id: str) -> str:
    """72 hours over a rolling 12 months, continuing education only."""
    req_id = _uid()
    now = datetime.now(timezone.utc)
    await db_session.execute(
        text(
            "INSERT INTO training_requirements "
            "(id, organization_id, name, requirement_type, source, training_type, "
            "required_hours, frequency, due_date_type, rolling_period_months, "
            "applies_to_all, active, created_at, updated_at) "
            "VALUES (:id, :org, 'Annual Hours', 'hours', 'department', "
            "'continuing_education', 72, 'annual', 'rolling', 12, "
            "1, 1, :now, :now)"
        ),
        {"id": req_id, "org": org_id, "now": now},
    )
    await db_session.flush()
    return req_id


async def _load(db_session: AsyncSession, req_id: str) -> TrainingRequirement:
    result = await db_session.execute(
        select(TrainingRequirement).where(TrainingRequirement.id == req_id)
    )
    return result.scalar_one()


class TestWideningTrainingType:
    async def test_saving_for_everyone_clears_the_training_type(
        self, db_session: AsyncSession, current_user
    ):
        req_id = await _insert_ce_rolling_requirement(
            db_session, current_user.organization_id
        )

        await update_requirement(
            requirement_id=UUID(req_id),
            requirement_update=TrainingRequirementUpdate(
                apply_to="everyone", training_type=None
            ),
            db=db_session,
            current_user=current_user,
        )

        db_session.expire_all()
        assert (await _load(db_session, req_id)).training_type is None

    async def test_omitting_the_training_type_leaves_it_alone(
        self, db_session: AsyncSession, current_user
    ):
        req_id = await _insert_ce_rolling_requirement(
            db_session, current_user.organization_id
        )

        await update_requirement(
            requirement_id=UUID(req_id),
            requirement_update=TrainingRequirementUpdate(required_hours=80),
            db=db_session,
            current_user=current_user,
        )

        db_session.expire_all()
        updated = await _load(db_session, req_id)
        assert updated.required_hours == 80
        assert updated.training_type == "continuing_education"

    async def test_saving_for_new_members_clears_it_on_the_new_copy_only(
        self, db_session: AsyncSession, current_user
    ):
        req_id = await _insert_ce_rolling_requirement(
            db_session, current_user.organization_id
        )

        response = await update_requirement(
            requirement_id=UUID(req_id),
            requirement_update=TrainingRequirementUpdate(
                apply_to="new_members_only",
                effective_date=date(2026, 11, 1),
                training_type=None,
            ),
            db=db_session,
            current_user=current_user,
        )

        new_id = str(response.id)
        db_session.expire_all()
        assert (await _load(db_session, new_id)).training_type is None
        assert (await _load(db_session, req_id)).training_type == (
            "continuing_education"
        )

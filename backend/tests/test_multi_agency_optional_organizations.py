"""A multi-agency exercise may be logged before any other agency is named.

The create form sends an empty list when its organization box is blank (its
hint says organizations can be added later); the schema used to demand at
least one and the save failed with a 422.
"""

import uuid
from datetime import date

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.training_enhancements import (
    MultiAgencyTrainingCreate,
    MultiAgencyTrainingResponse,
)
from app.services.training_enhancement_service import MultiAgencyService


def _payload(**extra):
    return {
        "exercise_name": "Regional Tabletop",
        "exercise_type": "tabletop",
        "exercise_date": "2026-11-12",
        **extra,
    }


@pytest.mark.unit
class TestSchema:
    def test_an_empty_list_is_accepted(self):
        data = MultiAgencyTrainingCreate.model_validate(
            _payload(participating_organizations=[])
        )
        assert data.participating_organizations == []

    def test_an_omitted_list_defaults_to_empty(self):
        data = MultiAgencyTrainingCreate.model_validate(_payload())
        assert data.participating_organizations == []


@pytest.mark.integration
class TestCreateWithNoOrganizations:
    @pytest.fixture
    async def dept(self, db_session: AsyncSession):
        org_id = str(uuid.uuid4())
        user_id = str(uuid.uuid4())
        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, "
                "timezone) VALUES (:id, 'Test Dept', 'fire_department', :slug, 'UTC')"
            ),
            {"id": org_id, "slug": f"org-{org_id[:8]}"},
        )
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) VALUES "
                "(:id, :org, :un, 'Officer', 'Tester', :em, 'hashed', 'active')"
            ),
            {
                "id": user_id,
                "org": org_id,
                "un": f"officer-{user_id[:8]}",
                "em": f"officer-{user_id[:8]}@test.com",
            },
        )
        await db_session.flush()
        return org_id, user_id

    async def test_saved_and_returned_with_an_empty_list(self, db_session, dept):
        org_id, user_id = dept
        data = MultiAgencyTrainingCreate.model_validate(
            _payload(participating_organizations=[])
        )
        exercise = await MultiAgencyService(db_session).create_exercise(
            org_id, data.model_dump(exclude_unset=True), user_id
        )
        exercise_id = exercise.id
        db_session.expire_all()

        rows = await MultiAgencyService(db_session).get_exercises(org_id)
        stored = next(e for e in rows if e.id == exercise_id)
        response = MultiAgencyTrainingResponse.model_validate(stored)
        assert response.participating_organizations == []
        assert response.exercise_date == date(2026, 11, 12)

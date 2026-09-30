"""
Interview edits: an explicit null clears, an omitted key is left alone.

The interview edit form sent `notes: ''` as `undefined` and the service skipped
every None it was handed, so emptying an interview's notes was acknowledged
with "Interview updated" while the old notes stayed in the database (CLAUDE.md
Pitfall #1, update half). The endpoint now dumps with `exclude_unset` and the
service writes through `apply_updates`, which is what these tests pin.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.membership_pipeline import InterviewRecommendation
from app.schemas.membership_pipeline import InterviewUpdate
from app.services.membership_pipeline_service import MembershipPipelineService


def _uid() -> str:
    return str(uuid.uuid4())


# =========================================================================
# Pure: the schema dump and the service's write, with the DB mocked out
# =========================================================================


@pytest.mark.unit
class TestInterviewUpdatePayload:
    def test_exclude_unset_keeps_explicit_null_and_drops_omitted(self):
        dumped = InterviewUpdate(notes=None).model_dump(exclude_unset=True)
        assert dumped == {"notes": None}

    async def test_service_clears_null_and_leaves_omitted_alone(self):
        interview = SimpleNamespace(
            id="iv-1",
            prospect_id="p-1",
            step_id=None,
            interviewer_id="u-1",
            notes="Strong candidate",
            recommendation=InterviewRecommendation.RECOMMEND,
            recommendation_notes="Keep an eye on availability",
            interviewer_role="Chief",
            interview_date=None,
        )
        svc = MembershipPipelineService.__new__(MembershipPipelineService)
        svc.db = SimpleNamespace(commit=AsyncMock())

        with (
            patch.object(svc, "get_interview", AsyncMock(return_value=interview)),
            patch.object(svc, "_log_activity", AsyncMock()),
        ):
            await svc.update_interview(
                "iv-1",
                "org-1",
                "u-1",
                {"notes": None, "recommendation": None},
            )

        assert interview.notes is None
        assert interview.recommendation is None
        # Not in the payload, so untouched.
        assert interview.recommendation_notes == "Keep an eye on availability"
        assert interview.interviewer_role == "Chief"


# =========================================================================
# Database-backed: the row actually changes (or does not)
# =========================================================================


@pytest.fixture
async def org(db_session: AsyncSession):
    org_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": "Interview Clear Dept", "slug": f"ic-{org_id[:8]}"},
    )
    await db_session.flush()
    return org_id


@pytest.fixture
async def interviewer(db_session: AsyncSession, org):
    user_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, email, "
            "password_hash, status) VALUES "
            "(:id, :org, :username, 'Ira', 'Viewer', :email, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org,
            "username": f"interviewer-{user_id[:8]}",
            "email": f"interviewer-{user_id[:8]}@example.com",
        },
    )
    await db_session.flush()
    return user_id


@pytest.mark.integration
class TestInterviewUpdateClearsInDatabase:
    async def _interview(self, db_session: AsyncSession, org_id, interviewer_id):
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(organization_id=org_id, name="Recruit")
        await svc.add_step(
            pipeline.id,
            org_id,
            {"name": "Intake", "step_type": "checkbox", "sort_order": 0},
        )
        prospect = await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "Dana",
                "last_name": "Reed",
                "email": f"dana-{_uid()[:8]}@example.com",
                "pipeline_id": pipeline.id,
            },
        )
        interview = await svc.create_interview(
            prospect_id=prospect.id,
            organization_id=org_id,
            interviewer_id=interviewer_id,
            notes="Strong candidate",
            recommendation="recommend",
            recommendation_notes="Keep an eye on availability",
            interviewer_role="Chief",
        )
        return svc, interview

    async def test_explicit_null_clears_the_column(
        self, db_session: AsyncSession, org, interviewer
    ):
        svc, interview = await self._interview(db_session, org, interviewer)

        payload = InterviewUpdate(notes=None, recommendation_notes=None)
        await svc.update_interview(
            interview.id, org, interviewer, payload.model_dump(exclude_unset=True)
        )

        stored = await svc.get_interview(interview.id, org)
        assert stored.notes is None
        assert stored.recommendation_notes is None

    async def test_omitted_key_is_left_alone(
        self, db_session: AsyncSession, org, interviewer
    ):
        svc, interview = await self._interview(db_session, org, interviewer)

        payload = InterviewUpdate(interviewer_role="Captain")
        await svc.update_interview(
            interview.id, org, interviewer, payload.model_dump(exclude_unset=True)
        )

        stored = await svc.get_interview(interview.id, org)
        assert stored.interviewer_role == "Captain"
        assert stored.notes == "Strong candidate"
        assert stored.recommendation == InterviewRecommendation.RECOMMEND
        assert stored.recommendation_notes == "Keep an eye on availability"

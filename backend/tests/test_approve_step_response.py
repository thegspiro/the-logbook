"""
/approve-step returns a minimal result, not the full prospect record.

The endpoint authorizes a caller by the role they hold on a multi-approval
stage, not by prospective_members.view — a stage's configured approver roles
(chief, president, ...) are rarely held by anyone with view access. Returning
the full ProspectResponse handed a signer the applicant's DOB, address and
coordinator notes as a side effect of recording one sign-off (Codex review,
PR #1815).
"""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import membership_pipeline as pipeline_endpoints
from app.services.membership_pipeline_service import MembershipPipelineService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def org_and_signer(db_session: AsyncSession):
    """An organization plus a member holding a position with no
    prospective_members permission at all — only the office alias a
    multi-approval stage can ask for."""
    from app.models.user import User

    org_id = _uid()
    signer_id = _uid()
    position_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"d-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, email, "
            "password_hash, status) "
            "VALUES (:id, :org, :un, 'Fire', 'Chief', :em, 'hashed', 'active')"
        ),
        {
            "id": signer_id,
            "org": org_id,
            "un": f"chief-{org_id[:8]}",
            "em": f"chief-{org_id[:8]}@test.example",
        },
    )
    # fire_chief is the position slug the office catalog resolves to the
    # "chief" approval role — no prospective_members.* permission at all.
    await db_session.execute(
        text(
            "INSERT INTO positions "
            "(id, organization_id, name, slug, permissions) "
            "VALUES (:id, :org, 'Fire Chief', 'fire_chief', '[]')"
        ),
        {"id": position_id, "org": org_id},
    )
    await db_session.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": signer_id, "p": position_id},
    )
    await db_session.flush()

    signer = await db_session.get(User, signer_id)
    await db_session.refresh(signer, ["positions"])
    return org_id, signer


async def _client(db_session, signer):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.api.dependencies import get_current_user
    from app.core.database import get_db

    app = FastAPI()
    app.include_router(pipeline_endpoints.router, prefix="/prospective-members")
    app.dependency_overrides[get_current_user] = lambda: signer
    app.dependency_overrides[get_db] = lambda: db_session
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


class TestApproveStepResponseIsMinimal:
    async def test_response_carries_no_prospect_pii(
        self, db_session: AsyncSession, org_and_signer
    ):
        org_id, signer = org_and_signer
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(organization_id=org_id, name="P")
        step = await svc.add_step(
            pipeline.id,
            org_id,
            {
                "name": "Board vote",
                "step_type": "multi_approval",
                "config": {"required_approvers": ["chief"]},
            },
        )
        prospect = await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "Applicant",
                "last_name": "Confidential",
                "email": f"a-{_uid()[:8]}@example.com",
                "pipeline_id": pipeline.id,
                "notes": "Coordinator concern: spotty attendance at drills.",
            },
        )

        async with await _client(db_session, signer) as client:
            resp = await client.post(
                f"/prospective-members/prospects/{prospect.id}/approve-step",
                json={"step_id": step.id, "role": "chief"},
            )

        assert resp.status_code == 200
        body = resp.json()
        assert set(body.keys()) == {"prospect_id", "step_id", "step_completed"}
        assert body["prospect_id"] == prospect.id
        assert body["step_id"] == step.id
        # The one required approver signed, so the stage completed.
        assert body["step_completed"] is True

        serialized = resp.text
        assert "Confidential" not in serialized
        assert "spotty attendance" not in serialized

    async def test_partial_approval_reports_not_completed(
        self, db_session: AsyncSession, org_and_signer
    ):
        org_id, signer = org_and_signer
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(organization_id=org_id, name="P")
        step = await svc.add_step(
            pipeline.id,
            org_id,
            {
                "name": "Board vote",
                "step_type": "multi_approval",
                "config": {"required_approvers": ["chief", "president"]},
            },
        )
        prospect = await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "Applicant",
                "last_name": "Two",
                "email": f"b-{_uid()[:8]}@example.com",
                "pipeline_id": pipeline.id,
            },
        )

        async with await _client(db_session, signer) as client:
            resp = await client.post(
                f"/prospective-members/prospects/{prospect.id}/approve-step",
                json={"step_id": step.id, "role": "chief"},
            )

        assert resp.status_code == 200
        body = resp.json()
        assert set(body.keys()) == {"prospect_id", "step_id", "step_completed"}
        # President has not signed yet.
        assert body["step_completed"] is False

"""Conversion waits for every required stage, and signers can find their sign-offs.

Workflow review W16-1: with an applicant on a Required Multi-Signer Approval
stage configured as "Chief and President must both approve", the membership
coordinator converted them into a member alone — ``/transfer`` never looked at
the pipeline's stages, and nothing showed the Chief or the President that a
signature was waiting on them.

These run against MySQL: the gate reads stored progress rows and the sign-off
list joins the applicant's current stage, and neither shape is meaningful
against a mocked session.
"""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import membership_pipeline as pipeline_endpoints
from app.models.membership_pipeline import ProspectStatus
from app.services.membership_pipeline_service import MembershipPipelineService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _member(db_session, org_id, first, last, position=None):
    """A member, optionally holding one position (name, slug)."""
    from app.models.user import User

    user_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, :ln, :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"u-{user_id[:8]}",
            "fn": first,
            "ln": last,
            "em": f"u-{user_id[:8]}@test.example",
        },
    )
    if position:
        position_id = _uid()
        await db_session.execute(
            text(
                "INSERT INTO positions (id, organization_id, name, slug, permissions) "
                "VALUES (:id, :org, :name, :slug, '[]')"
            ),
            {
                "id": position_id,
                "org": org_id,
                "name": position[0],
                "slug": position[1],
            },
        )
        await db_session.execute(
            text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
            {"u": user_id, "p": position_id},
        )
    await db_session.flush()
    user = await db_session.get(User, user_id)
    await db_session.refresh(user, ["positions"])
    return user


@pytest.fixture
async def dept(db_session: AsyncSession):
    org_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone)"
            " VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"d-{org_id[:8]}"},
    )
    await db_session.flush()
    coordinator = await _member(db_session, org_id, "Coord", "Inator")
    chief = await _member(
        db_session, org_id, "Fire", "Chief", ("Fire Chief", "fire_chief")
    )
    president = await _member(
        db_session, org_id, "Board", "President", ("President", "president")
    )
    bystander = await _member(db_session, org_id, "Any", "Member")
    return org_id, coordinator, chief, president, bystander


async def _pipeline(svc, org_id, *, auto_transfer=False, extra_required_after=False):
    pipeline = await svc.create_pipeline(
        organization_id=org_id,
        name="Volunteer Applicants",
        auto_transfer_on_approval=auto_transfer,
    )
    review = await svc.add_step(
        pipeline.id,
        org_id,
        {"name": "Coordinator Approval", "step_type": "manual_approval"},
    )
    sign_off = await svc.add_step(
        pipeline.id,
        org_id,
        {
            "name": "Officer Sign-Off",
            "step_type": "multi_approval",
            "config": {"required_approvers": ["chief", "president"]},
            "is_final_step": not extra_required_after,
        },
    )
    if extra_required_after:
        await svc.add_step(pipeline.id, org_id, {"name": "Orientation"})
    return pipeline, review, sign_off


async def _applicant(svc, org_id, pipeline_id):
    return await svc.create_prospect(
        organization_id=org_id,
        data={
            "first_name": "Pat",
            "last_name": f"Applicant{_uid()[:4]}",
            "email": f"a-{_uid()[:8]}@example.com",
            "pipeline_id": pipeline_id,
        },
    )


class TestConversionWaitsForRequiredStages:
    async def test_refuses_while_the_sign_off_stage_is_unsigned(
        self, db_session: AsyncSession, dept
    ):
        org_id, coordinator, *_ = dept
        svc = MembershipPipelineService(db_session)
        pipeline, _, _ = await _pipeline(svc, org_id)
        prospect = await _applicant(svc, org_id, pipeline.id)
        await svc.advance_prospect(prospect.id, org_id, coordinator.id)

        result = await svc.transfer_to_membership(prospect.id, org_id, coordinator.id)

        assert result["success"] is False
        assert "'Officer Sign-Off' is not complete" in result["message"]
        assert "chief" in result["message"]
        assert "president" in result["message"]
        after = await svc.get_prospect(prospect.id, org_id)
        assert after.status == ProspectStatus.ACTIVE
        assert after.transferred_user_id is None

    async def test_refuses_with_one_of_two_signatures(
        self, db_session: AsyncSession, dept
    ):
        org_id, coordinator, chief, _, _ = dept
        svc = MembershipPipelineService(db_session)
        pipeline, _, sign_off = await _pipeline(svc, org_id)
        prospect = await _applicant(svc, org_id, pipeline.id)
        await svc.advance_prospect(prospect.id, org_id, coordinator.id)
        await svc.record_step_approval(
            prospect.id, org_id, sign_off.id, chief.id, "chief"
        )

        result = await svc.transfer_to_membership(prospect.id, org_id, coordinator.id)

        assert result["success"] is False
        assert "Approval still needed from: president" in result["message"]

    async def test_converts_once_every_signer_has_signed(
        self, db_session: AsyncSession, dept
    ):
        org_id, coordinator, chief, president, _ = dept
        svc = MembershipPipelineService(db_session)
        pipeline, _, sign_off = await _pipeline(svc, org_id)
        prospect = await _applicant(svc, org_id, pipeline.id)
        await svc.advance_prospect(prospect.id, org_id, coordinator.id)
        await svc.record_step_approval(
            prospect.id, org_id, sign_off.id, chief.id, "chief"
        )
        await svc.record_step_approval(
            prospect.id, org_id, sign_off.id, president.id, "president"
        )

        result = await svc.transfer_to_membership(prospect.id, org_id, coordinator.id)

        assert result["success"] is True

    async def test_refuses_from_an_earlier_stage_while_later_ones_are_required(
        self, db_session: AsyncSession, dept
    ):
        """Convert is offered from any stage server-side; a required stage
        still ahead of the applicant is just as unfinished."""
        org_id, coordinator, *_ = dept
        svc = MembershipPipelineService(db_session)
        pipeline, _, _ = await _pipeline(svc, org_id)
        prospect = await _applicant(svc, org_id, pipeline.id)

        result = await svc.transfer_to_membership(prospect.id, org_id, coordinator.id)

        assert result["success"] is False
        assert "'Officer Sign-Off'" in result["message"]

    async def test_an_optional_stage_does_not_hold_conversion(
        self, db_session: AsyncSession, dept
    ):
        org_id, coordinator, *_ = dept
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(organization_id=org_id, name="Short")
        await svc.add_step(
            pipeline.id,
            org_id,
            {"name": "Coordinator Approval", "step_type": "manual_approval"},
        )
        await svc.add_step(pipeline.id, org_id, {"name": "Welcome", "required": False})
        prospect = await _applicant(svc, org_id, pipeline.id)

        # Converting from the first stage finishes it; the stage after it is
        # optional, so nothing else stands in the way.
        result = await svc.transfer_to_membership(prospect.id, org_id, coordinator.id)

        assert result["success"] is True

    async def test_auto_conversion_refuses_an_unfinished_earlier_stage(
        self, db_session: AsyncSession, dept
    ):
        """assign_stage can put a stageless applicant on any stage, so the
        final stage being signed is not proof the ones before it were done."""
        org_id, coordinator, chief, president, _ = dept
        svc = MembershipPipelineService(db_session)
        pipeline, _, sign_off = await _pipeline(svc, org_id, auto_transfer=True)
        prospect = await _applicant(svc, org_id, pipeline.id)
        prospect.current_step_id = sign_off.id
        await db_session.flush()

        await svc.record_step_approval(
            prospect.id, org_id, sign_off.id, chief.id, "chief"
        )
        with pytest.raises(ValueError, match="'Coordinator Approval'"):
            await svc.record_step_approval(
                prospect.id, org_id, sign_off.id, president.id, "president"
            )

        after = await svc.get_prospect(prospect.id, org_id)
        assert after.transferred_user_id is None


class TestPendingSignOffs:
    async def test_lists_the_stage_for_each_signer_until_they_sign(
        self, db_session: AsyncSession, dept
    ):
        org_id, coordinator, chief, president, bystander = dept
        svc = MembershipPipelineService(db_session)
        pipeline, _, sign_off = await _pipeline(svc, org_id)
        prospect = await _applicant(svc, org_id, pipeline.id)
        await svc.advance_prospect(prospect.id, org_id, coordinator.id)

        chiefs = await svc.list_pending_sign_offs(org_id, chief.id)
        assert [p["prospect_id"] for p in chiefs] == [prospect.id]
        assert chiefs[0]["step_name"] == "Officer Sign-Off"
        assert chiefs[0]["roles_to_sign"] == [{"role": "chief", "label": "Chief"}]
        assert await svc.list_pending_sign_offs(org_id, bystander.id) == []
        assert await svc.list_pending_sign_offs(org_id, coordinator.id) == []

        await svc.record_step_approval(
            prospect.id, org_id, sign_off.id, chief.id, "chief"
        )

        assert await svc.list_pending_sign_offs(org_id, chief.id) == []
        presidents = await svc.list_pending_sign_offs(org_id, president.id)
        assert presidents[0]["required_roles"] == [
            {"role": "chief", "label": "Chief", "signed": True},
            {"role": "president", "label": "President", "signed": False},
        ]

    async def test_endpoint_returns_names_and_stages_only(
        self, db_session: AsyncSession, dept
    ):
        from fastapi import FastAPI
        from httpx import ASGITransport, AsyncClient

        from app.api.dependencies import get_current_user
        from app.core.database import get_db

        org_id, coordinator, chief, _, _ = dept
        svc = MembershipPipelineService(db_session)
        pipeline, _, _ = await _pipeline(svc, org_id)
        prospect = await _applicant(svc, org_id, pipeline.id)
        await svc.advance_prospect(prospect.id, org_id, coordinator.id)

        app = FastAPI()
        app.include_router(pipeline_endpoints.router, prefix="/prospective-members")
        app.dependency_overrides[get_current_user] = lambda: chief
        app.dependency_overrides[get_db] = lambda: db_session
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get("/prospective-members/my-sign-offs")

        assert resp.status_code == 200
        (entry,) = resp.json()
        assert entry["prospect_id"] == prospect.id
        assert "email" not in entry
        assert prospect.email not in resp.text


class TestMySignOffsHidesTheCallersOwnApplication:
    """MP-32: /my-sign-offs carries no {prospect_id} path parameter, so the
    router-level block_self_prospect_access guard (keyed on that parameter)
    never runs for it -- the same reason /interviews/{interview_id} needed
    its own dedicated guard. An officer who also has an active application
    of their own, naming a role they hold as a required signer, must not
    see their own name and stage in this list; every other list/aggregate
    route in this file filters the caller's own record via
    get_hidden_prospect_ids for exactly this reason.
    """

    async def test_service_layer_is_unfiltered_endpoint_hides_the_match(
        self, db_session: AsyncSession, dept
    ):
        from fastapi import FastAPI
        from httpx import ASGITransport, AsyncClient

        from app.api.dependencies import get_current_user
        from app.core.database import get_db

        org_id, coordinator, chief, _, _ = dept
        svc = MembershipPipelineService(db_session)
        pipeline, _, _ = await _pipeline(svc, org_id)
        # The applicant's email matches the chief's own -- the self-prospect
        # predicate's email clause -- so this record describes the chief.
        prospect = await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": chief.first_name,
                "last_name": chief.last_name,
                "email": chief.email,
                "pipeline_id": pipeline.id,
            },
        )
        await svc.advance_prospect(prospect.id, org_id, coordinator.id)

        # The service itself is the shared, unfiltered read every caller
        # builds on (the applicant drawer's own lookups rely on this not
        # silently dropping rows) -- filtering is the endpoint's job, same
        # as list_prospects/list_source_events/etc.
        unfiltered = await svc.list_pending_sign_offs(org_id, chief.id)
        assert [p["prospect_id"] for p in unfiltered] == [prospect.id]

        app = FastAPI()
        app.include_router(pipeline_endpoints.router, prefix="/prospective-members")
        app.dependency_overrides[get_current_user] = lambda: chief
        app.dependency_overrides[get_db] = lambda: db_session
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get("/prospective-members/my-sign-offs")

        assert resp.status_code == 200
        assert resp.json() == []

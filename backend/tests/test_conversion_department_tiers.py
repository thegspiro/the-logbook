"""
The applicant conversion accepts the department's own membership tiers
(owner decision 2026-11-01, "Offer department tiers").

The Convert dialog offered only Probationary and Regular, and the request
schema refused anything else, so a department that admits new members onto a
tier of its own (``senior``, ``cadet``) had to convert and then move every one
from the edit page. A chosen starting status is now either one of those two
built-in starting statuses or a tier on the organization's own ladder,
checked against that organization's settings -- an id from another
department, or one nobody configured, is refused.
"""

import json
import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.schemas.membership_pipeline import TransferProspectRequest
from app.services.membership_pipeline_service import MembershipPipelineService

LADDER = {
    "membership_tiers": {
        "tiers": [
            {"id": "probationary", "name": "Probationary", "sort_order": 0},
            {"id": "active", "name": "Active Member", "sort_order": 1},
            {"id": "cadet", "name": "Cadet", "sort_order": 2},
        ]
    }
}


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.mark.unit
class TestTheRequest:
    def test_a_department_tier_id_is_accepted_by_the_schema(self):
        request = TransferProspectRequest(
            member_class="operational", member_status="cadet"
        )
        assert request.member_status == "cadet"

    def test_class_and_status_are_still_sent_together(self):
        with pytest.raises(ValueError, match="together"):
            TransferProspectRequest(member_status="cadet")


async def _org(db: AsyncSession, settings=None) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone, settings) "
            "VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC', :settings)"
        ),
        {
            "id": org_id,
            "slug": f"ct-{org_id[:8]}",
            "settings": json.dumps(settings) if settings is not None else None,
        },
    )
    await db.flush()
    return org_id


async def _transfer(db: AsyncSession, org_id: str, **choice):
    svc = MembershipPipelineService(db)
    pipeline = await svc.create_pipeline(organization_id=org_id, name="P")
    prospect = await svc.create_prospect(
        organization_id=org_id,
        data={
            "first_name": "Casey",
            "last_name": f"Reyes{_uid()[:4]}",
            "email": f"c-{_uid()[:8]}@example.com",
            "pipeline_id": str(pipeline.id),
        },
    )
    loaded = await svc.get_prospect(str(prospect.id), org_id)
    return await svc._do_transfer(loaded, None, **choice)


async def _user(db: AsyncSession, user_id: str) -> User:
    return (
        await db.execute(
            select(User)
            .where(User.id == user_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


@pytest.mark.integration
class TestConversionOntoATier:
    async def test_an_applicant_starts_on_the_departments_own_tier(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session, LADDER)
        result = await _transfer(
            db_session, org_id, member_class="operational", member_status="cadet"
        )

        assert result["success"] is True, result
        user = await _user(db_session, result["user_id"])
        assert (user.member_class, user.member_status) == ("operational", "cadet")

    async def test_a_tier_the_department_does_not_have_is_refused(
        self, db_session: AsyncSession
    ):
        await _org(db_session, LADDER)  # cadet exists, but in another department
        org_id = await _org(db_session, {"membership_tiers": {"tiers": []}})
        result = await _transfer(
            db_session, org_id, member_class="operational", member_status="cadet"
        )

        assert result["success"] is False
        assert "cadet" in result["message"]

    async def test_a_built_in_starting_status_needs_no_ladder(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        result = await _transfer(
            db_session, org_id, member_class="administrative", member_status="regular"
        )

        assert result["success"] is True, result
        user = await _user(db_session, result["user_id"])
        assert user.member_status == "regular"

    async def test_the_tier_spelled_as_the_ladder_spells_it_is_stored_canonically(
        self, db_session: AsyncSession
    ):
        # The shipped ladder calls its regular rung "active"; the dialog sends
        # the tier id it lists.
        org_id = await _org(db_session, LADDER)
        result = await _transfer(
            db_session, org_id, member_class="operational", member_status="active"
        )

        assert result["success"] is True, result
        user = await _user(db_session, result["user_id"])
        assert user.member_status == "regular"

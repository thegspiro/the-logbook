"""
``GET /users/membership-tiers/names``: the department's tier names for every
member (owner decision 2026-11-01, "Expose names read-only").

The full config needs ``members.manage``, so a member without it saw the
built-in "Regular member" / "Life member" and no custom tier at all. This
route returns ids and names only -- no advancement years, no benefits, no
member counts -- to any signed-in member, from their own organization.
"""

import inspect
import json
import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import text

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import member_status

SETTINGS = {
    "membership_tiers": {
        "auto_advance": True,
        "tiers": [
            {
                "id": "senior",
                "name": "Senior Member",
                "sort_order": 2,
                "years_required": 20,
                "benefits": {"voting_eligible": False},
            },
            {"id": "active", "name": "Active Member", "sort_order": 1},
            {"id": "probationary", "name": "Probationary", "sort_order": 0},
        ],
    }
}


@pytest.mark.unit
class TestRouteContract:
    def test_any_signed_in_member_may_read_it(self):
        param = inspect.signature(member_status.get_membership_tier_names).parameters[
            "current_user"
        ]
        assert param.default.dependency is get_current_user

    def test_it_is_registered_beside_the_config_route(self):
        # Same router, so it is served under /users like the config route.
        paths = {getattr(r, "path", None) for r in member_status.router.routes}
        assert "/membership-tiers/names" in paths
        assert "/membership-tiers/config" in paths


async def _org(db, settings):
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone, settings) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC', :settings)"
        ),
        {
            "id": org_id,
            "name": f"Tier Names FD {org_id[:8]}",
            "slug": f"tn-{org_id[:8]}",
            "settings": json.dumps(settings),
        },
    )
    await db.flush()
    return org_id


@pytest.mark.integration
class TestAgainstTheDatabase:
    async def test_names_only_in_ladder_order_from_the_callers_org(self, db_session):
        mine = await _org(db_session, SETTINGS)
        other = await _org(
            db_session,
            {"membership_tiers": {"tiers": [{"id": "x", "name": "Other FD tier"}]}},
        )
        assert other != mine
        member = SimpleNamespace(organization_id=mine)

        body = await member_status.get_membership_tier_names(
            db=db_session, current_user=member
        )

        assert body.model_dump() == {
            "tiers": [
                {"id": "probationary", "name": "Probationary"},
                {"id": "active", "name": "Active Member"},
                {"id": "senior", "name": "Senior Member"},
            ]
        }

    async def test_an_org_with_no_saved_ladder_gets_the_shipped_names(self, db_session):
        org_id = await _org(db_session, {})
        body = await member_status.get_membership_tier_names(
            db=db_session, current_user=SimpleNamespace(organization_id=org_id)
        )
        names = [t.name for t in body.tiers]
        assert names[0] == "Probationary"
        assert "Senior Member" in names

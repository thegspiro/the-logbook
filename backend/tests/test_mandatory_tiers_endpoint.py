"""``POST /training/sessions/mandatory-tiers`` against real rows.

The ids are client-supplied, so every one must name a session-attendance
requirement in the caller's organization (pitfall #14), and the tiers come
from the same ladder the event forms' "Mandatory for" chips offer.
"""

import json
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text

from app.api.v1.endpoints import training_sessions
from app.api.v1.endpoints.training_sessions import router
from app.models.training import (
    RequirementFrequency,
    RequirementSource,
    RequirementType,
    TrainingRequirement,
)
from app.models.user import User
from app.schemas.training_session import MandatoryTiersRequest

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _org(db, settings=None) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, "
            "timezone, settings) "
            "VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC', :settings)"
        ),
        {
            "id": org_id,
            "slug": f"o-{org_id[:8]}",
            "settings": json.dumps(settings or {}),
        },
    )
    return org_id


async def _user(db, org_id: str) -> User:
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Officer', 'Test', :em, 'x', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"o-{user_id[:8]}",
            "em": f"{user_id[:8]}@t.test",
        },
    )
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one()


async def _requirement(db, org_id, requirement_type, **scope) -> str:
    # applies_to_all defaults to true on the model; a scoped requirement
    # turns it off, as the requirement form does.
    scope.setdefault("applies_to_all", False)
    requirement = TrainingRequirement(
        id=_uid(),
        organization_id=org_id,
        name=f"Req {uuid.uuid4().hex[:6]}",
        requirement_type=requirement_type,
        source=RequirementSource.DEPARTMENT,
        frequency=RequirementFrequency.ANNUAL,
        required_attendance_pct=60,
        required_hours=10,
        **scope,
    )
    db.add(requirement)
    await db.flush()
    return str(requirement.id)


async def _ask(db, user, ids):
    return await training_sessions.get_mandatory_tiers(
        body=MandatoryTiersRequest(requirement_ids=ids), db=db, current_user=user
    )


class TestTheEndpoint:
    async def test_tiers_come_from_the_default_ladder(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        drills = await _requirement(
            db_session,
            org,
            RequirementType.SESSION_ATTENDANCE,
            required_membership_types=["active", "administrative"],
        )

        response = await _ask(db_session, user, [drills])

        assert response.everyone is False
        assert response.tier_ids == ["active"]
        assert [u.requirement_id for u in response.unmapped] == [drills]

    async def test_tiers_come_from_the_department_s_own_ladder(self, db_session):
        org = await _org(
            db_session,
            {
                "membership_tiers": {
                    "tiers": [
                        {"id": "junior", "name": "Junior", "sort_order": 0},
                        {"id": "probationary", "name": "Probie", "sort_order": 1},
                        {"id": "regular", "name": "Member", "sort_order": 2},
                    ]
                }
            },
        )
        user = await _user(db_session, org)
        drills = await _requirement(
            db_session,
            org,
            RequirementType.SESSION_ATTENDANCE,
            required_membership_types=["probationary", "active"],
        )

        response = await _ask(db_session, user, [drills])

        assert response.tier_ids == ["junior", "probationary", "regular"]

    async def test_applies_to_all_is_everyone(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        drills = await _requirement(
            db_session, org, RequirementType.SESSION_ATTENDANCE, applies_to_all=True
        )

        response = await _ask(db_session, user, [drills])

        assert (response.everyone, response.tier_ids) == (True, [])

    async def test_no_requirements_is_nobody(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)

        response = await _ask(db_session, user, [])

        assert (response.everyone, response.tier_ids, response.unmapped) == (
            False,
            [],
            [],
        )

    async def test_another_kind_of_requirement_is_refused(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        hours = await _requirement(db_session, org, RequirementType.HOURS)

        with pytest.raises(HTTPException) as refused:
            await _ask(db_session, user, [hours])

        assert refused.value.status_code == 400
        assert refused.value.detail == "Invalid attendance requirement"

    async def test_another_department_s_requirement_is_refused(self, db_session):
        org = await _org(db_session)
        other = await _org(db_session)
        user = await _user(db_session, org)
        theirs = await _requirement(
            db_session,
            other,
            RequirementType.SESSION_ATTENDANCE,
            required_membership_types=["active"],
        )

        with pytest.raises(HTTPException) as refused:
            await _ask(db_session, user, [theirs])

        assert refused.value.detail == "Invalid attendance requirement"


def test_the_route_admits_event_and_training_managers():
    for route in router.routes:
        if route.path == "/mandatory-tiers" and "POST" in route.methods:
            for dependency in route.dependant.dependencies:
                permissions = getattr(dependency.call, "required_permissions", None)
                if permissions is not None:
                    assert set(permissions) == {"events.manage", "training.manage"}
                    return
    pytest.fail("No permission dependency on POST /mandatory-tiers")

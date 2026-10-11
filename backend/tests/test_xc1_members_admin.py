"""
XC-1 sweep, members/admin group: client-supplied foreign keys must be in-org.

The only unvalidated path the sweep found in this group was
``DepartureClearanceService.initiate_clearance``: ``POST
/inventory/clearances`` passes the body's ``user_id`` straight through, so a
foreign member id opened a clearance in the caller's org naming another
department's member. Every other create/update path in the group already
validated its client-supplied ids (see the sweep report).
"""

import uuid

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.inventory import DepartureClearance
from app.services.departure_clearance_service import DepartureClearanceService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _insert_org(db: AsyncSession) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, :otype, :slug, :tz)"
        ),
        {
            "id": org_id,
            "name": f"Dept {org_id[:8]}",
            "otype": "fire_department",
            "slug": f"xc1-{org_id[:8]}",
            "tz": "UTC",
        },
    )
    return org_id


async def _insert_user(db: AsyncSession, org_id: str) -> str:
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Test', 'Member', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"u{user_id[:8]}",
            "em": f"u{user_id[:8]}@test.com",
        },
    )
    return user_id


@pytest.fixture
async def two_orgs(db_session: AsyncSession):
    """Org A with an officer and a member; org B with one member."""
    org_a = await _insert_org(db_session)
    org_b = await _insert_org(db_session)
    officer_a = await _insert_user(db_session, org_a)
    member_a = await _insert_user(db_session, org_a)
    member_b = await _insert_user(db_session, org_b)
    # Committed (a savepoint release under the db_session fixture) because
    # initiate_clearance rolls the session back on failure, which would
    # otherwise take these rows with it.
    await db_session.commit()
    return {
        "org_a": org_a,
        "org_b": org_b,
        "officer_a": officer_a,
        "member_a": member_a,
        "member_b": member_b,
    }


async def _clearance_count(db: AsyncSession, user_id: str) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(DepartureClearance)
        .where(DepartureClearance.user_id == user_id)
    )
    return int(result.scalar_one())


class TestInitiateClearanceMemberScoping:
    async def test_foreign_member_is_refused_and_nothing_written(
        self, db_session, two_orgs
    ):
        svc = DepartureClearanceService(db_session)

        clearance, error = await svc.initiate_clearance(
            user_id=two_orgs["member_b"],
            organization_id=two_orgs["org_a"],
            initiated_by=two_orgs["officer_a"],
        )

        assert clearance is None
        assert error == "Invalid member"
        assert await _clearance_count(db_session, two_orgs["member_b"]) == 0

    async def test_unknown_member_is_refused(self, db_session, two_orgs):
        svc = DepartureClearanceService(db_session)
        missing = _uid()

        clearance, error = await svc.initiate_clearance(
            user_id=missing,
            organization_id=two_orgs["org_a"],
            initiated_by=two_orgs["officer_a"],
        )

        assert clearance is None
        assert error == "Invalid member"
        assert await _clearance_count(db_session, missing) == 0

    async def test_in_org_member_still_succeeds(self, db_session, two_orgs):
        svc = DepartureClearanceService(db_session)

        clearance, error = await svc.initiate_clearance(
            user_id=two_orgs["member_a"],
            organization_id=two_orgs["org_a"],
            initiated_by=two_orgs["officer_a"],
        )

        assert error is None
        assert clearance is not None
        assert str(clearance.user_id) == two_orgs["member_a"]
        assert str(clearance.organization_id) == two_orgs["org_a"]
        assert await _clearance_count(db_session, two_orgs["member_a"]) == 1

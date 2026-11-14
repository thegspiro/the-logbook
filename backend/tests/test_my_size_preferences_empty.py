"""Size preferences for a member who has none saved: 200 with ``null``, not 404.

My Sizes, and the quartermaster's view of a member's sizes, ask on every
opening. For a member who had never saved sizes both endpoints answered 404
("Size preferences not set" / "... not found for this member"). The dialog
read that as an empty form, but the browser logged a failed request on an
ordinary first visit (workflow review W31-4). Having no sizes saved is a normal
state, so both now answer 200 with a ``null`` body.

The officer endpoint's self-or-quartermaster gate still runs first, so a member
reading a colleague's sizes is still refused. A member in another department,
or one that does not exist, answers ``null`` as well, the same answer it gave
as a 404 before, so nothing about them is revealed.
"""

import uuid
from uuid import UUID

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import inventory as inventory_endpoint
from app.core.database import get_db
from app.models.user import Organization
from app.services.inventory_service import InventoryService
from tests.test_finance_budget_owners import _position, _user

pytestmark = pytest.mark.integration


def _client(db: AsyncSession, user) -> AsyncClient:
    app = FastAPI()
    app.include_router(inventory_endpoint.router, prefix="/inventory")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _org(db: AsyncSession, name: str) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name=name,
        slug=f"sizes-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db.add(org)
    await db.flush()
    return org


async def _save_sizes(db: AsyncSession, user, **sizes) -> None:
    _, error = await InventoryService(db).upsert_member_size_preferences(
        user_id=UUID(user.id),
        organization_id=user.organization_id,
        data=sizes,
    )
    assert error is None
    await db.flush()


@pytest.fixture
async def dept(db_session: AsyncSession):
    org = await _org(db_session, "Sizes VFD")
    qm_position = await _position(
        db_session, org.id, "Quartermaster", ["inventory.view", "inventory.manage"]
    )
    return {
        "db": db_session,
        "member": await _user(db_session, org.id, "member", []),
        "colleague": await _user(db_session, org.id, "colleague", []),
        "quartermaster": await _user(db_session, org.id, "qm", [qm_position]),
    }


class TestMySizes:
    async def test_no_sizes_saved_is_a_200_with_no_record(self, dept):
        async with _client(dept["db"], dept["member"]) as client:
            response = await client.get("/inventory/my/size-preferences")

        assert response.status_code == 200
        assert response.json() is None

    async def test_saved_sizes_are_still_returned(self, dept):
        member = dept["member"]
        await _save_sizes(dept["db"], member, shirt_size="L", boot_size="10.5")

        async with _client(dept["db"], member) as client:
            response = await client.get("/inventory/my/size-preferences")

        assert response.status_code == 200
        body = response.json()
        assert body["user_id"] == member.id
        assert body["shirt_size"] == "L"
        assert body["boot_size"] == "10.5"


class TestAMembersSizesReadByTheQuartermaster:
    async def test_no_sizes_saved_is_a_200_with_no_record(self, dept):
        async with _client(dept["db"], dept["quartermaster"]) as client:
            response = await client.get(
                f"/inventory/members/{dept['member'].id}/size-preferences"
            )

        assert response.status_code == 200
        assert response.json() is None

    async def test_saved_sizes_are_still_returned(self, dept):
        member = dept["member"]
        await _save_sizes(dept["db"], member, pant_waist="34")

        async with _client(dept["db"], dept["quartermaster"]) as client:
            response = await client.get(
                f"/inventory/members/{member.id}/size-preferences"
            )

        assert response.status_code == 200
        assert response.json()["pant_waist"] == "34"

    async def test_a_member_reading_their_own_through_it_gets_null_too(self, dept):
        member = dept["member"]
        async with _client(dept["db"], member) as client:
            response = await client.get(
                f"/inventory/members/{member.id}/size-preferences"
            )

        assert (response.status_code, response.json()) == (200, None)

    async def test_a_colleague_is_still_refused(self, dept):
        """The gate runs before the lookup: refused, with or without sizes."""
        async with _client(dept["db"], dept["colleague"]) as client:
            response = await client.get(
                f"/inventory/members/{dept['member'].id}/size-preferences"
            )

        assert response.status_code == 403

    async def test_another_departments_member_reveals_nothing(self, dept):
        db = dept["db"]
        other = await _org(db, "Other VFD")
        theirs = await _user(db, other.id, "theirs", [])
        await _save_sizes(db, theirs, shirt_size="XL")

        async with _client(db, dept["quartermaster"]) as client:
            foreign = await client.get(
                f"/inventory/members/{theirs.id}/size-preferences"
            )
            missing = await client.get(
                f"/inventory/members/{uuid.uuid4()}/size-preferences"
            )

        # The same answer as a member of their own with no sizes saved.
        assert (foreign.status_code, foreign.json()) == (200, None)
        assert (missing.status_code, missing.json()) == (200, None)

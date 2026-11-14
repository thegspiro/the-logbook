"""``GET /inventory/my/size-preferences`` for a member with no sizes saved.

My Sizes asks on every opening, and for a member who had never saved sizes the
endpoint answered 404 "Size preferences not set". The dialog read that as an
empty form, but the browser logged a failed request on a normal first visit
(workflow review W31-4). Having no sizes saved is a normal state, so it is now
a 200 with a ``null`` body.

Only the member's own endpoint changes. The officer-facing
``/members/{user_id}/size-preferences`` keeps its 404, and the dialog keeps
handling that.
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
from tests.test_finance_budget_owners import _user

pytestmark = pytest.mark.integration


def _client(db: AsyncSession, user) -> AsyncClient:
    app = FastAPI()
    app.include_router(inventory_endpoint.router, prefix="/inventory")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture
async def member(db_session: AsyncSession):
    org = Organization(
        id=str(uuid.uuid4()),
        name="My Sizes VFD",
        slug=f"my-sizes-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    return await _user(db_session, org.id, "member", [])


async def test_no_sizes_saved_is_a_200_with_no_record(db_session, member):
    async with _client(db_session, member) as client:
        response = await client.get("/inventory/my/size-preferences")

    assert response.status_code == 200
    assert response.json() is None


async def test_saved_sizes_are_still_returned(db_session, member):
    prefs, error = await InventoryService(db_session).upsert_member_size_preferences(
        user_id=UUID(member.id),
        organization_id=member.organization_id,
        data={"shirt_size": "L", "boot_size": "10.5"},
    )
    assert error is None
    await db_session.flush()

    async with _client(db_session, member) as client:
        response = await client.get("/inventory/my/size-preferences")

    assert response.status_code == 200
    body = response.json()
    assert body["user_id"] == member.id
    assert body["shirt_size"] == "L"
    assert body["boot_size"] == "10.5"


async def test_another_members_sizes_keep_their_404(db_session, member):
    """The officer-facing read is unchanged: no row on file is still a 404."""
    async with _client(db_session, member) as client:
        response = await client.get(f"/inventory/members/{member.id}/size-preferences")

    assert response.status_code == 404

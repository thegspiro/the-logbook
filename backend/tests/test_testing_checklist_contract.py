"""The JSON the testing home is typed against.

The response schema uses ``alias_generator=to_camel`` and the request accepts
either casing, which means the wire shape is decided by configuration rather
than by anything the frontend types can see. A rename or a dropped
``populate_by_name`` would not fail a Python test — it would 422 the save
button and show an empty run, on a screen whose whole job is telling a tester
what is broken. So the contract is pinned at the HTTP layer.
"""

import uuid

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.dependencies import get_current_active_user
from app.api.v1.endpoints import testing_checklist
from app.core.database import get_db
from app.models.user import Organization, User

pytestmark = pytest.mark.integration


async def _member(db, first="Fire", last="Fighter"):
    org = Organization(name="Contract FD", slug=f"contract-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    suffix = uuid.uuid4().hex[:8]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"tester-{suffix}",
        email=f"tester-{suffix}@example.org",
        first_name=first,
        last_name=last,
    )
    db.add(user)
    await db.flush()
    # Re-read with positions loaded, as the authentication dependency does:
    # the permission check walks that relationship, and a lazy load inside an
    # async request raises MissingGreenlet rather than merely costing a query.
    result = await db.execute(
        select(User).where(User.id == user.id).options(selectinload(User.positions))
    )
    return result.scalar_one()


def _client(db, user):
    app = FastAPI()
    app.include_router(testing_checklist.router, prefix="/testing-checklist")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: user
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


class TestTestingChecklistContract:
    async def test_saves_and_returns_camelCase(self, db_session):
        user = await _member(db_session)

        async with _client(db_session, user) as client:
            saved = await client.put(
                "/testing-checklist/entries",
                json={
                    "routePath": "/events/:id",
                    "status": "fail",
                    "note": "roster column empty",
                    "params": {"id": "evt-7"},
                },
            )

        assert saved.status_code == 200, saved.text
        body = saved.json()
        assert body["routePath"] == "/events/:id"
        assert body["status"] == "fail"
        assert body["params"] == {"id": "evt-7"}
        assert body["isMine"] is True
        assert body["checkedAt"]
        assert body["userName"] == "Fire Fighter"

    async def test_reads_the_run_back(self, db_session):
        user = await _member(db_session)

        async with _client(db_session, user) as client:
            await client.put(
                "/testing-checklist/entries",
                json={"routePath": "/dashboard", "status": "pass"},
            )
            run = await client.get("/testing-checklist")

        assert run.status_code == 200, run.text
        body = run.json()
        assert body["includesAllTesters"] is False
        assert body["testerCount"] == 1
        assert [entry["routePath"] for entry in body["entries"]] == ["/dashboard"]

    async def test_rejects_something_that_is_not_a_route(self, db_session):
        user = await _member(db_session)

        async with _client(db_session, user) as client:
            response = await client.put(
                "/testing-checklist/entries",
                json={"routePath": "https://evil.example/x", "status": "pass"},
            )

        assert response.status_code == 422

    async def test_refuses_the_shared_run_without_the_grant(self, db_session):
        user = await _member(db_session)

        async with _client(db_session, user) as client:
            response = await client.get(
                "/testing-checklist", params={"include_all_testers": "true"}
            )

        assert response.status_code == 403

    async def test_clearing_is_scoped_to_the_caller_by_default(self, db_session):
        user = await _member(db_session)

        async with _client(db_session, user) as client:
            await client.put(
                "/testing-checklist/entries",
                json={"routePath": "/dashboard", "status": "pass"},
            )
            cleared = await client.delete("/testing-checklist")
            run = await client.get("/testing-checklist")

        assert cleared.status_code == 200
        assert cleared.json() == {"deleted": 1}
        assert run.json()["entries"] == []

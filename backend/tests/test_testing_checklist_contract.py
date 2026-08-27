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
from app.models.user import Organization, Position, User, user_positions

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


async def _admin(db):
    """A member holding settings.manage — the grant a run start needs.

    Granted through a position rather than stubbed, because the endpoint reads
    the same union of position permissions the real dependency does.
    """
    user = await _member(db, "Ivy", "Manager")
    position = Position(
        organization_id=user.organization_id,
        name="System Owner",
        slug=f"owner-{uuid.uuid4().hex[:8]}",
        permissions=["settings.manage"],
    )
    db.add(position)
    await db.flush()
    await db.execute(
        user_positions.insert().values(user_id=user.id, position_id=position.id)
    )
    await db.flush()
    # populate_existing: the identity map already holds this user with an
    # empty, *loaded* positions collection from _member, and a plain re-select
    # would hand that stale collection straight back.
    result = await db.execute(
        select(User)
        .where(User.id == user.id)
        .options(selectinload(User.positions))
        .execution_options(populate_existing=True)
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

    async def test_reports_the_run_a_mark_landed_in(self, db_session):
        user = await _member(db_session)

        async with _client(db_session, user) as client:
            await client.put(
                "/testing-checklist/entries",
                json={
                    "routePath": "/events/admin",
                    "status": "blocked",
                    "buildId": "3f9a2c14e8b7",
                    "expectedAccess": "denied",
                },
            )
            run = await client.get("/testing-checklist")

        body = run.json()
        assert body["run"]["label"].startswith("Run of ")
        assert body["run"]["isCurrent"] is True
        assert body["run"]["sequence"] == 1
        assert [r["id"] for r in body["runs"]] == [body["run"]["id"]]
        entry = body["entries"][0]
        assert entry["buildId"] == "3f9a2c14e8b7"
        assert entry["expectedAccess"] == "denied"

    async def test_an_earlier_run_reads_back_by_id(self, db_session):
        user = await _admin(db_session)

        async with _client(db_session, user) as client:
            await client.put(
                "/testing-checklist/entries",
                json={"routePath": "/dashboard", "status": "pass"},
            )
            first = (await client.get("/testing-checklist")).json()["run"]["id"]
            started = await client.post(
                "/testing-checklist/runs", json={"label": "Second pass"}
            )
            current = await client.get("/testing-checklist")
            archived = await client.get("/testing-checklist", params={"run_id": first})

        assert started.status_code == 201, started.text
        assert started.json()["label"] == "Second pass"
        # The new run starts empty; the old one still holds its mark.
        assert current.json()["entries"] == []
        assert current.json()["run"]["sequence"] == 2
        assert [e["routePath"] for e in archived.json()["entries"]] == ["/dashboard"]
        assert archived.json()["run"]["isCurrent"] is False

    async def test_refuses_a_run_id_from_another_department(self, db_session):
        ours = await _member(db_session)
        theirs = await _member(db_session, "Other", "Department")

        async with _client(db_session, theirs) as client:
            await client.put(
                "/testing-checklist/entries",
                json={"routePath": "/dashboard", "status": "pass"},
            )
            their_run = (await client.get("/testing-checklist")).json()["run"]["id"]

        async with _client(db_session, ours) as client:
            response = await client.get(
                "/testing-checklist", params={"run_id": their_run}
            )

        assert response.status_code == 404

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

"""Client-minted skill test ids, for starting a test with no signal.

The owner chose cold-start offline support: a device creates the test locally
under its own UUID and sends the create when it reconnects. The server must
accept that id once, answer a replay with the same test, refuse the id to
anyone else without saying whose it is, and refuse a create scored against a
version of the sheet that has since changed. Separation of duties still holds.
"""

import uuid

import pytest
from sqlalchemy import insert, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints import skills_testing as endpoint
from app.models.skills_testing import SkillTemplate, SkillTest
from app.models.user import Position, User, user_positions

pytestmark = [pytest.mark.integration]

SECTIONS = [{"name": "Donning", "criteria": [{"label": "Mask seal"}]}]


def _uid() -> str:
    return str(uuid.uuid4())


async def _make_org(db: AsyncSession) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone)"
            " VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"d-{org_id[:8]}"},
    )
    return org_id


async def _make_user(db: AsyncSession, org_id: str, officer: bool = False) -> User:
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'A', 'B', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"u-{user_id[:8]}",
            "em": f"u-{user_id[:8]}@test.example",
        },
    )
    if officer:
        position = Position(
            organization_id=org_id,
            name="Training Officer",
            slug=f"to-{user_id[:8]}",
            permissions=["training.manage"],
        )
        db.add(position)
        await db.flush()
        await db.execute(
            insert(user_positions).values(user_id=user_id, position_id=position.id)
        )
    await db.flush()
    return (
        await db.execute(
            select(User).options(selectinload(User.positions)).where(User.id == user_id)
        )
    ).scalar_one()


@pytest.fixture
async def dept(db_session: AsyncSession):
    org_id = await _make_org(db_session)
    officer = await _make_user(db_session, org_id, officer=True)
    other_officer = await _make_user(db_session, org_id, officer=True)
    candidate = await _make_user(db_session, org_id)
    template = SkillTemplate(
        organization_id=org_id,
        name="SCBA Donning",
        sections=SECTIONS,
        status="published",
        version=3,
    )
    db_session.add(template)
    other_org = await _make_org(db_session)
    outsider = await _make_user(db_session, other_org, officer=True)
    await db_session.flush()
    return {
        "officer": officer,
        "other_officer": other_officer,
        "candidate": candidate,
        "template": template,
        "outsider": outsider,
    }


def _client(db_session, viewer):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.api.dependencies import get_current_user
    from app.core.database import get_db

    app = FastAPI()
    app.include_router(endpoint.router, prefix="/st")
    app.dependency_overrides[get_current_user] = lambda: viewer
    app.dependency_overrides[get_db] = lambda: db_session
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _create(dept, test_id: str, **extra) -> dict:
    return {
        "id": test_id,
        "template_id": dept["template"].id,
        "candidate_id": dept["candidate"].id,
        **extra,
    }


class TestClientMintedId:
    async def test_the_client_id_is_used_and_a_replay_returns_the_same_test(
        self, db_session, dept
    ):
        test_id = _uid()
        async with _client(db_session, dept["officer"]) as client:
            first = await client.post("/st/tests", json=_create(dept, test_id))
            replay = await client.post("/st/tests", json=_create(dept, test_id))
        assert first.status_code == 201, first.text
        assert first.json()["id"] == test_id
        assert replay.status_code == 201
        assert replay.json()["id"] == test_id
        rows = (
            (await db_session.execute(select(SkillTest).where(SkillTest.id == test_id)))
            .scalars()
            .all()
        )
        assert len(rows) == 1

    async def test_the_id_is_refused_to_anyone_else_alike(self, db_session, dept):
        test_id = _uid()
        async with _client(db_session, dept["officer"]) as client:
            await client.post("/st/tests", json=_create(dept, test_id))
            different_candidate = await client.post(
                "/st/tests",
                json={
                    **_create(dept, test_id),
                    "candidate_id": dept["other_officer"].id,
                },
            )
        async with _client(db_session, dept["other_officer"]) as client:
            colleague = await client.post("/st/tests", json=_create(dept, test_id))
        assert different_candidate.status_code == 409
        assert colleague.status_code == 409
        assert colleague.json()["detail"] == different_candidate.json()["detail"]

    async def test_another_departments_id_reads_the_same_as_any_taken_id(
        self, db_session, dept
    ):
        test_id = _uid()
        async with _client(db_session, dept["officer"]) as client:
            await client.post("/st/tests", json=_create(dept, test_id))
        outsider = dept["outsider"]
        their_template = SkillTemplate(
            organization_id=outsider.organization_id,
            name="Theirs",
            sections=SECTIONS,
            status="published",
        )
        their_candidate = await _make_user(db_session, outsider.organization_id)
        db_session.add(their_template)
        await db_session.flush()
        async with _client(db_session, outsider) as client:
            resp = await client.post(
                "/st/tests",
                json={
                    "id": test_id,
                    "template_id": their_template.id,
                    "candidate_id": their_candidate.id,
                },
            )
        assert resp.status_code == 409
        assert resp.json()["detail"] == "That test id is already in use"

    async def test_a_changed_sheet_is_refused(self, db_session, dept):
        async with _client(db_session, dept["officer"]) as client:
            stale = await client.post(
                "/st/tests", json=_create(dept, _uid(), expected_template_version=2)
            )
            current = await client.post(
                "/st/tests", json=_create(dept, _uid(), expected_template_version=3)
            )
        assert stale.status_code == 409
        assert current.status_code == 201

    async def test_separation_of_duties_still_holds(self, db_session, dept):
        async with _client(db_session, dept["officer"]) as client:
            self_exam = await client.post(
                "/st/tests",
                json={
                    "id": _uid(),
                    "template_id": dept["template"].id,
                    "candidate_id": dept["officer"].id,
                },
            )
        assert self_exam.status_code == 400

    async def test_omitting_the_id_still_works(self, db_session, dept):
        async with _client(db_session, dept["officer"]) as client:
            resp = await client.post(
                "/st/tests",
                json={
                    "template_id": dept["template"].id,
                    "candidate_id": dept["candidate"].id,
                },
            )
        assert resp.status_code == 201
        assert uuid.UUID(resp.json()["id"])

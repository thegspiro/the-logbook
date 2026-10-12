"""CRUD for skill evaluation definitions.

Nothing used to create a ``SkillEvaluation``, so a skill score on a shift report
never became a checkoff, competency history or pipeline progress. These drive
the routes through a real app against MySQL: org scoping, the name-as-join-key
rule, evaluator references, delete-vs-deactivate, and the sign-off check.
"""

import uuid

import pytest
from sqlalchemy import insert, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints import skill_evaluations as endpoint
from app.models.training import SkillCheckoff, SkillEvaluation
from app.models.user import Position, User, user_positions
from app.services.shift_completion_service import ShiftCompletionService

pytestmark = [pytest.mark.integration]


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


async def _make_user(
    db: AsyncSession,
    org_id: str,
    first: str,
    permissions: list[str] | None = None,
    slug: str | None = None,
) -> User:
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, 'X', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"u-{user_id[:8]}",
            "fn": first,
            "em": f"u-{user_id[:8]}@test.example",
        },
    )
    if permissions is not None or slug:
        position = Position(
            organization_id=org_id,
            name=slug or "Officer",
            slug=slug or f"officer-{user_id[:8]}",
            permissions=permissions or [],
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
    officer = await _make_user(db_session, org_id, "Olive", ["training.manage"])
    driver_trainer = await _make_user(
        db_session, org_id, "Dana", [], slug=f"driver-trainer-{org_id[:6]}"
    )
    member = await _make_user(db_session, org_id, "Mary")
    other_org = await _make_org(db_session)
    outsider = await _make_user(db_session, other_org, "Otto", ["training.manage"])
    foreign_skill = SkillEvaluation(organization_id=other_org, name="Ladder Raise")
    db_session.add(foreign_skill)
    await db_session.flush()
    return {
        "org_id": org_id,
        "officer": officer,
        "driver_trainer": driver_trainer,
        "trainer_slug": f"driver-trainer-{org_id[:6]}",
        "member": member,
        "outsider": outsider,
        "foreign_skill": foreign_skill,
    }


def _client(db_session, viewer):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.api.dependencies import get_current_user
    from app.core.database import get_db

    app = FastAPI()
    app.include_router(endpoint.router, prefix="/skill-evaluations")
    app.dependency_overrides[get_current_user] = lambda: viewer
    app.dependency_overrides[get_db] = lambda: db_session
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


class TestCreateAndList:
    async def test_officer_creates_and_lists_only_their_own_department(
        self, db_session, dept
    ):
        async with _client(db_session, dept["officer"]) as client:
            created = await client.post(
                "/skill-evaluations",
                json={
                    "name": "  Pump Operations ",
                    "category": "Driver",
                    "evaluation_criteria": ["Engage pump", " ", "Set pressure"],
                },
            )
            listed = await client.get("/skill-evaluations")

        assert created.status_code == 201
        body = created.json()
        assert body["name"] == "Pump Operations"
        assert body["evaluation_criteria"] == ["Engage pump", "Set pressure"]
        assert body["active"] is True
        assert body["allowed_evaluators"] is None
        assert [s["name"] for s in listed.json()] == ["Pump Operations"]

    async def test_member_cannot_create_or_list(self, db_session, dept):
        async with _client(db_session, dept["member"]) as client:
            created = await client.post("/skill-evaluations", json={"name": "Hose"})
            listed = await client.get("/skill-evaluations")
        assert created.status_code == 403
        assert listed.status_code == 403

    async def test_active_name_is_unique_ignoring_case(self, db_session, dept):
        async with _client(db_session, dept["officer"]) as client:
            first = await client.post("/skill-evaluations", json={"name": "SCBA"})
            dup = await client.post("/skill-evaluations", json={"name": "scba"})
            # Deactivating frees the name; reactivating the old one then clashes.
            await client.patch(
                f"/skill-evaluations/{first.json()['id']}", json={"active": False}
            )
            second = await client.post("/skill-evaluations", json={"name": "Scba"})
            reactivate = await client.patch(
                f"/skill-evaluations/{first.json()['id']}", json={"active": True}
            )
        assert dup.status_code == 409
        assert second.status_code == 201
        assert reactivate.status_code == 409

    async def test_another_departments_skill_is_invisible(self, db_session, dept):
        foreign = dept["foreign_skill"].id
        async with _client(db_session, dept["officer"]) as client:
            got = await client.get(f"/skill-evaluations/{foreign}")
            patched = await client.patch(
                f"/skill-evaluations/{foreign}", json={"name": "Mine now"}
            )
            deleted = await client.delete(f"/skill-evaluations/{foreign}")
        assert (got.status_code, patched.status_code, deleted.status_code) == (
            404,
            404,
            404,
        )


class TestEvaluators:
    async def test_positions_and_members_must_belong_to_the_department(
        self, db_session, dept
    ):
        async with _client(db_session, dept["officer"]) as client:
            unknown_slug = await client.post(
                "/skill-evaluations",
                json={
                    "name": "A",
                    "allowed_evaluators": {"type": "roles", "roles": ["nope"]},
                },
            )
            outsider = await client.post(
                "/skill-evaluations",
                json={
                    "name": "B",
                    "allowed_evaluators": {
                        "type": "specific_users",
                        "user_ids": [dept["outsider"].id],
                    },
                },
            )
            ok = await client.post(
                "/skill-evaluations",
                json={
                    "name": "C",
                    "allowed_evaluators": {
                        "type": "roles",
                        "roles": [dept["trainer_slug"]],
                    },
                },
            )
        assert unknown_slug.status_code == 400
        assert outsider.status_code == 400
        assert ok.status_code == 201
        assert ok.json()["allowed_evaluators"] == {
            "type": "roles",
            "roles": [dept["trainer_slug"]],
        }

    async def test_check_evaluator_follows_the_configured_rule(self, db_session, dept):
        async with _client(db_session, dept["officer"]) as client:
            default = (
                await client.post("/skill-evaluations", json={"name": "Default"})
            ).json()
            by_role = (
                await client.post(
                    "/skill-evaluations",
                    json={
                        "name": "By role",
                        "allowed_evaluators": {
                            "type": "roles",
                            "roles": [dept["trainer_slug"]],
                        },
                    },
                )
            ).json()
            named = (
                await client.post(
                    "/skill-evaluations",
                    json={
                        "name": "Named",
                        "allowed_evaluators": {
                            "type": "specific_users",
                            "user_ids": [dept["member"].id],
                        },
                    },
                )
            ).json()

        async def check(viewer, skill):
            async with _client(db_session, viewer) as client:
                resp = await client.post(
                    f"/skill-evaluations/{skill['id']}/check-evaluator"
                )
            assert resp.status_code == 200
            return resp.json()["is_authorized"]

        assert await check(dept["officer"], default) is True
        assert await check(dept["member"], default) is False
        assert await check(dept["driver_trainer"], by_role) is True
        assert await check(dept["officer"], by_role) is False
        assert await check(dept["member"], named) is True
        assert await check(dept["driver_trainer"], named) is False
        # The editor shows who is on a named list, not bare ids.
        assert named["evaluator_members"] == [
            {"id": dept["member"].id, "name": dept["member"].display_name}
        ]

    async def test_clearing_evaluators_returns_to_the_default(self, db_session, dept):
        async with _client(db_session, dept["officer"]) as client:
            skill = (
                await client.post(
                    "/skill-evaluations",
                    json={
                        "name": "X",
                        "allowed_evaluators": {
                            "type": "roles",
                            "roles": [dept["trainer_slug"]],
                        },
                    },
                )
            ).json()
            cleared = await client.patch(
                f"/skill-evaluations/{skill['id']}",
                json={"allowed_evaluators": None, "description": None},
            )
        assert cleared.status_code == 200
        assert cleared.json()["allowed_evaluators"] is None


class TestDelete:
    async def test_unused_skill_deletes_and_used_one_is_refused(self, db_session, dept):
        async with _client(db_session, dept["officer"]) as client:
            unused = (
                await client.post("/skill-evaluations", json={"name": "Unused"})
            ).json()
            used = (
                await client.post("/skill-evaluations", json={"name": "Used"})
            ).json()
        db_session.add(
            SkillCheckoff(
                organization_id=dept["org_id"],
                user_id=dept["member"].id,
                skill_evaluation_id=used["id"],
                evaluator_id=dept["officer"].id,
                status="passed",
            )
        )
        await db_session.flush()

        async with _client(db_session, dept["officer"]) as client:
            gone = await client.delete(f"/skill-evaluations/{unused['id']}")
            kept = await client.delete(f"/skill-evaluations/{used['id']}")
            listed = (await client.get("/skill-evaluations")).json()

        assert gone.status_code == 204
        assert kept.status_code == 409
        assert [(s["name"], s["checkoff_count"]) for s in listed] == [("Used", 1)]


class TestShiftReportLink:
    async def test_a_created_skill_is_what_shift_scores_resolve_to(
        self, db_session, dept
    ):
        """The point of the screen: a shift report's skill name now matches."""
        async with _client(db_session, dept["officer"]) as client:
            skill = (
                await client.post("/skill-evaluations", json={"name": "Pump Ops"})
            ).json()
        resolved = await ShiftCompletionService(db_session)._resolve_skill_evaluations(
            dept["org_id"], ["pump ops", "Unknown"]
        )
        assert resolved == {"pump ops": skill["id"]}

"""Skills tests under shift-report sign-offs.

A department runs Skills Testing or shift-report sign-offs. The screens hide
Skills Testing from a sign-offs department; these pin what the server does, so
a bookmark, an old offline queue or a direct API call cannot open a test the
department no longer runs:

  * opening a new test is refused, official or practice;
  * a create that already landed before the switch still replays its test;
  * a test already under way may still be worked;
  * a department that never chose, or chose Skills Testing, is unaffected.

Driven through the real router so the refusal is the handler's answer, with
rows read back from the database.
"""

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import insert, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints import skills_testing as endpoint
from app.models.skills_testing import SkillTemplate, SkillTest
from app.models.training import TrainingModuleConfig
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
            "VALUES (:id, :org, :un, 'Alex', 'Lee', :em, 'hashed', 'active')"
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
            slug=f"training-officer-{user_id[:8]}",
            permissions=["training.manage"],
        )
        db.add(position)
        await db.flush()
        await db.execute(
            insert(user_positions).values(user_id=user_id, position_id=position.id)
        )
    await db.flush()
    # Positions loaded eagerly: the permission check reads them, and a lazy
    # load inside the async handler would raise.
    return (
        await db.execute(
            select(User).options(selectinload(User.positions)).where(User.id == user_id)
        )
    ).scalar_one()


async def _dept(db: AsyncSession, method: str | None) -> dict:
    org_id = await _make_org(db)
    officer = await _make_user(db, org_id, officer=True)
    member = await _make_user(db, org_id)
    template = SkillTemplate(
        organization_id=org_id,
        name="SCBA Donning",
        sections=SECTIONS,
        status="published",
    )
    db.add(template)
    if method is not None:
        db.add(
            TrainingModuleConfig(organization_id=org_id, practical_skills_method=method)
        )
    await db.flush()
    return {
        "org_id": org_id,
        "officer": officer,
        "member": member,
        "template": template,
    }


def _client(db_session, viewer):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.api.dependencies import get_current_user
    from app.core.database import get_db

    app = FastAPI()
    app.include_router(endpoint.router, prefix="/skills-testing")
    app.dependency_overrides[get_current_user] = lambda: viewer
    app.dependency_overrides[get_db] = lambda: db_session
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _count_tests(db: AsyncSession, org_id: str) -> int:
    return len(
        (
            await db.execute(
                select(SkillTest.id).where(SkillTest.organization_id == org_id)
            )
        ).all()
    )


class TestOpeningATest:
    @pytest.mark.parametrize("is_practice", [False, True])
    async def test_is_refused_for_a_sign_offs_department(self, db_session, is_practice):
        dept = await _dept(db_session, "shift_signoffs")
        async with _client(db_session, dept["officer"]) as client:
            response = await client.post(
                "/skills-testing/tests",
                json={
                    "template_id": str(dept["template"].id),
                    "candidate_id": str(dept["member"].id),
                    "is_practice": is_practice,
                },
            )

        assert response.status_code == 409
        assert "sign-offs on shift reports" in response.json()["detail"]
        assert await _count_tests(db_session, dept["org_id"]) == 0

    @pytest.mark.parametrize("method", [None, "skills_testing"])
    async def test_is_allowed_for_a_skills_testing_department(self, db_session, method):
        dept = await _dept(db_session, method)
        async with _client(db_session, dept["officer"]) as client:
            response = await client.post(
                "/skills-testing/tests",
                json={
                    "template_id": str(dept["template"].id),
                    "candidate_id": str(dept["member"].id),
                },
            )

        assert response.status_code == 201
        assert await _count_tests(db_session, dept["org_id"]) == 1

    async def test_a_create_that_landed_before_the_switch_still_replays(
        self, db_session
    ):
        # An offline queue resending a create the server already accepted gets
        # its test back, not an error that would strand the scoring on a device.
        dept = await _dept(db_session, "skills_testing")
        test_id = _uid()
        body = {
            "id": test_id,
            "template_id": str(dept["template"].id),
            "candidate_id": str(dept["member"].id),
        }
        async with _client(db_session, dept["officer"]) as client:
            assert (
                await client.post("/skills-testing/tests", json=body)
            ).status_code == 201

            config = (
                await db_session.execute(
                    select(TrainingModuleConfig).where(
                        TrainingModuleConfig.organization_id == dept["org_id"]
                    )
                )
            ).scalar_one()
            config.practical_skills_method = "shift_signoffs"
            await db_session.flush()

            replay = await client.post("/skills-testing/tests", json=body)

        assert replay.status_code in (200, 201)
        assert replay.json()["id"] == test_id
        assert await _count_tests(db_session, dept["org_id"]) == 1


class TestATestAlreadyUnderWay:
    async def test_can_still_be_worked_after_the_switch(self, db_session):
        dept = await _dept(db_session, "shift_signoffs")
        now = datetime.now(timezone.utc).replace(microsecond=0)
        test = SkillTest(
            organization_id=dept["org_id"],
            template_id=dept["template"].id,
            candidate_id=dept["member"].id,
            examiner_id=dept["officer"].id,
            status="in_progress",
            result="incomplete",
            started_at=now,
            created_at=now,
        )
        db_session.add(test)
        await db_session.flush()

        async with _client(db_session, dept["officer"]) as client:
            response = await client.put(
                f"/skills-testing/tests/{test.id}",
                json={"notes": "Resumed after the department switched"},
            )

        assert response.status_code == 200, response.text
        await db_session.refresh(test)
        assert test.notes == "Resumed after the department switched"

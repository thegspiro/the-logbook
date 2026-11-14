"""The counts the evaluation pages' section strip badges: a member's own
evaluations waiting on them, and the overdue rows of the list a conductor or
manager sees on the conduct page — each scoped to the caller."""

from collections.abc import AsyncGenerator, Awaitable, Callable

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import evaluations as endpoints
from app.core.database import get_db
from app.models.user import User
from tests.test_evaluation_workflow import _org, _period, _template, _user

pytestmark = [pytest.mark.integration]

ClientFactory = Callable[[User], Awaitable[AsyncClient]]


@pytest.fixture
async def make_client(db_session: AsyncSession) -> AsyncGenerator[ClientFactory]:
    opened: list[AsyncClient] = []

    async def factory(user: User) -> AsyncClient:
        app = FastAPI()
        app.include_router(endpoints.router, prefix="/evaluations")
        app.dependency_overrides[get_current_user] = lambda: user
        app.dependency_overrides[get_db] = lambda: db_session
        client = AsyncClient(
            transport=ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://test",
        )
        opened.append(client)
        return client

    yield factory
    for client in opened:
        await client.aclose()


async def _counts(client: AsyncClient) -> dict:
    response = await client.get("/evaluations/attention")
    assert response.status_code == 200, response.text
    return response.json()


class TestAttentionCounts:
    async def test_each_caller_counts_only_what_is_theirs_to_see(
        self, db_session, make_client
    ):
        org = await _org(db_session)
        manager = await _user(
            db_session,
            org,
            ["evaluations.manage", "evaluations.conduct", "evaluations.view_all"],
        )
        evaluator = await _user(db_session, org, ["evaluations.conduct"])
        other_conductor = await _user(db_session, org, ["evaluations.conduct"])
        member = await _user(db_session, org, [])
        period = await _period(db_session, org)
        await _template(db_session, org)
        # A 2025 period: every step of an evaluation drafted for it is already
        # past due, so the one open evaluator step counts as overdue.
        drafted = await (await make_client(manager)).post(
            "/evaluations",
            json={
                "member_id": member.id,
                "period_id": period.id,
                "evaluator_id": evaluator.id,
            },
        )
        assert drafted.status_code == 201, drafted.text

        # The self-evaluation is open for the member.
        assert await _counts(await make_client(member)) == {"mine": 1, "overdue": 0}
        # The evaluator conducts it; the manager sees every evaluation.
        assert await _counts(await make_client(evaluator)) == {
            "mine": 0,
            "overdue": 1,
        }
        assert await _counts(await make_client(manager)) == {"mine": 0, "overdue": 1}
        # Another conductor sees only the evaluations they conduct.
        assert await _counts(await make_client(other_conductor)) == {
            "mine": 0,
            "overdue": 0,
        }

    async def test_another_department_s_evaluations_are_not_counted(
        self, db_session, make_client
    ):
        org, other = await _org(db_session), await _org(db_session)
        manager = await _user(
            db_session,
            other,
            ["evaluations.manage", "evaluations.conduct", "evaluations.view_all"],
        )
        member = await _user(db_session, other, [])
        period = await _period(db_session, other)
        await _template(db_session, other)
        drafted = await (await make_client(manager)).post(
            "/evaluations",
            json={"member_id": member.id, "period_id": period.id},
        )
        assert drafted.status_code == 201, drafted.text

        ours = await _user(
            db_session,
            org,
            ["evaluations.manage", "evaluations.conduct", "evaluations.view_all"],
        )
        assert await _counts(await make_client(ours)) == {"mine": 0, "overdue": 0}

"""``/analytics/track`` accepts any metadata, so ``/analytics/metrics`` must read it
defensively.

``metadata`` is a client-supplied dict. The check-in failure breakdown keys a
counter by ``metadata["error_reason"]``, so a non-string reason (a dict or list is
unhashable) or an enormous string used to raise while building the breakdown. The
bad row is stored, so every later ``/metrics`` call for the organization failed
with it, for everyone holding ``analytics.view``, until the row was removed by hand.

Driven over HTTP against the real schema, because the failure is in how a stored
row is read back, which a mocked session cannot reproduce.
"""

import uuid
from collections.abc import AsyncGenerator

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import analytics as endpoints
from app.core.database import get_db
from app.models.user import User

pytestmark = [pytest.mark.integration]


@pytest.fixture
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient]:
    org_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    position_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Analytics Bench', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"analytics-bench-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Bench', 'Officer', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"bench-{user_id[:8]}",
            "em": f"bench-{user_id[:8]}@test.example",
        },
    )
    await db_session.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, permissions) "
            "VALUES (:id, :org, 'Analyst', 'analyst', '[\"analytics.view\"]')"
        ),
        {"id": position_id, "org": org_id},
    )
    await db_session.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": user_id, "p": position_id},
    )
    user = await db_session.get(User, user_id)
    assert user is not None
    await db_session.refresh(user, ["positions"])

    app = FastAPI()
    app.include_router(endpoints.router, prefix="/analytics")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db_session
    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as http:
        yield http


async def _track_failure(client: AsyncClient, metadata: dict) -> None:
    response = await client.post(
        "/analytics/track",
        json={"event_type": "check_in_failure", "metadata": metadata},
    )
    assert response.status_code == 200, response.text


class TestMetricsSurviveAnyStoredMetadata:
    @pytest.mark.parametrize(
        "reason",
        [{"nested": "object"}, ["a", "list"], 42, True],
        ids=["dict", "list", "number", "bool"],
    )
    async def test_a_non_string_error_reason_does_not_break_the_dashboard(
        self, client: AsyncClient, reason: object
    ) -> None:
        await _track_failure(client, {"error_reason": reason})
        response = await client.get("/analytics/metrics")
        assert response.status_code == 200, response.text
        assert response.json()["failed_check_ins"] == 1

    async def test_string_reasons_are_still_counted_by_reason(
        self, client: AsyncClient
    ) -> None:
        await _track_failure(client, {"error_reason": "expired_code"})
        await _track_failure(client, {"error_reason": "expired_code"})
        await _track_failure(client, {"reason": "wrong_event"})
        await _track_failure(client, {"deviceType": "ios"})
        body = (await client.get("/analytics/metrics")).json()
        assert body["error_breakdown"] == {
            "expired_code": 2,
            "wrong_event": 1,
            "unknown": 1,
        }

    async def test_a_very_long_reason_is_cut_to_a_short_key(
        self, client: AsyncClient
    ) -> None:
        await _track_failure(client, {"error_reason": "x" * 3000})
        breakdown = (await client.get("/analytics/metrics")).json()["error_breakdown"]
        assert breakdown == {"x" * endpoints.MAX_FAILURE_REASON_CHARS: 1}


class TestTrackBoundsWhatItStores:
    async def test_small_metadata_is_stored(self, client: AsyncClient) -> None:
        response = await client.post(
            "/analytics/track",
            json={
                "event_type": "qr_scan",
                "metadata": {"deviceType": "ios", "timestamp": "2026-10-20T12:00:00Z"},
            },
        )
        assert response.status_code == 200, response.text
        exported = (await client.get("/analytics/export")).json()
        assert exported["total"] == 1
        assert exported["events"][0]["device_type"] == "ios"

    async def test_oversized_metadata_is_refused_and_not_stored(
        self, client: AsyncClient
    ) -> None:
        response = await client.post(
            "/analytics/track",
            json={
                "event_type": "qr_scan",
                "metadata": {"blob": "x" * (endpoints.MAX_EVENT_METADATA_BYTES + 1)},
            },
        )
        assert response.status_code == 422, response.text
        assert (await client.get("/analytics/export")).json()["total"] == 0

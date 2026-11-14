"""The synchronous ballot and reminder sends are gone; the queue is the one way
to send either (ELEC-48, owner decision 2026-11-01: "retire them").

``POST /elections/{id}/send-ballot`` and ``POST /elections/{id}/remind-non-voters``
ran the send inside the request and took no lock of their own, so two calls to
the same one could both pass the in-progress check and mail every member
twice. ``ballot-send-jobs`` and ``reminder-send-jobs`` lock the check and
cover both sends, and nothing in the frontend called the old routes.

Routing is decided before any dependency runs, so the app here has no database
and no signed-in user: a route that still exists answers 401 from the
overridden ``get_current_user``, and a removed one answers 404 or 405.
"""

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from app.api.dependencies import get_current_user
from app.api.v1.api import api_router
from app.core.database import get_db

pytestmark = pytest.mark.unit

ELECTION = "/api/v1/elections/00000000-0000-0000-0000-000000000001"


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(api_router, prefix="/api/v1")

    async def _no_db():
        yield None

    async def _signed_out():
        raise HTTPException(status_code=401, detail="Not authenticated")

    app.dependency_overrides[get_db] = _no_db
    app.dependency_overrides[get_current_user] = _signed_out
    return app


async def _post(path: str) -> int:
    async with AsyncClient(
        transport=ASGITransport(app=_app()), base_url="http://test"
    ) as client:
        response = await client.post(path, json={})
    return response.status_code


@pytest.mark.parametrize("retired", ["send-ballot", "remind-non-voters"])
async def test_the_synchronous_send_no_longer_exists(retired: str):
    assert await _post(f"{ELECTION}/{retired}") in (404, 405)


@pytest.mark.parametrize("queued", ["ballot-send-jobs", "reminder-send-jobs"])
async def test_the_queued_send_is_still_served(queued: str):
    assert await _post(f"{ELECTION}/{queued}") == 401

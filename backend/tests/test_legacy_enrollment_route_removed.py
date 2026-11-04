"""``POST /training/enrollments`` is gone; ``POST /training/programs/enrollments``
is the one way to enroll a member by hand (TR7-1, owner decision 2026-11-01).

The removed route was a hand-kept copy of ``TrainingProgramService.
enroll_member`` that never caught up with it: no organization lock against two
concurrent enrollments, no per-requirement progress rows, no starting phase,
recert deadline or notification. Nothing in the frontend called it.

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


async def _post(path: str, **kwargs) -> int:
    async with AsyncClient(
        transport=ASGITransport(app=_app()), base_url="http://test"
    ) as client:
        response = await client.post(path, **kwargs)
    return response.status_code


async def test_the_old_enrollment_route_no_longer_exists():
    status = await _post(
        "/api/v1/training/enrollments",
        params={
            "user_id": "00000000-0000-0000-0000-000000000001",
            "program_id": "00000000-0000-0000-0000-000000000002",
        },
    )
    assert status in (404, 405)


async def test_the_program_enrollment_route_is_still_served():
    status = await _post(
        "/api/v1/training/programs/enrollments",
        json={
            "user_id": "00000000-0000-0000-0000-000000000001",
            "program_id": "00000000-0000-0000-0000-000000000002",
        },
    )
    assert status == 401

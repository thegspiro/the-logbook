"""An unknown return-request status is a 422, not a 500.

The admin hub asked for ``status=pending`` — a value ``ReturnRequestStatus``
has never had — and the service's enum conversion raised ``ValueError``,
which the app reports as a 500. So every visit to the inventory admin hub
lost its pending-returns figure behind an "unavailable" banner. The query
parameter is now typed as the enum, so FastAPI rejects a bad value up front
and names the valid ones.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import inventory
from app.core.database import get_db
from app.models.inventory import ReturnRequestStatus

pytestmark = pytest.mark.unit

MODULE = "app.api.v1.endpoints.inventory"


async def _get(status: str):
    api = FastAPI()
    api.include_router(inventory.router, prefix="/inventory")
    api.dependency_overrides[get_db] = lambda: SimpleNamespace()
    api.dependency_overrides[get_current_user] = lambda: SimpleNamespace(
        id="u1", organization_id="org-a"
    )
    listing = AsyncMock(return_value=[])
    with patch(f"{MODULE}._has_permission", return_value=True), patch(
        f"{MODULE}._collect_user_permissions", return_value=set()
    ), patch(f"{MODULE}.InventoryService.get_return_requests", new=listing):
        transport = ASGITransport(app=api)
        async with AsyncClient(transport=transport, base_url="http://t") as client:
            response = await client.get(
                "/inventory/return-requests", params={"status": status}
            )
    return response, listing


async def test_an_unknown_status_is_rejected_as_a_validation_error():
    response, listing = await _get("pending")

    assert response.status_code == 422
    listing.assert_not_awaited()


async def test_a_real_status_is_passed_through_as_the_enum():
    response, listing = await _get("requested")

    assert response.status_code == 200
    assert listing.await_args.kwargs["status_filter"] is ReturnRequestStatus.REQUESTED

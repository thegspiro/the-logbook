"""The inventory socket enforces the module switch itself.

The router-level module gate stands aside for WebSocket handshakes (it cannot
resolve a session from one without a ``Request``), so ``inventory_websocket``
checks the flag after it has authenticated the caller. A department that has
switched Inventory off must not keep receiving inventory change events, and
the refusal must use a close code the client treats as final — 4003, which
``useInventoryWebSocket`` does not retry.
"""

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.api.v1.endpoints import inventory

pytestmark = pytest.mark.unit

ORG = "org-a"
MODULE = "app.api.v1.endpoints.inventory"
CAP_REACHED = 4999


@asynccontextmanager
async def _fake_session():
    yield SimpleNamespace()


def _connect(enabled_modules):
    """Open the socket with auth and origin stubbed; return (close code, manager)."""
    api = FastAPI()
    api.include_router(inventory.router, prefix="/inventory")
    manager = MagicMock()

    async def decline(websocket, org_id):
        # Stands in for the org's connection cap: the real connect() closes
        # the socket itself when it declines, and the handler then returns.
        await websocket.close(code=CAP_REACHED)
        return False

    manager.connect = AsyncMock(side_effect=decline)
    with patch(f"{MODULE}.is_websocket_origin_allowed", return_value=True), patch(
        "app.core.database.async_session_factory", new=_fake_session
    ), patch(
        "app.services.auth_service.AuthService.get_user_from_token",
        new=AsyncMock(return_value=SimpleNamespace(organization_id=ORG)),
    ), patch(
        f"{MODULE}.OrganizationService.get_enabled_modules",
        new=AsyncMock(return_value=SimpleNamespace(enabled_modules=enabled_modules)),
    ), patch(
        f"{MODULE}.ws_manager", new=manager
    ):
        with TestClient(api) as client:
            with client.websocket_connect("/inventory/ws?token=t") as sock:
                with pytest.raises(WebSocketDisconnect) as closed:
                    sock.receive_text()
    return closed.value.code, manager


def test_a_disabled_module_closes_the_socket_with_a_final_code():
    code, manager = _connect(["members", "events"])

    assert code == 4003
    manager.connect.assert_not_awaited()


def test_an_enabled_module_registers_the_socket():
    # Reaching the manager at all is what shows the module check passed.
    code, manager = _connect(["members", "inventory"])

    assert code == CAP_REACHED
    manager.connect.assert_awaited_once()

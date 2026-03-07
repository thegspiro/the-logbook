"""
Unit tests for WebSocket connection manager.

Covers:
  - Connection tracking and cleanup
  - Dead connection detection via cleanup_dead_connections
  - Broadcast dead connection cleanup
"""

import sys
from unittest.mock import MagicMock

# Stub out heavy transitive imports not available in the test environment
for _mod_name in ("redis", "redis.asyncio"):
    if _mod_name not in sys.modules:
        sys.modules[_mod_name] = MagicMock()

import pytest
from unittest.mock import AsyncMock

from app.core.websocket_manager import ConnectionManager


class TestConnectionManager:

    @pytest.mark.unit
    async def test_connect_tracks_websocket(self):
        """Connecting a WebSocket should track it under the organization."""
        mgr = ConnectionManager()
        ws = AsyncMock()

        await mgr.connect(ws, "org-1")

        assert ws in mgr._connections["org-1"]
        ws.accept.assert_awaited_once()

    @pytest.mark.unit
    async def test_disconnect_removes_websocket(self):
        """Disconnecting should remove the WebSocket from tracking."""
        mgr = ConnectionManager()
        ws = AsyncMock()

        await mgr.connect(ws, "org-1")
        mgr.disconnect(ws, "org-1")

        assert "org-1" not in mgr._connections

    @pytest.mark.unit
    async def test_disconnect_keeps_other_connections(self):
        """Disconnecting one WebSocket should not affect others in the same org."""
        mgr = ConnectionManager()
        ws1 = AsyncMock()
        ws2 = AsyncMock()

        await mgr.connect(ws1, "org-1")
        await mgr.connect(ws2, "org-1")

        mgr.disconnect(ws1, "org-1")

        assert ws2 in mgr._connections["org-1"]
        assert ws1 not in mgr._connections["org-1"]

    @pytest.mark.unit
    async def test_broadcast_removes_dead_connections(self):
        """Broadcast should detect and remove dead connections."""
        mgr = ConnectionManager()
        live_ws = AsyncMock()
        dead_ws = AsyncMock()
        dead_ws.send_text.side_effect = RuntimeError("connection closed")

        await mgr.connect(live_ws, "org-1")
        await mgr.connect(dead_ws, "org-1")

        await mgr.broadcast_to_org("org-1", {"type": "test"})

        # Dead connection should be removed
        assert dead_ws not in mgr._connections.get("org-1", set())
        # Live connection should remain
        assert live_ws in mgr._connections["org-1"]

    @pytest.mark.unit
    async def test_cleanup_dead_connections_removes_disconnected(self):
        """cleanup_dead_connections should remove WebSockets in DISCONNECTED state."""
        mgr = ConnectionManager()

        live_ws = AsyncMock()
        live_ws.client_state = MagicMock()
        live_ws.client_state.name = "CONNECTED"

        dead_ws = AsyncMock()
        dead_ws.client_state = MagicMock()
        dead_ws.client_state.name = "DISCONNECTED"

        await mgr.connect(live_ws, "org-1")
        await mgr.connect(dead_ws, "org-1")

        removed = await mgr.cleanup_dead_connections()

        assert removed == 1
        assert dead_ws not in mgr._connections.get("org-1", set())
        assert live_ws in mgr._connections["org-1"]

    @pytest.mark.unit
    async def test_cleanup_dead_connections_handles_no_connections(self):
        """cleanup_dead_connections should handle empty connection manager."""
        mgr = ConnectionManager()

        removed = await mgr.cleanup_dead_connections()

        assert removed == 0

    @pytest.mark.unit
    async def test_cleanup_dead_connections_removes_empty_orgs(self):
        """If all connections for an org are dead, the org entry is removed."""
        mgr = ConnectionManager()

        dead_ws = AsyncMock()
        dead_ws.client_state = MagicMock()
        dead_ws.client_state.name = "DISCONNECTED"

        await mgr.connect(dead_ws, "org-2")

        await mgr.cleanup_dead_connections()

        assert "org-2" not in mgr._connections

    @pytest.mark.unit
    async def test_cleanup_dead_connections_handles_broken_state(self):
        """Connections with inaccessible client_state should be treated as dead."""
        mgr = ConnectionManager()

        # Create a custom class whose client_state raises on access
        class BrokenWS:
            async def accept(self):
                pass

            @property
            def client_state(self):
                raise AttributeError("no state")

        broken_ws = BrokenWS()
        await mgr.connect(broken_ws, "org-3")

        removed = await mgr.cleanup_dead_connections()

        assert removed == 1
        assert "org-3" not in mgr._connections

    @pytest.mark.unit
    async def test_cleanup_across_multiple_orgs(self):
        """cleanup_dead_connections should work across multiple organizations."""
        mgr = ConnectionManager()

        dead1 = AsyncMock()
        dead1.client_state = MagicMock()
        dead1.client_state.name = "DISCONNECTED"

        live1 = AsyncMock()
        live1.client_state = MagicMock()
        live1.client_state.name = "CONNECTED"

        dead2 = AsyncMock()
        dead2.client_state = MagicMock()
        dead2.client_state.name = "DISCONNECTED"

        await mgr.connect(dead1, "org-A")
        await mgr.connect(live1, "org-A")
        await mgr.connect(dead2, "org-B")

        removed = await mgr.cleanup_dead_connections()

        assert removed == 2
        assert live1 in mgr._connections["org-A"]
        assert "org-B" not in mgr._connections

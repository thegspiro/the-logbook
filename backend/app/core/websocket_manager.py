"""
WebSocket Connection Manager

Manages WebSocket connections per organization with Redis pub/sub
for broadcasting inventory change events to connected clients.
"""

import asyncio
import json
from typing import Dict, Set, Optional
from fastapi import WebSocket
from loguru import logger

from app.core.cache import cache_manager


class ConnectionManager:
    """
    Manages WebSocket connections grouped by organization.

    Uses Redis pub/sub so that events published by any backend worker
    reach every connected client in the same organization.
    """

    def __init__(self):
        self._connections: Dict[str, Set[WebSocket]] = {}
        self._pubsub = None
        self._listener_task: Optional[asyncio.Task] = None

    async def connect(self, websocket: WebSocket, organization_id: str):
        await websocket.accept()
        if organization_id not in self._connections:
            self._connections[organization_id] = set()
        self._connections[organization_id].add(websocket)
        logger.debug(f"WS connected: org={organization_id}, total={len(self._connections[organization_id])}")

    def disconnect(self, websocket: WebSocket, organization_id: str):
        if organization_id in self._connections:
            self._connections[organization_id].discard(websocket)
            if not self._connections[organization_id]:
                del self._connections[organization_id]
        logger.debug(f"WS disconnected: org={organization_id}")

    async def broadcast_to_org(self, organization_id: str, message: dict):
        """Send a message to all connections in an organization."""
        connections = self._connections.get(organization_id, set())
        if not connections:
            return

        dead = []
        data = json.dumps(message)
        for ws in connections:
            try:
                await ws.send_text(data)
            except Exception:
                dead.append(ws)

        for ws in dead:
            self.disconnect(ws, organization_id)

    async def publish_event(self, organization_id: str, event: dict):
        """
        Publish an inventory event via Redis pub/sub.

        If Redis is unavailable, falls back to direct local broadcast.
        """
        message = {"org_id": organization_id, **event}

        if cache_manager.is_connected and cache_manager.redis_client:
            try:
                channel = f"inventory_events:{organization_id}"
                await cache_manager.redis_client.publish(channel, json.dumps(message))
                return
            except Exception as e:
                logger.warning(f"Redis publish failed, falling back to local broadcast: {e}")

        # Fallback: broadcast locally
        await self.broadcast_to_org(organization_id, event)

    async def start_listener(self):
        """Start the Redis pub/sub listener for inventory events."""
        if not cache_manager.is_connected or not cache_manager.redis_client:
            logger.info("Redis unavailable — WebSocket events will be local-only")
            return

        try:
            self._pubsub = cache_manager.redis_client.pubsub()
            await self._pubsub.psubscribe("inventory_events:*")
            self._listener_task = asyncio.create_task(self._listen())
            logger.info("WebSocket Redis pub/sub listener started")
        except Exception as e:
            logger.warning(f"Failed to start Redis pub/sub listener: {e}")

    async def _listen(self):
        """Background task that reads from Redis pub/sub and broadcasts."""
        try:
            while True:
                message = await self._pubsub.get_message(
                    ignore_subscribe_messages=True,
                    timeout=1.0,
                )
                if message and message["type"] == "pmessage":
                    try:
                        data = json.loads(message["data"])
                        org_id = data.pop("org_id", None)
                        if org_id:
                            await self.broadcast_to_org(org_id, data)
                    except (json.JSONDecodeError, KeyError):
                        pass
                else:
                    await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Redis pub/sub listener error: {e}")

    async def stop_listener(self):
        """Stop the Redis pub/sub listener."""
        if self._listener_task:
            self._listener_task.cancel()
            try:
                await self._listener_task
            except asyncio.CancelledError:
                pass
        if self._pubsub:
            try:
                await self._pubsub.unsubscribe()
                await self._pubsub.close()
            except Exception:
                pass
        logger.info("WebSocket pub/sub listener stopped")


# Global instance
ws_manager = ConnectionManager()

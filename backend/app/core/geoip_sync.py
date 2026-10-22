"""
Cross-worker GeoIP invalidation.

The GeoIP service keeps its blocked-country set in process memory. With multiple
uvicorn workers, a country add/remove handled by one worker would otherwise
leave the other workers stale until restart. We publish a lightweight
invalidation message on Redis; every worker subscribes and re-syncs its in-memory
set from the database (the source of truth), so admin changes take effect across
all workers within seconds.

The same channel carries the IP-exception invalidation: revoking an allowlist
exception tells every worker to drop the edge middleware's cached answers, so
the revoked address is looked up again on its next request.

Imports of the DB session factory and the IP-security service are performed lazily
inside the functions to avoid an import cycle (the service publishes invalidations).
"""

import asyncio
from typing import Any

from loguru import logger
from redis.asyncio.client import PubSub

from app.core.cache import cache_manager

GEOIP_INVALIDATION_CHANNEL = "geoip:invalidate"
# Sent on the same channel when an IP allowlist exception is revoked. It shares
# the country-block listener rather than adding a second subscription per
# worker; any other payload means "re-sync blocked countries", which is what a
# worker still running the previous code does with this one too.
IP_EXCEPTION_INVALIDATION = "ip-exceptions"


async def publish_geoip_invalidation() -> None:
    """Notify all workers that the country-block rules changed (best-effort)."""
    try:
        if cache_manager.is_connected and cache_manager.redis_client:
            await cache_manager.redis_client.publish(GEOIP_INVALIDATION_CHANNEL, "1")
    except Exception as e:  # pragma: no cover - best effort, must never raise
        logger.warning(f"Failed to publish GeoIP invalidation: {e}")


async def publish_ip_exception_invalidation() -> None:
    """Tell every worker to drop its cached IP-exception answers (best-effort).

    Without Redis only this worker is cleared (the caller does that directly);
    the others fall back to the cache's short TTL.
    """
    try:
        if cache_manager.is_connected and cache_manager.redis_client:
            await cache_manager.redis_client.publish(
                GEOIP_INVALIDATION_CHANNEL, IP_EXCEPTION_INVALIDATION
            )
    except Exception as e:  # pragma: no cover - best effort, must never raise
        logger.warning(f"Failed to publish IP exception invalidation: {e}")


class GeoIPInvalidationListener:
    """Per-worker subscriber that refreshes blocked countries on invalidation."""

    def __init__(self) -> None:
        self._pubsub: PubSub | None = None
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        if not (cache_manager.is_connected and cache_manager.redis_client):
            logger.info(
                "GeoIP invalidation listener not started (Redis unavailable); "
                "country-block changes will propagate to this worker on restart."
            )
            return
        pubsub = cache_manager.redis_client.pubsub()
        self._pubsub = pubsub
        await pubsub.subscribe(GEOIP_INVALIDATION_CHANNEL)
        self._task = asyncio.create_task(self._listen())
        logger.info("✓ GeoIP invalidation listener started")

    async def _refresh(self) -> None:
        from app.core.database import async_session_factory
        from app.services.ip_security_service import ip_security_service

        async with async_session_factory() as db:
            await ip_security_service.sync_blocked_countries_to_geoip(db)
        logger.info("Refreshed blocked countries from DB (invalidation received)")

    async def _handle(self, message: dict[str, Any]) -> None:
        if message.get("data") == IP_EXCEPTION_INVALIDATION:
            from app.core.security_middleware import invalidate_ip_exception_cache

            invalidate_ip_exception_cache()
            logger.info("Cleared cached IP exceptions (invalidation received)")
            return
        await self._refresh()

    async def _listen(self) -> None:
        pubsub = self._pubsub
        if pubsub is None:
            raise RuntimeError("GeoIP listener started before subscribing")
        while True:
            try:
                message = await pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=5.0
                )
                if message is None:
                    continue
                await self._handle(message)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.warning(f"GeoIP invalidation listener error: {e}")
                await asyncio.sleep(1)

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            self._task = None
        if self._pubsub:
            try:
                await self._pubsub.unsubscribe()
                await self._pubsub.close()
            except Exception:  # pragma: no cover - shutdown best effort
                pass
            self._pubsub = None


geoip_invalidation_listener = GeoIPInvalidationListener()

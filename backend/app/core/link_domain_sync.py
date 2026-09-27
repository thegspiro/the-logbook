"""
Cross-worker sync of the saved email link domain.

``settings.FRONTEND_URL`` lives in each uvicorn worker's memory, and production
runs four of them, any of which may send the next reminder. A change saved on
one worker is published on Redis so every worker re-reads it from the database
at once. A periodic re-read backs that up, because a worker that missed the
message — Redis restarted, or never configured — would otherwise send links to
the old address until it restarted.

Mirrors app.core.geoip_sync; imports of the session factory and service are
lazy for the same import-cycle reason.
"""

import asyncio
from time import monotonic

from loguru import logger

from app.core.cache import cache_manager

LINK_DOMAIN_INVALIDATION_CHANNEL = "email_link_domain:invalidate"
LINK_DOMAIN_REFRESH_SECONDS = 60.0


async def publish_link_domain_invalidation() -> None:
    """Tell every worker the saved link domain changed (best effort)."""
    try:
        if cache_manager.is_connected and cache_manager.redis_client:
            await cache_manager.redis_client.publish(
                LINK_DOMAIN_INVALIDATION_CHANNEL, "1"
            )
    except Exception as e:  # pragma: no cover - best effort, must never raise
        logger.warning(f"Failed to publish link domain invalidation: {e}")


async def refresh_link_domain() -> None:
    """Re-read the saved link domain into this worker's settings."""
    from app.core.database import async_session_factory
    from app.services.email_link_domain_service import load_into_settings

    async with async_session_factory() as db:
        await load_into_settings(db)


class LinkDomainListener:
    """Per-worker subscriber that keeps FRONTEND_URL in step with the saved value."""

    def __init__(self) -> None:
        self._pubsub = None
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        if cache_manager.is_connected and cache_manager.redis_client:
            self._pubsub = cache_manager.redis_client.pubsub()
            await self._pubsub.subscribe(LINK_DOMAIN_INVALIDATION_CHANNEL)
        else:
            logger.info(
                "Link domain listener running without Redis; a changed email "
                "link address reaches this worker within {:.0f}s.",
                LINK_DOMAIN_REFRESH_SECONDS,
            )
        self._task = asyncio.create_task(self._listen())

    async def _wait_for_message(self, timeout: float) -> bool:
        if self._pubsub is None:
            await asyncio.sleep(timeout)
            return False
        message = await self._pubsub.get_message(
            ignore_subscribe_messages=True, timeout=timeout
        )
        return message is not None

    async def _listen(self) -> None:
        last_refresh = monotonic()
        while True:
            try:
                received = await self._wait_for_message(5.0)
                if (
                    received
                    or monotonic() - last_refresh >= LINK_DOMAIN_REFRESH_SECONDS
                ):
                    await refresh_link_domain()
                    last_refresh = monotonic()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.warning(f"Link domain listener error: {e}")
                last_refresh = monotonic()
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


link_domain_listener = LinkDomainListener()

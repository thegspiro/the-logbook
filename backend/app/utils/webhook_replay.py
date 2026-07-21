"""Replay protection for inbound webhooks.

Signature verification proves a payload is authentic but NOT fresh: a valid
signed request captured from logs / a proxy / a re-fired provider event can be
replayed indefinitely to re-trigger side effects (advancing pipeline stages,
re-running syncs). This module dedups deliveries within a short window so an
identical signed body is only processed once.

Keyed on a hash of (scope + raw body), it needs no cooperation from the sender
(providers that include a unique id/timestamp inside the body get exact dedup;
providers that don't still can't replay the identical captured request). When
Redis is unavailable the check fails OPEN — freshness degrades but authentic,
signature-verified deliveries are not dropped.
"""

import hashlib

from loguru import logger

# How long a delivery fingerprint is remembered. Sized to cover realistic
# capture-and-replay windows without unbounded growth (Redis expires the key).
WEBHOOK_DEDUP_TTL_SECONDS = 600  # 10 minutes


async def is_duplicate_webhook(scope: str, body: bytes) -> bool:
    """Return True if this exact delivery was already seen (a replay).

    Args:
        scope: Namespacing string (e.g. "salesforce:<integration_id>") so
            identical bodies to different integrations don't collide.
        body: Raw request body bytes (already signature-verified by the caller).
    """
    from app.core.cache import cache_manager

    if not (cache_manager.is_connected and cache_manager.redis_client):
        # Fail open: without Redis we cannot dedup. Do not drop authentic,
        # signature-verified deliveries — freshness is best-effort here.
        return False

    fingerprint = hashlib.sha256(scope.encode() + b"|" + body).hexdigest()
    key = f"webhook_seen:{fingerprint}"
    try:
        # SET NX EX is atomic: returns truthy only if the key was newly created.
        added = await cache_manager.redis_client.set(
            key, "1", nx=True, ex=WEBHOOK_DEDUP_TTL_SECONDS
        )
        return not added
    except Exception as exc:
        logger.warning("Webhook replay check failed (allowing delivery): {}", exc)
        return False

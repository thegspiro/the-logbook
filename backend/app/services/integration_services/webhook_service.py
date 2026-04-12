"""
Generic Outbound Webhook Service

Sends HTTP POST webhooks to arbitrary URLs when app events occur.
Includes HMAC-SHA256 signature for payload verification.
"""

import hashlib
import hmac
import json
import time
from typing import Any

from loguru import logger

from app.services.integration_services.base import create_integration_client

# Retry config
MAX_RETRIES = 3
BACKOFF_SECONDS = [1, 2, 4]


def _sign_payload(payload_bytes: bytes, secret: str) -> str:
    """Generate HMAC-SHA256 signature for a webhook payload."""
    return hmac.new(
        secret.encode("utf-8"),
        payload_bytes,
        hashlib.sha256,
    ).hexdigest()


async def send_webhook(
    url: str,
    event_type: str,
    payload: dict[str, Any],
    secret: str | None = None,
) -> bool:
    """
    Send an outbound webhook with optional HMAC signature.

    Args:
        url: Destination URL.
        event_type: Event type string (e.g. "event.created").
        payload: JSON-serializable payload.
        secret: Optional HMAC secret for X-Webhook-Signature header.

    Returns:
        True if the webhook was delivered (2xx response).
    """
    body = json.dumps(
        {
            "event_type": event_type,
            "timestamp": int(time.time()),
            "data": payload,
        },
        default=str,
    ).encode("utf-8")

    headers: dict[str, str] = {
        "Content-Type": "application/json",
        "X-Webhook-Event": event_type,
        "User-Agent": "TheLogbook-Webhook/1.0",
    }
    if secret:
        headers["X-Webhook-Signature"] = f"sha256={_sign_payload(body, secret)}"

    for attempt in range(MAX_RETRIES):
        try:
            async with create_integration_client() as client:
                response = await client.post(url, content=body, headers=headers)
                if 200 <= response.status_code < 300:
                    return True
                logger.warning(
                    "Webhook to %s returned %d (attempt %d/%d)",
                    url,
                    response.status_code,
                    attempt + 1,
                    MAX_RETRIES,
                )
        except Exception:
            logger.warning(
                "Webhook to %s failed (attempt %d/%d)",
                url,
                attempt + 1,
                MAX_RETRIES,
                exc_info=True,
            )
        if attempt < MAX_RETRIES - 1:
            import asyncio

            await asyncio.sleep(BACKOFF_SECONDS[attempt])

    logger.error("Webhook to %s failed after %d attempts", url, MAX_RETRIES)
    return False


async def send_test_webhook(url: str, secret: str | None = None) -> str:
    """Send a test webhook to verify the URL."""
    success = await send_webhook(
        url,
        event_type="test.ping",
        payload={"message": "The Logbook webhook test"},
        secret=secret,
    )
    if success:
        return "Test webhook delivered successfully"
    raise Exception("Webhook delivery failed — check the URL")

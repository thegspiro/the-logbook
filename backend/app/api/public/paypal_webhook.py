"""
PayPal Inbound Webhook Endpoint

Public (unauthenticated) endpoint that PayPal POSTs payment notifications to.
The department registers this URL against its own PayPal app; each connected
organization gets its own path segment.

Security:
- Rate limited per IP
- Every payload is verified through PayPal's verify-webhook-signature API,
  which keys the check on the webhook id the department configured. An
  integration with no webhook id configured is rejected outright rather than
  trusted — this endpoint mutates payment state, so an unverifiable delivery
  is worth nothing.
- Replay-protected, and the capture id is unique per organization, so a
  redelivered notification can never pay an order twice.
- Every delivery is audit-logged.

PayPal retries until it receives a 2xx, so anything we deliberately decline to
act on (an event type we don't handle, a duplicate) still answers 200 with a
reason. Only genuine failures return an error status.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.security_middleware import get_client_ip, public_rate_limit
from app.core.utils import safe_error_detail
from app.models.integration import Integration
from app.services.integration_services.paypal_service import (
    extract_capture,
    verify_webhook_signature,
)
from app.services.storefront_service import StorefrontService
from app.utils.webhook_replay import is_duplicate_webhook

router = APIRouter(
    prefix="/public/v1/webhooks/paypal",
    tags=["public-paypal-webhook"],
)


async def _rate_limit_webhook(request: Request) -> None:
    """Rate limit inbound webhooks: 60/minute per IP."""
    client_ip = get_client_ip(request)
    is_limited, reason = await public_rate_limit(
        f"paypal_webhook:{client_ip}", max_requests=60, window_seconds=60
    )
    if is_limited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=reason or "Rate limit exceeded",
        )


@router.post("/{integration_id}")
async def paypal_inbound_webhook(
    integration_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _rl: None = Depends(_rate_limit_webhook),
):
    """Receive a PayPal webhook and reconcile it against store orders."""
    result = await db.execute(
        select(Integration).where(
            Integration.id == integration_id,
            Integration.integration_type == "paypal",
            Integration.enabled.is_(True),
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Integration not found",
        )

    body = await request.body()
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid JSON payload",
        )

    verified = await verify_webhook_signature(
        integration, dict(request.headers), payload
    )
    if not verified:
        logger.warning(
            "PayPal webhook signature verification failed for integration {}",
            integration_id,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid signature",
        )

    # Ack duplicates with 200 so PayPal stops retrying.
    if await is_duplicate_webhook(f"paypal:{integration_id}", body):
        return {"status": "ignored", "reason": "duplicate"}

    capture = extract_capture(payload)
    if capture is None:
        # Subscribing to extra event types in the PayPal dashboard is easy to
        # do by accident; acknowledge them rather than making PayPal retry.
        return {
            "status": "ignored",
            "reason": f"unhandled event type {payload.get('event_type')}",
        }

    config = integration.config or {}
    service = StorefrontService(db)
    try:
        event = await service.record_external_payment(
            integration.organization_id,
            "paypal",
            capture,
            raw_payload=payload,
            auto_apply=bool(config.get("auto_apply_payments", True)),
        )
    except ValueError as exc:
        logger.error(f"PayPal webhook could not be recorded: {exc}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(exc),
        )

    await log_audit_event(
        db=db,
        event_type="store_payment_received",
        event_category="storefront",
        severity="info",
        event_data={
            "provider": "paypal",
            "integration_id": integration_id,
            "organization_id": str(integration.organization_id),
            "capture_id": capture.get("capture_id"),
            "amount": str(capture.get("amount")),
            "match_status": event.status.value if event.status else None,
            "matched_order_id": event.matched_order_id,
        },
    )

    return {
        "status": "received",
        "match_status": event.status.value if event.status else None,
    }

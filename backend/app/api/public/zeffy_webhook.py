"""
Zeffy Inbound Webhook Endpoint

Public (unauthenticated) endpoint Zeffy POSTs payment events to. The department
pastes this URL into Zeffy's Settings → Integrations → Webhook dialog; each
connected organization gets its own path segment.

Security:
- Rate limited per IP.
- Every delivery must carry a valid ``Zeffy-Signature`` (HMAC-SHA256 over the
  raw body under the department's ``whsec_`` secret) signed within the last five
  minutes. An integration with no signing secret refuses every delivery rather
  than trusting it — this endpoint moves money between records.
- The body is never applied as it arrives. The payment is re-read from Zeffy's
  API with the department's own key, because ``payment.updated`` and
  ``payment.deleted`` carry only an id, and so that every path applies the same
  current state of a payment.
- Idempotent without a replay cache: the payment id is unique per organization
  in ``zeffy_payments``, and a repeat re-reads the payment and applies the
  difference from what is already applied, which is nothing. A replay cache
  would be worse here — it marks an event seen before it is processed, so a
  delivery that failed with 503 would be dropped as a duplicate when Zeffy
  retried it.
- Every applied delivery is audit-logged.

Zeffy retries any non-2xx for three days, so anything deliberately not acted on
(an event type we ignore) answers 200. A failure to reach Zeffy's
API answers 503 so the delivery is retried rather than lost.
"""

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Request, status
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.security_middleware import get_client_ip, public_rate_limit
from app.models.integration import Integration
from app.services.integration_services.zeffy_service import (
    ZeffyClient,
    ZeffyError,
    api_key_from_integration,
    as_dict,
    verify_signature,
    webhook_secret_from_integration,
)
from app.services.zeffy_sync_service import ZeffySyncService

router = APIRouter(
    prefix="/public/v1/webhooks/zeffy",
    tags=["public-zeffy-webhook"],
)

_PAYMENT_EVENTS = frozenset(
    {"payment.created", "payment.completed", "payment.updated", "payment.deleted"}
)


async def _rate_limit_webhook(request: Request) -> None:
    """Rate limit inbound webhooks: 60/minute per IP."""
    client_ip = get_client_ip(request)
    is_limited, reason = await public_rate_limit(
        f"zeffy_webhook:{client_ip}", max_requests=60, window_seconds=60
    )
    if is_limited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=reason or "Rate limit exceeded",
        )


@router.post("/{integration_id}")
async def zeffy_inbound_webhook(
    integration_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _rl: None = Depends(_rate_limit_webhook),
) -> Dict[str, Any]:
    """Receive a Zeffy event and record the payment it concerns."""
    result = await db.execute(
        select(Integration).where(
            Integration.id == integration_id,
            Integration.integration_type == "zeffy",
            Integration.enabled.is_(True),
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found"
        )

    body = await request.body()
    if not verify_signature(
        body,
        request.headers.get("zeffy-signature"),
        webhook_secret_from_integration(integration),
    ):
        logger.warning(
            "Zeffy webhook signature verification failed for integration {}",
            integration_id,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid signature"
        )

    try:
        payload = await request.json()
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON payload"
        )
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON payload"
        )

    event_type = payload.get("type")
    if event_type not in _PAYMENT_EVENTS:
        # Contact events are easy to tick in Zeffy's dialog; acknowledge them
        # so Zeffy does not retry for three days.
        return {"status": "ignored", "reason": f"unhandled event type {event_type}"}

    data = as_dict(payload.get("data"))
    payment_id = str(data.get("id") or "").strip()
    if not payment_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Event carries no payment id",
        )

    organization_id = str(integration.organization_id)
    try:
        client = ZeffyClient(api_key_from_integration(integration))
        payment = await client.get_payment(payment_id)
        row = await ZeffySyncService(db).record_payment(
            organization_id, payment_id, payment
        )
    except ZeffyError as exc:
        await db.rollback()
        logger.warning(
            "Zeffy webhook for integration {} could not read payment {}: {}",
            integration_id,
            payment_id,
            exc,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Zeffy could not be reached; the delivery will be retried",
        )

    await db.commit()
    if row is None:
        return {"status": "ignored", "reason": "unknown payment already deleted"}

    await log_audit_event(
        db=db,
        event_type="zeffy_payment_received",
        event_category="fundraising",
        severity="info",
        event_data={
            "integration_id": integration_id,
            "organization_id": organization_id,
            "event_type": event_type,
            "event_id": str(payload.get("id") or ""),
            "zeffy_payment_id": payment_id,
            "amount": str(row.amount),
            "state": row.state.value,
            "applied_target_type": (
                row.applied_target_type.value if row.applied_target_type else None
            ),
        },
    )
    return {"status": "received", "state": row.state.value}

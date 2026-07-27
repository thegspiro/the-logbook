"""
Documenso & Cal.com Inbound Webhook Endpoints

Public (unauthenticated) endpoints these services POST to when a document is
signed or a booking is made. A matching prospect's membership-pipeline stage is
auto-advanced, closing the loop on the e-signature / self-scheduling stages.

Security (mirrors the Salesforce inbound webhook):
- Rate limited per IP (30 requests/minute)
- Signature/secret verification is mandatory — an integration with no
  webhook_secret configured rejects all payloads rather than trusting them
- Integration ID validated against the database
- All inbound payloads are audit-logged

Correlation is by recipient/attendee email: the applicant applied with that
email, so a completed signature or a new booking for that email advances the
prospect whose current stage is configured to use the integration. No live API
call is needed to close the loop.
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.security_middleware import get_client_ip, public_rate_limit
from app.utils.webhook_replay import is_duplicate_webhook
from app.models.integration import Integration
from app.services.integration_services import calcom_service, documenso_service
from app.services.integration_services.webhook_service import (
    verify_hmac_signature,
    verify_shared_secret,
)
from app.services.membership_pipeline_service import MembershipPipelineService

router = APIRouter(
    prefix="/public/v1/webhooks",
    tags=["public-integration-webhooks"],
)


async def _rate_limit_webhook(request: Request, key: str) -> None:
    """Rate limit inbound webhooks: 30/minute per IP."""
    client_ip = get_client_ip(request)
    is_limited, reason = await public_rate_limit(
        f"{key}:{client_ip}", max_requests=30, window_seconds=60
    )
    if is_limited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=reason or "Rate limit exceeded",
        )


async def _load_integration(
    db: AsyncSession, integration_id: str, integration_type: str
) -> Integration:
    """Load an enabled integration of the expected type, or 404."""
    result = await db.execute(
        select(Integration).where(
            Integration.id == integration_id,
            Integration.integration_type == integration_type,
            Integration.enabled.is_(True),
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found"
        )
    return integration


def _require_webhook_secret(integration: Integration, log_label: str) -> str:
    """Return the configured webhook secret, or 401 if none is set.

    A public, data-mutating endpoint must never accept unverified payloads —
    anyone who learns the integration_id UUID could otherwise forge events.
    """
    secret = integration.get_secret("webhook_secret")
    if not secret:
        logger.warning(
            "{} webhook rejected: no webhook_secret configured for integration {}",
            log_label,
            integration.id,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Webhook verification is not configured",
        )
    return secret


async def _read_json(request: Request) -> dict[str, Any]:
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON payload"
        )
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON payload"
        )
    return payload


@router.post("/documenso/{integration_id}")
async def documenso_inbound_webhook(
    integration_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Receive a Documenso webhook and advance a signing stage on completion.

    Documenso authenticates by echoing the pre-shared secret in the
    ``X-Documenso-Secret`` header. Only ``DOCUMENT_COMPLETED`` events advance a
    stage; other events are acknowledged and ignored.
    """
    await _rate_limit_webhook(request, "documenso_webhook")
    integration = await _load_integration(db, integration_id, "documenso")
    secret = _require_webhook_secret(integration, "Documenso")

    body = await request.body()
    provided = request.headers.get("X-Documenso-Secret", "")
    # Accept either a shared-secret header or an HMAC signature, so departments
    # can use whichever their Documenso deployment sends.
    sig = request.headers.get("X-Documenso-Signature", "")
    if not (
        verify_shared_secret(provided, secret)
        or verify_hmac_signature(body, secret, sig)
    ):
        logger.warning(
            "Documenso webhook verification failed for integration {}", integration_id
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid signature"
        )

    # Replay protection: don't reprocess a captured, validly-signed delivery.
    if await is_duplicate_webhook(f"documenso:{integration_id}", body):
        logger.info("Ignoring duplicate Documenso webhook for {}", integration_id)
        return {"success": True, "event": "duplicate", "advanced": False}

    payload = await _read_json(request)
    event = documenso_service.parse_webhook_event(payload)

    advanced = None
    if event["completed"] and event["recipient_emails"]:
        service = MembershipPipelineService(db)
        advanced = await service.complete_current_step_for_integration_event(
            organization_id=str(integration.organization_id),
            emails=event["recipient_emails"],
            step_type="document_upload",
            provider_key="signing_provider",
            provider_value="documenso",
            completed_by="integration:documenso",
            action_result={"document_title": event["title"], "source": "documenso"},
        )

    await log_audit_event(
        db,
        "documenso.webhook.received",
        "integrations",
        "info",
        {
            "integration_id": integration_id,
            "organization_id": integration.organization_id,
            "event": event["event"],
            "advanced_prospect_id": advanced["prospect_id"] if advanced else None,
            "source_ip": get_client_ip(request),
        },
    )

    return {"success": True, "event": event["event"], "advanced": bool(advanced)}


@router.post("/calcom/{integration_id}")
async def calcom_inbound_webhook(
    integration_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Receive a Cal.com webhook and advance a meeting stage on a new booking.

    Cal.com signs the raw body with HMAC-SHA256 and sends it in the
    ``X-Cal-Signature-256`` header. Only ``BOOKING_CREATED`` events advance a
    stage; other events are acknowledged and ignored.
    """
    await _rate_limit_webhook(request, "calcom_webhook")
    integration = await _load_integration(db, integration_id, "calcom")
    secret = _require_webhook_secret(integration, "Cal.com")

    body = await request.body()
    sig = request.headers.get("X-Cal-Signature-256", "")
    if not verify_hmac_signature(body, secret, sig):
        logger.warning(
            "Cal.com webhook signature mismatch for integration {}", integration_id
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid signature"
        )

    # Replay protection: don't reprocess a captured, validly-signed delivery.
    if await is_duplicate_webhook(f"calcom:{integration_id}", body):
        logger.info("Ignoring duplicate Cal.com webhook for {}", integration_id)
        return {"success": True, "event": "duplicate", "advanced": False}

    payload = await _read_json(request)
    event = calcom_service.parse_webhook_event(payload)

    advanced = None
    if event["created"] and event["attendee_emails"]:
        service = MembershipPipelineService(db)
        advanced = await service.complete_current_step_for_integration_event(
            organization_id=str(integration.organization_id),
            emails=event["attendee_emails"],
            step_type="meeting",
            provider_key="scheduling_provider",
            provider_value="calcom",
            completed_by="integration:calcom",
            action_result={"booking_uid": event["booking_uid"], "source": "calcom"},
        )

    await log_audit_event(
        db,
        "calcom.webhook.received",
        "integrations",
        "info",
        {
            "integration_id": integration_id,
            "organization_id": integration.organization_id,
            "trigger": event["trigger"],
            "advanced_prospect_id": advanced["prospect_id"] if advanced else None,
            "source_ip": get_client_ip(request),
        },
    )

    return {"success": True, "trigger": event["trigger"], "advanced": bool(advanced)}

"""
Salesforce Inbound Webhook Endpoint

Public (unauthenticated) endpoint that Salesforce can POST to via
Outbound Messages or Platform Events.  Requests are verified using
HMAC-SHA256 signatures with the per-integration webhook secret.

Security:
- Rate limited per IP (30 requests/minute, 5-minute lockout)
- HMAC-SHA256 signature verification
- Payload size limited by FastAPI / Uvicorn defaults
- Integration ID validated against the database
- All inbound payloads are audit-logged
"""

import hashlib
import hmac

from fastapi import APIRouter, Depends, HTTPException, Request, status
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.security_middleware import get_client_ip, rate_limiter
from app.models.integration import Integration
from app.services.integration_services.salesforce_service import SalesforceService
from app.services.integration_services.salesforce_sync_service import (
    SalesforceSyncService,
    build_salesforce_credentials,
)

router = APIRouter(
    prefix="/public/v1/webhooks/salesforce",
    tags=["public-salesforce-webhook"],
)


async def _rate_limit_webhook(request: Request) -> None:
    """Rate limit inbound webhooks: 30/minute per IP, 5-minute lockout."""
    client_ip = get_client_ip(request)
    is_limited, reason = rate_limiter.is_rate_limited(
        f"sf_webhook:{client_ip}", max_requests=30, window_seconds=60
    )
    if is_limited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=reason or "Rate limit exceeded",
        )


def _verify_signature(body: bytes, secret: str, provided_signature: str) -> bool:
    """Verify the HMAC-SHA256 signature from Salesforce."""
    expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", provided_signature)


@router.post("/{integration_id}")
async def salesforce_inbound_webhook(
    integration_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _rl: None = Depends(_rate_limit_webhook),
):
    """Receive an inbound webhook from Salesforce.

    Salesforce sends a JSON payload containing one or more sObject records.
    The endpoint verifies the HMAC signature, parses the payload, and
    routes to the appropriate handler based on the sObject type.

    Expected payload shape (configurable in Salesforce):
    {
        "sobject": "Contact",
        "action": "created" | "updated" | "deleted",
        "records": [ { ... Salesforce field values ... } ]
    }
    """
    # Load the integration
    result = await db.execute(
        select(Integration).where(
            Integration.id == integration_id,
            Integration.integration_type == "salesforce",
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

    # HMAC verification is mandatory: this is a public, unauthenticated,
    # data-mutating endpoint. An integration with no webhook_secret configured
    # must NOT accept unsigned payloads — otherwise anyone who learns the
    # integration_id UUID could inject records. Reject rather than skip.
    webhook_secret = integration.get_secret("webhook_secret")
    if not webhook_secret:
        logger.warning(
            "Salesforce webhook rejected: no webhook_secret configured for "
            "integration {}",
            integration_id,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Webhook signature verification is not configured",
        )

    sig_header = request.headers.get("X-Salesforce-Signature", "")
    if not sig_header or not _verify_signature(body, webhook_secret, sig_header):
        logger.warning(
            "Salesforce webhook signature mismatch for integration {}",
            integration_id,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid signature",
        )

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid JSON payload",
        )

    sobject = payload.get("sobject", "")
    action = payload.get("action", "")
    records = payload.get("records", [])

    if not sobject or not records:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Payload must include 'sobject' and 'records'",
        )

    # Build sync service
    creds = build_salesforce_credentials(integration)
    sf_service = SalesforceService(creds)
    sync_service = SalesforceSyncService(db, sf_service, integration)

    # Only Contact create/update events map to a Logbook user update. We never
    # act on 'deleted' — removing a member because a Salesforce Contact was
    # deleted would be destructive and is out of scope for inbound sync.
    if sobject != "Contact":
        logger.info("Ignoring unsupported inbound sObject type: {}", sobject)
        detail = f"sObject '{sobject}' is not handled by inbound sync."
        counts = {"updated": 0, "unchanged": 0, "unmatched": 0, "failed": 0}
    elif action == "deleted":
        logger.info(
            "Ignoring Salesforce Contact deletion for integration {} "
            "(inbound deletes are not applied).",
            integration_id,
        )
        detail = "Contact deletions are not applied to Logbook members."
        counts = {"updated": 0, "unchanged": 0, "unmatched": 0, "failed": 0}
    elif not sync_service.inbound_enabled:
        # Push-only org: parse to validate the payload, but do not write.
        logger.info(
            "Salesforce webhook for integration {} ignored: sync direction "
            "is push-only.",
            integration_id,
        )
        detail = "Sync direction is push-only; inbound changes were not applied."
        counts = {"updated": 0, "unchanged": 0, "unmatched": 0, "failed": 0}
    else:
        parsed = [sync_service.parse_inbound_contact(rec) for rec in records]
        counts = await sync_service.sync_inbound_contacts(parsed)
        await db.commit()
        detail = (
            f"{counts['updated']} member(s) updated, "
            f"{counts['unmatched']} unmatched."
        )

    persisted = counts["updated"]

    # Audit log
    await log_audit_event(
        db,
        "salesforce.webhook.received",
        "integrations",
        "info",
        {
            "integration_id": integration_id,
            "organization_id": integration.organization_id,
            "sobject": sobject,
            "action": action,
            "record_count": len(records),
            "persisted": persisted,
            **counts,
            "source_ip": get_client_ip(request),
        },
    )

    return {
        "success": True,
        "received": len(records),
        "persisted": persisted,
        "detail": detail,
        "sobject": sobject,
        "action": action,
        **counts,
    }

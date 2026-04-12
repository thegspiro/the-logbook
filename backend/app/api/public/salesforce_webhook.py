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
from app.services.integration_services.salesforce_sync_service import (
    SalesforceSyncService,
    build_salesforce_credentials,
)
from app.services.integration_services.salesforce_service import (
    SalesforceService,
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


def _verify_signature(
    body: bytes, secret: str, provided_signature: str
) -> bool:
    """Verify the HMAC-SHA256 signature from Salesforce."""
    expected = hmac.new(
        secret.encode("utf-8"), body, hashlib.sha256
    ).hexdigest()
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

    # Verify signature if a webhook_secret is configured
    webhook_secret = integration.get_secret("webhook_secret")
    if webhook_secret:
        sig_header = request.headers.get("X-Salesforce-Signature", "")
        if not sig_header or not _verify_signature(
            body, webhook_secret, sig_header
        ):
            logger.warning(
                "Salesforce webhook signature mismatch for integration %s",
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

    processed = 0
    for record in records:
        if sobject == "Contact":
            sync_service.parse_inbound_contact(record)
            processed += 1
        else:
            logger.info(
                "Ignoring unsupported sObject type: %s", sobject
            )

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
            "processed": processed,
            "source_ip": get_client_ip(request),
        },
    )

    return {
        "success": True,
        "processed": processed,
        "sobject": sobject,
        "action": action,
    }

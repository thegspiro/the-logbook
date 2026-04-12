"""
Integrations API Endpoints

Endpoints for managing external integration configurations.
"""

import re
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db

from app.models.integration import Integration
from app.models.user import User
from app.schemas.integration import (
    INTEGRATION_CONFIG_SCHEMAS,
    SECRET_CONFIG_KEYS,
    IntegrationConnectRequest,
    IntegrationUpdateRequest,
)
from app.utils.url_validator import validate_integration_url

router = APIRouter()

# Pattern for secret-like keys in config
_SECRET_KEY_PATTERN = re.compile(
    r"(token|secret|key|password|api_key|auth|webhook_url|refresh_token|client_secret)",
    re.IGNORECASE,
)

# Default integration catalog - seeded for new orgs
INTEGRATION_CATALOG = [
    {
        "integration_type": "google-calendar",
        "name": "Google Calendar",
        "description": "Sync department events with Google Calendar for easy access on any device.",
        "category": "Calendar",
        "status": "available",
    },
    {
        "integration_type": "outlook",
        "name": "Microsoft Outlook",
        "description": "Connect with Outlook for calendar and email integration.",
        "category": "Calendar",
        "status": "available",
    },
    {
        "integration_type": "slack",
        "name": "Slack",
        "description": "Send automated notifications to Slack channels for real-time updates.",
        "category": "Messaging",
        "status": "available",
    },
    {
        "integration_type": "discord",
        "name": "Discord",
        "description": "Post updates to Discord servers for volunteer department communication.",
        "category": "Messaging",
        "status": "available",
    },
    {
        "integration_type": "csv-import",
        "name": "CSV Import/Export",
        "description": "Import and export data in CSV format for reporting and migration.",
        "category": "Data",
        "status": "available",
    },
    {
        "integration_type": "ical",
        "name": "iCalendar (ICS)",
        "description": "Subscribe to department events via standard iCal feed URL. Works with Apple Calendar, Google Calendar, Outlook, and more.",
        "category": "Calendar",
        "status": "available",
    },
    {
        "integration_type": "microsoft-teams",
        "name": "Microsoft Teams",
        "description": "Send automated notifications to Teams channels via incoming webhooks.",
        "category": "Messaging",
        "status": "available",
    },
    {
        "integration_type": "nws-weather",
        "name": "NWS Weather Alerts",
        "description": "Receive NOAA weather alerts (tornado, flood, fire weather) for your station's zone. Free — no API key required.",
        "category": "Safety",
        "status": "available",
    },
    {
        "integration_type": "nfirs-export",
        "name": "NFIRS Export",
        "description": "Export incident data in NFIRS 5.0 format for state fire marshal reporting.",
        "category": "Reporting",
        "status": "available",
    },
    {
        "integration_type": "generic-webhook",
        "name": "Generic Webhooks",
        "description": "Send outbound webhooks to any URL when events occur. Includes HMAC-SHA256 signatures for verification.",
        "category": "Automation",
        "status": "available",
    },
    {
        "integration_type": "epcr-import",
        "name": "Generic ePCR Import",
        "description": "Import run data from any ePCR vendor (ImageTrend, ESO, Zoll, etc.) via CSV or NEMSIS XML file export. The universal starting point for EMS data integration.",
        "category": "EMS",
        "status": "available",
        "contains_phi": True,
    },
    {
        "integration_type": "nemsis-export",
        "name": "NEMSIS Response Module Export",
        "description": "Export dispatch and response data in NEMSIS 3.5 format for state EMS reporting. Exports timestamps, disposition, and crew data — clinical data requires your ePCR vendor.",
        "category": "EMS",
        "status": "available",
        "contains_phi": True,
    },
    {
        "integration_type": "salesforce",
        "name": "Salesforce",
        "description": "Sync department contacts, donors, and community engagement data with Salesforce CRM. Supports push, pull, or bidirectional sync of members, events, training records, and incidents.",
        "category": "CRM",
        "status": "available",
    },
    {
        "integration_type": "active911",
        "name": "Active911",
        "description": "Receive dispatch alerts and mapping from Active911 paging platform.",
        "category": "Dispatch",
        "status": "coming_soon",
    },
    {
        "integration_type": "google-maps",
        "name": "Google Maps",
        "description": "Hydrant mapping, pre-plan locations, and route optimization.",
        "category": "Mapping",
        "status": "coming_soon",
    },
    {
        "integration_type": "zapier",
        "name": "Zapier",
        "description": "Connect to 5,000+ apps with no-code automation workflows.",
        "category": "Automation",
        "status": "coming_soon",
    },
    {
        "integration_type": "whatsapp",
        "name": "WhatsApp Business",
        "description": "Send department notifications via WhatsApp for international teams.",
        "category": "Messaging",
        "status": "coming_soon",
    },
    {
        "integration_type": "imagetrend",
        "name": "ImageTrend",
        "description": "Connect to ImageTrend for automated ePCR sync. Requires ImageTrend Connect API access (contact your ImageTrend rep to verify your plan includes API access).",
        "category": "EMS",
        "status": "coming_soon",
    },
    {
        "integration_type": "eso-solutions",
        "name": "ESO Solutions",
        "description": "Import run reports from ESO. Requires ESO API agreement (most departments can use the Generic ePCR Import with ESO's CSV export in the meantime).",
        "category": "EMS",
        "status": "coming_soon",
    },
    {
        "integration_type": "nremt",
        "name": "NREMT Verification",
        "description": "Verify EMS certification status. Note: NREMT does not currently offer a programmatic API — this integration is pending future NREMT API availability.",
        "category": "EMS",
        "status": "coming_soon",
    },
    {
        "integration_type": "firstwatch",
        "name": "FirstWatch",
        "description": "Clinical quality analytics integration. Requires FirstWatch vendor partnership.",
        "category": "EMS",
        "status": "coming_soon",
    },
    {
        "integration_type": "pulse-point",
        "name": "PulsePoint",
        "description": "CPR/AED citizen responder alerts and public safety data.",
        "category": "Dispatch",
        "status": "coming_soon",
    },
]


# ============================================================
# Helpers
# ============================================================


def _sanitize_config(config: dict[str, Any] | None) -> dict[str, Any]:
    """Replace secret values with a redacted placeholder."""
    if not config:
        return {}
    sanitized: dict[str, Any] = {}
    for k, v in config.items():
        if _SECRET_KEY_PATTERN.search(k) and v:
            sanitized[k] = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
        else:
            sanitized[k] = v
    return sanitized


def _integration_to_dict(
    integration: Integration, *, sanitize_secrets: bool = True
) -> dict[str, Any]:
    """Convert an Integration model to a response dict."""
    config = integration.config or {}
    if sanitize_secrets:
        config = _sanitize_config(config)
    return {
        "id": integration.id,
        "organization_id": integration.organization_id,
        "integration_type": integration.integration_type,
        "name": integration.name,
        "description": integration.description,
        "category": integration.category,
        "status": integration.status,
        "config": config,
        "enabled": integration.enabled,
        "contains_phi": integration.contains_phi,
        "last_sync_at": (
            integration.last_sync_at.isoformat() if integration.last_sync_at else None
        ),
        "created_at": (
            integration.created_at.isoformat() if integration.created_at else None
        ),
        "updated_at": (
            integration.updated_at.isoformat() if integration.updated_at else None
        ),
    }


def _validate_config(integration_type: str, config: dict[str, Any]) -> dict[str, Any]:
    """Validate config against the schema for this integration type, if one exists."""
    schema_cls = INTEGRATION_CONFIG_SCHEMAS.get(integration_type)
    if schema_cls and config:
        try:
            validated = schema_cls(**config)
            return validated.model_dump()
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid config for {integration_type}: {e}",
            )
    return config


def _extract_secrets(
    config: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, str]]:
    """Split config into non-sensitive fields and secrets."""
    public: dict[str, Any] = {}
    secrets: dict[str, str] = {}
    for k, v in config.items():
        if k in SECRET_CONFIG_KEYS and isinstance(v, str) and v:
            secrets[k] = v
        else:
            public[k] = v
    return public, secrets


def _validate_urls_in_config(config: dict[str, Any]) -> None:
    """Validate any URL fields in config for SSRF protection."""
    url_keys = {"url", "webhook_url", "api_url", "api_base_url", "instance_url"}
    for key in url_keys:
        if key in config and config[key]:
            try:
                validate_integration_url(config[key])
            except ValueError as e:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=str(e),
                )


async def ensure_catalog(db: AsyncSession, organization_id: str) -> None:
    """Ensure all catalog integrations exist for this org."""
    result = await db.execute(
        select(Integration).where(Integration.organization_id == organization_id)
    )
    existing = {row.integration_type for row in result.scalars().all()}

    for item in INTEGRATION_CATALOG:
        if item["integration_type"] not in existing:
            db.add(
                Integration(
                    organization_id=organization_id,
                    integration_type=item["integration_type"],
                    name=item["name"],
                    description=item["description"],
                    category=item["category"],
                    status=item["status"],
                    config={},
                    enabled=False,
                    contains_phi=item.get("contains_phi", False),
                )
            )
    await db.commit()


# ============================================================
# Endpoints
# ============================================================


@router.get("")
async def list_integrations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all integrations for the organization"""
    await ensure_catalog(db, current_user.organization_id)
    result = await db.execute(
        select(Integration)
        .where(Integration.organization_id == str(current_user.organization_id))
        .order_by(Integration.name)
    )
    integrations = result.scalars().all()
    return [_integration_to_dict(i) for i in integrations]


@router.get("/{integration_id}")
async def get_integration(
    integration_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a specific integration"""
    result = await db.execute(
        select(Integration).where(
            Integration.id == integration_id,
            Integration.organization_id == str(current_user.organization_id),
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found"
        )
    return _integration_to_dict(integration)


@router.post("/{integration_id}/connect")
async def connect_integration(
    integration_id: str,
    request: Request,
    body: IntegrationConnectRequest = Body(default_factory=IntegrationConnectRequest),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
):
    """Connect/enable an integration"""
    result = await db.execute(
        select(Integration).where(
            Integration.id == integration_id,
            Integration.organization_id == str(current_user.organization_id),
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found"
        )
    if integration.status == "coming_soon":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This integration is not yet available",
        )

    config = body.config
    # Validate config schema
    config = _validate_config(integration.integration_type, config)
    # Validate URLs for SSRF
    _validate_urls_in_config(config)
    # Split secrets from public config
    public_config, secrets = _extract_secrets(config)

    integration.status = "connected"
    integration.enabled = True
    integration.config = {**(integration.config or {}), **public_config}
    # Store secrets encrypted
    for key, value in secrets.items():
        integration.set_secret(key, value)
    await db.commit()
    await db.refresh(integration)

    # Audit log
    await log_audit_event(
        db,
        "integration.connected",
        "integrations",
        "info",
        {
            "user_id": current_user.id,
            "organization_id": current_user.organization_id,
            "integration_type": integration.integration_type,
            "integration_name": integration.name,
            "integration_id": integration.id,
        },
    )

    return _integration_to_dict(integration)


@router.post("/{integration_id}/disconnect")
async def disconnect_integration(
    integration_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
):
    """Disconnect an integration"""
    result = await db.execute(
        select(Integration).where(
            Integration.id == integration_id,
            Integration.organization_id == str(current_user.organization_id),
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found"
        )

    integration.status = "available"
    integration.enabled = False
    await db.commit()

    # Audit log
    await log_audit_event(
        db,
        "integration.disconnected",
        "integrations",
        "info",
        {
            "user_id": current_user.id,
            "organization_id": current_user.organization_id,
            "integration_type": integration.integration_type,
            "integration_name": integration.name,
            "integration_id": integration.id,
        },
    )

    return {"status": "disconnected"}


@router.patch("/{integration_id}")
async def update_integration(
    integration_id: str,
    request: Request,
    body: IntegrationUpdateRequest = Body(default_factory=IntegrationUpdateRequest),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
):
    """Update integration configuration"""
    result = await db.execute(
        select(Integration).where(
            Integration.id == integration_id,
            Integration.organization_id == str(current_user.organization_id),
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found"
        )

    config = body.config
    # Validate config schema
    config = _validate_config(integration.integration_type, config)
    # Validate URLs for SSRF
    _validate_urls_in_config(config)
    # Split secrets from public config
    public_config, secrets = _extract_secrets(config)

    integration.config = {**(integration.config or {}), **public_config}
    for key, value in secrets.items():
        integration.set_secret(key, value)
    await db.commit()
    await db.refresh(integration)

    # Audit log
    await log_audit_event(
        db,
        "integration.updated",
        "integrations",
        "info",
        {
            "user_id": current_user.id,
            "organization_id": current_user.organization_id,
            "integration_type": integration.integration_type,
            "integration_name": integration.name,
            "integration_id": integration.id,
        },
    )

    return _integration_to_dict(integration)


@router.post("/{integration_id}/test-connection")
async def test_connection(
    integration_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
):
    """Test connectivity for an integration"""
    result = await db.execute(
        select(Integration).where(
            Integration.id == integration_id,
            Integration.organization_id == str(current_user.organization_id),
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found"
        )

    # Delegate to the appropriate service
    from app.services.integration_services import test_integration_connection

    try:
        result_msg = await test_integration_connection(integration)
        return {"success": True, "message": result_msg}
    except Exception as e:
        return {"success": False, "message": str(e)}

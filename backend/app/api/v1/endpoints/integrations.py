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
from app.core.utils import sanitize_connector_error
from app.mcp.constants import MCP_INTEGRATION_TYPE, MCP_MOUNT_PATH
from app.mcp.keys import McpKeyService
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
        "description": (
            "Import and export data in CSV format for reporting and "
            "migration. Not yet usable as a configured integration — there "
            "is no generic import/export route here. Individual modules do "
            "ship their own working CSV exports (members, admin hours, "
            "finance, compliance reports) from their own pages."
        ),
        "category": "Data",
        "status": "coming_soon",
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
        "description": (
            "Export incident data in NFIRS 5.0 format for state fire marshal "
            "reporting. Not yet usable: The Logbook has no incident/run "
            "record to export from, and no export route is wired up. The "
            "field mapping exists in nfirs_service.py awaiting an incident "
            "module."
        ),
        "category": "Reporting",
        "status": "coming_soon",
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
        "description": (
            "Import run data from any ePCR vendor (ImageTrend, ESO, Zoll, "
            "etc.) via CSV or NEMSIS XML file export. Not yet usable: the "
            "NEMSIS parser exists but there is no upload route and no "
            "incident record to import into."
        ),
        "category": "EMS",
        "status": "coming_soon",
        "contains_phi": True,
    },
    {
        "integration_type": "nemsis-export",
        "name": "NEMSIS Response Module Export",
        "description": (
            "Export dispatch and response data in NEMSIS 3.5 format for state "
            "EMS reporting. Not yet usable: there is no response record to "
            "export from and no export route is wired up. The field mapping "
            "exists in nemsis_service.py awaiting an incident module."
        ),
        "category": "EMS",
        "status": "coming_soon",
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
        "integration_type": "nfc-id-cards",
        "name": "NFC ID Cards",
        "description": (
            "Issue member ID cards carrying an NFC tag, and check members in "
            "to shifts, meetings and admin hours by tapping one against a "
            "reader. Cards are issued by an officer from the member's profile; "
            "members cannot register their own. Turn this off and no card can "
            "be issued or read."
        ),
        "category": "Access Control",
        "status": "available",
    },
    {
        "integration_type": "documenso",
        "name": "Documenso",
        "description": "Send documents for electronic signature via Documenso, the open-source DocuSign alternative. Works with Documenso Cloud or a self-hosted instance.",
        "category": "Documents",
        "status": "available",
    },
    {
        "integration_type": "calcom",
        "name": "Cal.com",
        "description": "Pull scheduled bookings from Cal.com, the open-source Calendly alternative. Surface member interviews, inspections, and appointments as Logbook events.",
        "category": "Scheduling",
        "status": "available",
    },
    {
        "integration_type": "paypal",
        "name": "PayPal",
        "description": (
            "Reconcile store payments automatically. Connect the department's "
            "own PayPal Business account and PayPal will tell Logbook what it "
            "received; captures whose reference carries a store order number "
            "settle that order without anyone marking it paid by hand. No "
            "payment is ever taken on this site."
        ),
        "category": "Payments",
        "status": "available",
    },
    {
        "integration_type": "claude-mcp",
        "name": "Claude (MCP)",
        "description": (
            "Let Claude answer questions about the department over the Model "
            "Context Protocol: rosters, schedules, training and certification "
            "status, inventory, apparatus, facilities, published minutes and "
            "documents. Personal information — phone numbers, personal email, "
            "home addresses, dates of birth, emergency contacts, medical "
            "results — is never sent, whatever the settings. Off until an IT "
            "administrator connects it and issues a service key."
        ),
        "category": "AI Assistants",
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
            # INT-4: emit ONLY the keys the caller actually supplied. A bare
            # model_dump() re-emits every field at its schema default, and the
            # connect/update handlers merge that over the stored config — so a
            # partial PATCH would silently reset omitted fields (e.g.
            # match_strategy, sync_direction) to their defaults, and empty
            # secret-named defaults (api_key="") would leak into public config.
            # Construction above still enforces required fields and validators;
            # omitted keys keep their stored value via the handler's merge, and
            # every service reads config with .get(key, default) so a partial
            # stored config stays usable.
            return validated.model_dump(exclude_unset=True)
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
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
        if k in SECRET_CONFIG_KEYS:
            # Secret-shaped keys must never fall through into plaintext config.
            # Empty strings are control values and are intentionally omitted;
            # the endpoint handles the requested deletion.
            if isinstance(v, str) and v:
                secrets[k] = v
            continue
        public[k] = v
    return public, secrets


def _secrets_to_clear_for_base_url_change(
    integration: Integration, config: dict[str, Any]
) -> set[str]:
    """Prevent a stored credential from being rebound to a new API endpoint."""
    credential_keys = {
        "documenso": "api_token",
        "calcom": "api_key",
    }
    secret_key = credential_keys.get(integration.integration_type)
    if not secret_key or "api_base_url" not in config:
        return set()

    old_url = (integration.config or {}).get("api_base_url")
    new_url = config["api_base_url"]
    if old_url == new_url or not integration.get_secret(secret_key):
        return set()

    if secret_key not in config:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"{secret_key} must be re-entered or explicitly cleared when "
                "api_base_url changes"
            ),
        )
    return {secret_key} if config[secret_key] == "" else set()


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


def _apply_type_specific_flags(integration: Integration) -> None:
    """Derive per-type row flags from the freshly merged config.

    The Claude MCP add-on is only a PHI surface when the department turns
    medical-screening status on, so the ``contains_phi`` badge follows that
    switch rather than being fixed in the catalog.
    """
    if integration.integration_type == MCP_INTEGRATION_TYPE:
        integration.contains_phi = bool(
            (integration.config or {}).get("expose_medical_screening")
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
    current_user: User = Depends(require_permission("integrations.manage")),
):
    """List all integrations for the organization.

    Integration config exposes sync targets, endpoint URLs, and PHI flags for the
    org's third-party connections — admin-tier configuration, not member data — so
    reads require the same permission as management (INT-3, owner decision
    2026-08-09). Secret values are still redacted by `_sanitize_config`.
    """
    await ensure_catalog(db, current_user.organization_id)
    result = await db.execute(
        select(Integration)
        .where(Integration.organization_id == str(current_user.organization_id))
        .order_by(Integration.name)
    )
    integrations = result.scalars().all()
    return [_integration_to_dict(i) for i in integrations]


@router.get("/connected")
async def list_connected_integration_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Connection-status projection for cross-module callers.

    The full integration list is admin-gated (INT-3), but feature modules — e.g.
    the membership pipeline's meeting-config, via `useConnectedIntegrations` — only
    need to know *which* integration types are connected, not their config. This
    endpoint returns just `integration_type`/`status`/`enabled` (no URLs, mappings,
    PHI flags, or secrets) so a non-admin module holder keeps its optional
    integration-backed affordances without being handed the configuration. Any
    authenticated member of the org may read it. Registered before
    `/{integration_id}` so the literal path wins the route match.
    """
    await ensure_catalog(db, current_user.organization_id)
    result = await db.execute(
        select(
            Integration.integration_type,
            Integration.status,
            Integration.enabled,
        ).where(Integration.organization_id == str(current_user.organization_id))
    )
    return [
        {
            "integration_type": integration_type,
            "status": row_status,
            "enabled": enabled,
        }
        for integration_type, row_status, enabled in result.all()
    ]


@router.get("/{integration_id}")
async def get_integration(
    integration_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
):
    """Get a specific integration (see `list_integrations` for the access rationale)."""
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
    clear_salesforce_refresh_token = (
        integration.integration_type == "salesforce"
        and "refresh_token" in config
        and config["refresh_token"] == ""
    )
    secrets_to_clear = _secrets_to_clear_for_base_url_change(integration, config)
    # Validate config schema
    config = _validate_config(integration.integration_type, config)
    # Validate URLs for SSRF
    _validate_urls_in_config(config)
    # Split secrets from public config
    public_config, secrets = _extract_secrets(config)

    integration.status = "connected"
    integration.enabled = True
    integration.config = {**(integration.config or {}), **public_config}
    _apply_type_specific_flags(integration)
    # Store secrets encrypted
    for key, value in secrets.items():
        integration.set_secret(key, value)
    for key in secrets_to_clear:
        integration.clear_secret(key)
    if clear_salesforce_refresh_token:
        # An explicit blank switches Salesforce from the interactive refresh
        # grant to client credentials. Discard the cached access token as well
        # so the next sync obtains client credentials immediately rather than
        # continuing as the previous OAuth user until that token expires.
        # Omission still means "leave unchanged."
        integration.clear_secret("refresh_token")
        integration.clear_secret("access_token")
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
    clear_salesforce_refresh_token = (
        integration.integration_type == "salesforce"
        and "refresh_token" in config
        and config["refresh_token"] == ""
    )
    secrets_to_clear = _secrets_to_clear_for_base_url_change(integration, config)
    # PATCH validation includes stored public settings so callers can update or
    # clear one secret without resending unrelated required configuration.
    validation_config = {**(integration.config or {}), **config}
    config = _validate_config(integration.integration_type, validation_config)
    # Validate URLs for SSRF
    _validate_urls_in_config(config)
    # Split secrets from public config
    public_config, secrets = _extract_secrets(config)

    integration.config = {**(integration.config or {}), **public_config}
    _apply_type_specific_flags(integration)
    for key, value in secrets.items():
        integration.set_secret(key, value)
    for key in secrets_to_clear:
        integration.clear_secret(key)
    if clear_salesforce_refresh_token:
        integration.clear_secret("refresh_token")
        integration.clear_secret("access_token")
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


async def _test_mcp_connection(
    db: AsyncSession, integration: Integration
) -> dict[str, Any]:
    """There is nothing external to reach; report what a client would find."""
    if not integration.enabled or integration.status != "connected":
        return {"success": False, "message": "Connect the integration first"}
    active = await McpKeyService(db).active_keys(integration.organization_id)
    if not active:
        return {
            "success": False,
            "message": (
                "Connected, but no service key has been issued yet — an IT "
                "administrator can issue one from the Service key panel."
            ),
        }
    key = active[0]
    expiry = (
        f"expires {key.expires_at.date().isoformat()}"
        if key.expires_at
        else "no expiry"
    )
    return {
        "success": True,
        "message": (
            f"MCP endpoint ready at {MCP_MOUNT_PATH}; active key "
            f"{key.key_prefix}… ({expiry})."
        ),
    }


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

    if integration.integration_type == MCP_INTEGRATION_TYPE:
        return await _test_mcp_connection(db, integration)

    # Delegate to the appropriate service
    from app.services.integration_services import test_integration_connection

    try:
        result_msg = await test_integration_connection(integration)
        return {"success": True, "message": result_msg}
    except Exception as e:
        # Most failure paths here raise a hand-authored, safe message (e.g.
        # "Salesforce rejected these credentials") as bare Exception, or as
        # PayPalError for the PayPal connector. Several test_connection
        # implementations don't wrap every outbound call, so an unhandled
        # infra-level exception (DNS, TLS, timeout) can still reach here —
        # sanitize_connector_error only trusts those two exact types and
        # generic-fallbacks anything else, since a raw infra message has no
        # fixed vocabulary sanitize_error_message's blacklist could catch
        # (INT-6 follow-up).
        from app.services.integration_services.paypal_service import PayPalError

        return {
            "success": False,
            "message": sanitize_connector_error(e, trusted_types=(PayPalError,)),
        }

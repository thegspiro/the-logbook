"""
Integrations API Endpoints

Endpoints for managing external integration configurations.
"""

import re
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, NotRequired, Optional, TypedDict

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, status
from pydantic import ValidationError
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import (
    get_current_user,
    require_permission,
    require_stepup,
    user_has_permission,
)
from app.api.v1.endpoints.mcp_keys import require_audit_entry
from app.core.audit import log_audit_event
from app.core.config import settings
from app.core.database import get_db
from app.core.security_middleware import check_rate_limit, get_client_ip
from app.core.utils import sanitize_connector_error
from app.mcp.constants import MCP_INTEGRATION_TYPE, MCP_MOUNT_PATH
from app.mcp.keys import McpKeyService
from app.mcp.oauth import McpOAuthService
from app.models.directory_account import MICROSOFT_365_INTEGRATION
from app.models.integration import (
    CalendarSyncMapping,
    Integration,
    IntegrationSyncLog,
)
from app.models.user import User
from app.schemas.integration import (
    CALENDAR_OAUTH_MANAGED_KEYS,
    INTEGRATION_CONFIG_SCHEMAS,
    SECRET_CONFIG_KEYS,
    ActiveWeatherAlertResponse,
    IntegrationConnectRequest,
    IntegrationUpdateRequest,
)
from app.services.calendar_sync_service import has_credentials
from app.services.directory_account_service import PROVIDERS as DIRECTORY_PROVIDERS
from app.services.integration_health import (
    finish_integration_run,
    health_state,
    record_integration_run,
    sanitize_integration_error,
    start_integration_run,
    sync_log_to_dict,
)
from app.services.integration_services import calendar_oauth_common as calendar_oauth
from app.services.integration_services import (
    google_calendar_oauth_service as gcal_oauth,
)
from app.services.integration_services.directory_common import DirectoryProviderInfo
from app.services.integration_services.ical_service import (
    ICAL_INTEGRATION_TYPE,
    ORG_FEED_TOKEN_HASH_KEY,
    ORG_FEED_TOKEN_SECRET,
    generate_feed_token,
    hash_feed_token,
    org_feed_path,
    org_feed_token_matches,
)
from app.services.integration_services.microsoft_365_service import (
    client_secret_days_left,
    client_secret_warning_level,
)
from app.utils.org_timezone import resolve_org_today
from app.utils.url_validator import validate_integration_url

router = APIRouter()

# Integration types whose Retry Sync re-runs a data sync; every other type's
# Retry Sync re-checks its connection, since it has nothing to synchronize.
SYNC_CAPABLE_TYPES = frozenset({"salesforce"})

# Minimum gap between two Retry Sync runs of one integration. A retry calls
# the provider for real — a Salesforce sync pushes every member — so it is
# limited per integration, not only per caller IP.
RETRY_SYNC_COOLDOWN_SECONDS = 60

# Pattern for secret-like keys in config
_SECRET_KEY_PATTERN = re.compile(
    r"(token|secret|key|password|api_key|auth|webhook_url|refresh_token|client_secret)",
    re.IGNORECASE,
)


class _CatalogEntry(TypedDict):
    integration_type: str
    name: str
    description: str
    category: str
    status: str
    contains_phi: NotRequired[bool]


# Default integration catalog - seeded for new orgs
INTEGRATION_CATALOG: list[_CatalogEntry] = [
    {
        "integration_type": "google-calendar",
        "name": "Google Calendar",
        "description": (
            "Publish department events one way to a dedicated calendar that "
            "The Logbook creates in the department's Google account; members "
            "subscribe to that calendar. Edits made in Google are not copied "
            "back."
        ),
        "category": "Calendar",
        # Reported as coming_soon while CALENDAR_SYNC_ENABLED is off; see
        # _effective_status.
        "status": "available",
    },
    {
        "integration_type": "outlook",
        "name": "Microsoft Outlook",
        "description": (
            "Publish department events one way to a dedicated calendar that "
            "The Logbook creates in the department's Microsoft 365 account; "
            "members subscribe to that calendar. Edits made in Outlook are not "
            "copied back."
        ),
        "category": "Calendar",
        # Reported as coming_soon while CALENDAR_SYNC_ENABLED is off; see
        # _effective_status.
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
        "description": (
            "A read-only subscribe link to the department's published events "
            "— title, time, location and type, no descriptions or attendee "
            "details. Works with Apple Calendar, Google Calendar, Outlook and "
            "any app that subscribes to an iCal URL."
        ),
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
        "integration_type": "google-workspace",
        "name": "Google Workspace",
        "description": (
            "Create a Google Workspace account for each applicant the "
            "department converts to a member, at their department email "
            "address, and add it to the groups you choose. Uses a service "
            "account with domain-wide delegation. Only an organization "
            "administrator can connect or change it."
        ),
        "category": "Access Control",
        "status": "available",
    },
    {
        "integration_type": "microsoft-365",
        "name": "Microsoft 365",
        "description": (
            "Create a Microsoft 365 account for each applicant the department "
            "converts to a member, at their department email address, license "
            "it and add it to the groups you choose. Uses an Entra ID "
            "application with Microsoft Graph permissions. Only an "
            "organization administrator can connect or change it, and only "
            "one of Google Workspace and Microsoft 365 can be connected."
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
        "integration_type": "zeffy",
        "name": "Zeffy",
        "description": (
            "Read donations, event tickets and memberships sold through the "
            "department's Zeffy account into the Logbook. Link each Zeffy "
            "campaign to a fundraising campaign, fundraising event or dues "
            "schedule, and its payments are recorded there as they arrive, "
            "including refunds. Read-only: nothing is ever changed in Zeffy, "
            "and Zeffy keeps issuing the tax receipts."
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
            "documents. Member records never carry personal information — "
            "phone numbers, email, home addresses, dates of birth, emergency "
            "contacts, medical results — whatever the settings, and free text "
            "is scrubbed of phone numbers and email addresses; other details "
            "typed into published content pass through. Off until an IT "
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


_CATALOG_BY_TYPE: dict[str, _CatalogEntry] = {
    item["integration_type"]: item for item in INTEGRATION_CATALOG
}

# One-way publishing to Google/Outlook. While CALENDAR_SYNC_ENABLED is off
# these two are reported as coming soon whatever their stored row says. With
# it on, a row only counts as connected once the provider sign-in has left
# tokens and a calendar on it: an older release let these be "connected" with
# an empty config, and such a row never published anything.
CALENDAR_PUBLISH_TYPES = frozenset({"google-calendar", "outlook"})

# The button that connects each calendar card; the generic connect refuses them.
_CALENDAR_SIGN_IN_LABELS = {
    gcal_oauth.GOOGLE_CALENDAR_INTEGRATION_TYPE: "Connect with Google",
    "outlook": "Connect with Microsoft",
}

# Config keys only the server writes. A client-supplied value is refused by
# the type's schema (extra="forbid"); the stored value is left out of the
# PATCH validation merge so it does not trip that same check.
_SERVER_MANAGED_CONFIG_KEYS: dict[str, frozenset[str]] = {
    ICAL_INTEGRATION_TYPE: frozenset({ORG_FEED_TOKEN_HASH_KEY}),
    **{itype: CALENDAR_OAUTH_MANAGED_KEYS for itype in CALENDAR_PUBLISH_TYPES},
}


# ============================================================
# Helpers
# ============================================================


def _calendar_publish_unavailable(integration: Integration) -> bool:
    return (
        integration.integration_type in CALENDAR_PUBLISH_TYPES
        and not settings.CALENDAR_SYNC_ENABLED
    )


def _calendar_connected_without_grant(integration: Integration) -> bool:
    if (
        integration.integration_type not in CALENDAR_PUBLISH_TYPES
        or integration.status != "connected"
    ):
        return False
    return not (
        (integration.config or {}).get("calendar_id") and has_credentials(integration)
    )


def _effective_status(integration: Integration) -> str:
    if _calendar_publish_unavailable(integration):
        return "coming_soon"
    if _calendar_connected_without_grant(integration):
        return "available"
    return str(integration.status)


def _effective_enabled(integration: Integration) -> bool:
    if _calendar_publish_unavailable(integration) or _calendar_connected_without_grant(
        integration
    ):
        return False
    return bool(integration.enabled)


def _reject_oauth_managed_keys(
    integration: Integration, config: dict[str, Any]
) -> None:
    """Refuse a hand-typed token, calendar or account on a calendar integration.

    Those come only from the provider sign-in. A typed refresh token would
    publish into whatever account it belongs to, and a typed calendar id into
    whatever calendar it names — the department's own primary calendar
    included.
    """
    if integration.integration_type not in CALENDAR_PUBLISH_TYPES:
        return
    supplied = sorted(CALENDAR_OAUTH_MANAGED_KEYS.intersection(config))
    if supplied:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"{', '.join(supplied)} cannot be entered: {integration.name} "
                "sets it when an administrator signs in with the provider"
            ),
        )


def _require_available(integration: Integration) -> None:
    if _effective_status(integration) == "coming_soon":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This integration is not yet available",
        )


def _has_ical_feed_token(integration: Integration) -> bool:
    return bool((integration.config or {}).get(ORG_FEED_TOKEN_HASH_KEY))


def _issue_ical_feed_token(integration: Integration) -> str:
    """Give the department feed a new token, invalidating the previous URL."""
    # Same shape and length as the personal shifts feed token, so the public
    # route's length check applies to both.
    token = generate_feed_token()[:64]
    integration.set_secret(ORG_FEED_TOKEN_SECRET, token)
    integration.config = {
        **(integration.config or {}),
        ORG_FEED_TOKEN_HASH_KEY: hash_feed_token(token),
    }
    return token


def _clear_ical_feed_token(integration: Integration) -> None:
    integration.clear_secret(ORG_FEED_TOKEN_SECRET)
    config = dict(integration.config or {})
    config.pop(ORG_FEED_TOKEN_HASH_KEY, None)
    integration.config = config


async def _clear_calendar_connection(
    db: AsyncSession, integration: Integration
) -> tuple[str | None, int]:
    """Forget a calendar integration's grant, calendar and sync history.

    Returns the grant to revoke with the provider (the refresh token, else
    the access token) and how many mapping rows were deleted. The mappings
    point at a calendar the next connect will not use — it creates a new
    one — so keeping them would leave every unchanged event unpublished
    there. The external calendar itself is left alone: members may still be
    subscribed to it, and it is the department's to delete.
    """
    grant = integration.get_secret("refresh_token") or integration.get_secret(
        "access_token"
    )
    for key in calendar_oauth.TOKEN_SECRETS:
        integration.clear_secret(key)
    config = dict(integration.config or {})
    for key in calendar_oauth.CONNECTION_CONFIG_KEYS:
        config.pop(key, None)
    integration.config = config
    result = await db.execute(
        delete(CalendarSyncMapping).where(
            CalendarSyncMapping.organization_id == str(integration.organization_id),
            CalendarSyncMapping.integration_id == str(integration.id),
        )
    )
    return grant, int(getattr(result, "rowcount", 0) or 0)


def _stored_config_for_validation(integration: Integration) -> dict[str, Any]:
    managed = _SERVER_MANAGED_CONFIG_KEYS.get(integration.integration_type, ())
    stored = {k: v for k, v in (integration.config or {}).items() if k not in managed}
    if (
        integration.integration_type in CALENDAR_PUBLISH_TYPES
        and stored.get("sync_direction", "push") != "push"
    ):
        # Rows saved before publishing became push-only may hold "pull" or
        # "both". Nothing reads it — the reconciler only pushes — so the old
        # value must not make every later settings change fail validation.
        stored.pop("sync_direction")
    return stored


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


def _iso(value: Any) -> str | None:
    return value.isoformat() if isinstance(value, datetime) else None


def _credential_days_left(
    integration: Integration, today: Optional[date]
) -> int | None:
    """Days until the stored credential stops working, where it is known.

    Only Microsoft 365 records it (an administrator types in the client
    secret's expiry date). *today* is the department's date, as the morning
    email counts it; without one nothing is reported.
    """
    if integration.integration_type != MICROSOFT_365_INTEGRATION or today is None:
        return None
    return client_secret_days_left(integration.config or {}, today)


def _integration_to_dict(
    integration: Integration,
    *,
    sanitize_secrets: bool = True,
    today: Optional[date] = None,
) -> dict[str, Any]:
    """Convert an Integration model to a response dict."""
    config = integration.config or {}
    if sanitize_secrets:
        config = _sanitize_config(config)
    # The row's description is a copy taken when the catalog was seeded for
    # the org; the catalog is what describes the integration as it is today.
    catalog = _CATALOG_BY_TYPE.get(integration.integration_type)
    credential_days_left = _credential_days_left(integration, today)
    return {
        "id": integration.id,
        "organization_id": integration.organization_id,
        "integration_type": integration.integration_type,
        "name": integration.name,
        "description": catalog["description"] if catalog else integration.description,
        "category": integration.category,
        "status": _effective_status(integration),
        "config": config,
        "enabled": _effective_enabled(integration),
        "contains_phi": integration.contains_phi,
        "last_sync_at": (
            integration.last_sync_at.isoformat() if integration.last_sync_at else None
        ),
        "last_success_at": _iso(getattr(integration, "last_success_at", None)),
        "last_error": getattr(integration, "last_error", None),
        "last_error_at": _iso(getattr(integration, "last_error_at", None)),
        "consecutive_error_count": int(
            getattr(integration, "consecutive_error_count", 0) or 0
        ),
        "credential_days_left": credential_days_left,
        "credential_expiring": client_secret_warning_level(credential_days_left)
        is not None,
        "health": health_state(integration),
        "supports_sync": integration.integration_type in SYNC_CAPABLE_TYPES,
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
            supplied: dict[str, Any] = validated.model_dump(exclude_unset=True)
            return supplied
        except ValidationError as e:
            # SEC4-2: only Pydantic's own verdict is echoed. A bare
            # ``except Exception`` here reported any internal failure — an
            # AttributeError inside a field validator, a TypeError from a
            # malformed stored config — to the client as a 422 with the raw
            # Python message in it, which is both an internals disclosure and
            # the wrong status for a server-side fault. Anything that is not a
            # validation verdict now propagates and becomes a generic 500.
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Invalid config for {integration_type}: {e}",
            )
    return config


# INT2-3, owner decision 2026-10-27: these connected with no credential and
# showed connected and enabled until a test failed. Their config schemas keep
# each credential optional with a "" default, because a partial PATCH is
# validated against the same schema, so connect checks them by name instead.
_CREDENTIALS_REQUIRED_TO_CONNECT: dict[str, tuple[str, ...]] = {
    "paypal": ("client_id", "client_secret"),
    "zeffy": ("api_key",),
    "documenso": ("api_token",),
    "calcom": ("api_key",),
    "salesforce": ("client_id", "client_secret"),
}


def _missing_required_fields(
    integration: Integration, config: dict[str, Any]
) -> list[str]:
    """Required settings neither this request nor the stored integration holds.

    W73: ``_validate_config`` checks only a non-empty body, so connecting with
    ``{}`` left Slack "connected" with no webhook. An empty body is still
    right for a reconnect, whose settings were kept on disconnect, so a field
    counts as present if it is stored — in the public config or as a secret.
    """
    schema_cls = INTEGRATION_CONFIG_SCHEMAS.get(integration.integration_type)
    if schema_cls is None:
        return []
    stored = integration.config or {}
    missing = [
        name
        for name, field in schema_cls.model_fields.items()
        if field.is_required()
        and name not in config
        and name not in stored
        and not integration.get_secret(name)
    ]
    # Blank counts as absent here: these schemas default each credential to
    # "", so a body of {"client_id": ""} would otherwise pass for one.
    missing += [
        name
        for name in _CREDENTIALS_REQUIRED_TO_CONNECT.get(
            integration.integration_type, ()
        )
        if name not in missing
        and not config.get(name)
        and not stored.get(name)
        and not integration.get_secret(name)
    ]
    return missing


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


# The one setting without which these integrations have nothing to send to.
_DESTINATION_KEYS = {
    "slack": "webhook_url",
    "discord": "webhook_url",
    "microsoft-teams": "webhook_url",
    "generic-webhook": "url",
}


def _require_destination(integration: Integration, config: dict[str, Any]) -> None:
    """Refuse to leave a chat or webhook integration connected with nowhere to post.

    The config schemas type the URL as a plain ``str``, so ``""`` satisfies
    them. A blank secret means "keep the stored one", but on a first connect
    there is none, which produced a green "connected" badge on an integration
    whose every send fails with "No webhook URL configured". A reconnect after
    a disconnect still works with a blank secret, because disconnecting keeps
    it. The generic webhook's ``url`` is public config, so a blank there is the
    value, not a request to keep: it overwrites the stored one in the merge.
    """
    key = _DESTINATION_KEYS.get(integration.integration_type)
    if key is None:
        return
    supplied = config.get(key)
    if key in SECRET_CONFIG_KEYS:
        effective = (supplied.strip() if isinstance(supplied, str) else "") or (
            integration.get_secret(key) or ""
        )
    elif key in config:
        effective = supplied.strip() if isinstance(supplied, str) else ""
    else:
        effective = (integration.config or {}).get(key) or ""
    if not effective:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Enter the webhook URL for {integration.name}",
        )


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


# The integrations that provision member accounts, by integration type.
DIRECTORY_INTEGRATIONS: dict[str, DirectoryProviderInfo] = {
    info.integration_type: info for info in DIRECTORY_PROVIDERS.values()
}
# Each directory's stored credential, and what to ask for when it is missing.
_DIRECTORY_CREDENTIAL = {
    "google": ("service_account_key", "Upload the service account's JSON key file"),
    "microsoft": ("client_secret", "Enter the application's client secret"),
}


def _directory_provider(integration: Integration) -> Optional[DirectoryProviderInfo]:
    """The directory an integration provisions accounts into, if it is one."""
    return DIRECTORY_INTEGRATIONS.get(integration.integration_type)


def _require_directory_admin(integration: Integration, user: User) -> None:
    """Directory integration changes need an organization administrator.

    A Google Workspace service-account key or a Microsoft 365 application can
    create and suspend accounts anywhere in the department's domain, so
    ``integrations.manage`` alone is not enough to connect, change or
    disconnect one (owner decision, 2026-10-15). ``admin.access`` is what the
    Fire Chief, President and IT Manager positions hold by default.
    """
    info = _directory_provider(integration)
    if info is None:
        return
    if not user_has_permission(user, "admin.access"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Only an organization administrator can change {info.product}",
        )


async def _check_directory_ready(
    db: AsyncSession, integration: Integration, config: dict[str, Any]
) -> None:
    """Refuse a directory setup that could never create an account.

    Accounts are created at the member's department email address, so the
    department email setting has to be on and on the same domain; a first
    connection has to bring its credential; and only one directory may be
    connected at a time, since each member has one account record and a
    conversion creates it in whichever directory is connected (owner
    decision, 2026-10-16).
    """
    info = _directory_provider(integration)
    if info is None:
        return
    secret_key, secret_prompt = _DIRECTORY_CREDENTIAL[info.provider]
    if not config.get(secret_key) and not integration.get_secret(secret_key):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=secret_prompt,
        )
    other = (
        await db.execute(
            select(Integration).where(
                Integration.organization_id == integration.organization_id,
                Integration.id != integration.id,
                Integration.integration_type.in_(list(DIRECTORY_INTEGRATIONS)),
                Integration.status == "connected",
                Integration.enabled.is_(True),
            )
        )
    ).scalar_one_or_none()
    if other is not None:
        other_info = DIRECTORY_INTEGRATIONS[other.integration_type]
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"{other_info.product} is connected. Disconnect it before "
                f"connecting {info.product}: a department provisions accounts "
                "in one directory at a time."
            ),
        )
    from app.services.organization_service import OrganizationService

    org_settings = await OrganizationService(db).get_organization_settings(
        integration.organization_id
    )
    dept = org_settings.department_email
    domain = str(config.get("domain") or "").lower()
    if not dept.enabled or (dept.domain or "").strip().lower() != domain:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                "Turn on department email addresses for the domain "
                f"{domain} in Organization Settings first; {info.vendor} "
                "accounts are created at those addresses."
            ),
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
    today = await resolve_org_today(db, current_user.organization_id)
    return [_integration_to_dict(i, today=today) for i in integrations]


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
        select(Integration).where(
            Integration.organization_id == str(current_user.organization_id)
        )
    )
    return [
        {
            "integration_type": integration.integration_type,
            "status": _effective_status(integration),
            "enabled": _effective_enabled(integration),
        }
        for integration in result.scalars().all()
    ]


@router.get("/weather/active-alerts", response_model=list[ActiveWeatherAlertResponse])
async def list_active_weather_alerts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The department's active Severe and Extreme weather alerts, for its banner.

    Any signed-in member may read it: it is the National Weather Service's
    public bulletin for the department's own zone, filtered to the caller's
    organization. Empty unless the department's NWS Weather Alerts integration
    is enabled with the dashboard banner on (owner decision 2026-10-29).
    Registered before ``/{integration_id}`` so the literal path wins.
    """
    from app.services.weather_alert_service import (
        active_alerts,
        channels,
        weather_integration,
    )

    org_id = str(current_user.organization_id)
    integration = await weather_integration(db, org_id)
    if integration is None or not channels(integration)["banner"]:
        return []
    return [
        {
            "id": row.id,
            "event": row.event,
            "severity": row.severity,
            "headline": row.headline,
            "instruction": row.instruction,
            "area_desc": row.area_desc,
            "onset": row.onset,
            "expires": row.expires,
        }
        for row in await active_alerts(db, org_id)
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
    return _integration_to_dict(
        integration,
        today=await resolve_org_today(db, integration.organization_id),
    )


@router.post("/{integration_id}/connect")
async def connect_integration(
    integration_id: str,
    request: Request,
    body: IntegrationConnectRequest = Body(default_factory=IntegrationConnectRequest),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
    _stepup: User = Depends(require_stepup),
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
    _require_available(integration)
    _require_directory_admin(integration, current_user)
    _reject_oauth_managed_keys(integration, body.config)
    if integration.integration_type in _CALENDAR_SIGN_IN_LABELS:
        # Connected means a provider grant and a calendar to publish into,
        # and only the sign-in produces those. Settings go through PATCH.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Use {_CALENDAR_SIGN_IN_LABELS[integration.integration_type]} "
                f"to connect {integration.name}"
            ),
        )
    was_connected = integration.status == "connected" and bool(integration.enabled)

    config = body.config
    missing = _missing_required_fields(integration, config)
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{integration.name} needs: {', '.join(missing)}",
        )
    clear_salesforce_refresh_token = (
        integration.integration_type == "salesforce"
        and "refresh_token" in config
        and config["refresh_token"] == ""
    )
    secrets_to_clear = _secrets_to_clear_for_base_url_change(integration, config)
    # Validate config schema
    config = _validate_config(integration.integration_type, config)
    _require_destination(integration, config)
    await _check_directory_ready(db, integration, config)
    # Validate URLs for SSRF
    _validate_urls_in_config(config)
    # Split secrets from public config
    public_config, secrets = _extract_secrets(config)

    integration.status = "connected"
    integration.enabled = True
    integration.config = {**(integration.config or {}), **public_config}
    _apply_type_specific_flags(integration)
    if integration.integration_type == ICAL_INTEGRATION_TYPE and (
        not was_connected or not _has_ical_feed_token(integration)
    ):
        # A fresh connection gets a fresh URL: one handed out before a
        # disconnect must not start working again on reconnect.
        _issue_ical_feed_token(integration)
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
        # Attribution columns, not only payload keys: the audit endpoints
        # filter on AuditLog.organization_id, so an entry stamped only inside
        # event_data never shows in the department's trail.
        user_id=str(current_user.id),
        organization_id=str(current_user.organization_id),
    )

    return _integration_to_dict(
        integration,
        today=await resolve_org_today(db, integration.organization_id),
    )


@router.post("/{integration_id}/disconnect")
async def disconnect_integration(
    integration_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
    _stepup: User = Depends(require_stepup),
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

    # Disconnecting writes status="available", which is exactly what the
    # connect endpoint's coming_soon gate checks for. Letting it through would
    # promote an unreleased integration to connectable with one extra call.
    if integration.status == "coming_soon":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This integration is not yet available",
        )
    _require_directory_admin(integration, current_user)

    integration.status = "available"
    integration.enabled = False
    calendar_grant: str | None = None
    calendar_mappings_removed = 0
    if integration.integration_type in CALENDAR_PUBLISH_TYPES:
        calendar_grant, calendar_mappings_removed = await _clear_calendar_connection(
            db, integration
        )
    if integration.integration_type == ICAL_INTEGRATION_TYPE:
        # Every calendar app subscribed to the feed stops receiving it now,
        # not merely while the row reads disconnected.
        _clear_ical_feed_token(integration)
    # A service key must not outlive the connection it was issued for: left
    # in place it would work again the moment the integration was
    # reconnected, before anybody chose to issue a key.
    revoked_keys = []
    if integration.integration_type == MCP_INTEGRATION_TYPE:
        revoked_keys = await McpKeyService(db).revoke_all(
            str(current_user.organization_id), revoked_by=str(current_user.id)
        )
    for key in revoked_keys:
        entry = await log_audit_event(
            db,
            "mcp.key_revoked",
            "integrations",
            "warning",
            {
                "key_id": key.id,
                "key_prefix": key.key_prefix,
                "name": key.name,
                "reason": "integration_disconnected",
            },
            user_id=str(current_user.id),
            organization_id=str(current_user.organization_id),
            ip_address=get_client_ip(request),
        )
        # Same rule as the key endpoints: a revocation nobody can trace is
        # refused, and the whole disconnect rolls back with it.
        await require_audit_entry(db, entry, "revoked on disconnect")
    if integration.integration_type == MCP_INTEGRATION_TYPE:
        # Members' OAuth connections end with the integration too, for the
        # same reason as the keys: reconnecting must not silently revive
        # them. Registered clients stay, so reconnecting does not mean
        # re-registering every client.
        ended = await McpOAuthService(db).revoke_all_for_org(
            str(current_user.organization_id), revoked_by=str(current_user.id)
        )
        if ended:
            entry = await log_audit_event(
                db,
                "mcp.oauth_grant_revoked",
                "integrations",
                "warning",
                {"count": ended, "reason": "integration_disconnected"},
                user_id=str(current_user.id),
                organization_id=str(current_user.organization_id),
                ip_address=get_client_ip(request),
            )
            await require_audit_entry(
                db, entry, "revoked on disconnect", subject="connection"
            )
    await db.commit()

    disconnect_details: dict[str, Any] = {}
    if integration.integration_type in CALENDAR_PUBLISH_TYPES:
        # After the commit, so a slow or failing provider cannot hold the
        # disconnect open or undo it: the tokens are already gone from here.
        # Outlook is never revoked: the Microsoft identity platform has no
        # endpoint for an app to revoke one grant (see
        # outlook_calendar_oauth_service), so forgetting it here is all an
        # app can do.
        revoked = False
        if integration.integration_type == gcal_oauth.GOOGLE_CALENDAR_INTEGRATION_TYPE:
            revoked = await gcal_oauth.revoke_token(calendar_grant)
        disconnect_details = {
            "grant_revoked": revoked,
            "calendar_mappings_removed": calendar_mappings_removed,
        }

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
            **disconnect_details,
        },
        # Attribution columns, not only payload keys: the audit endpoints
        # filter on AuditLog.organization_id, so an entry stamped only inside
        # event_data never shows in the department's trail.
        user_id=str(current_user.id),
        organization_id=str(current_user.organization_id),
    )

    return {"status": "disconnected"}


@router.patch("/{integration_id}")
async def update_integration(
    integration_id: str,
    request: Request,
    body: IntegrationUpdateRequest = Body(default_factory=IntegrationUpdateRequest),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
    _stepup: User = Depends(require_stepup),
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
    _require_available(integration)
    _require_directory_admin(integration, current_user)
    _reject_oauth_managed_keys(integration, config)
    validation_config = {**_stored_config_for_validation(integration), **config}
    config = _validate_config(integration.integration_type, validation_config)
    if integration.status == "connected":
        _require_destination(integration, config)
    await _check_directory_ready(db, integration, config)
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

    # Audit log, in the same transaction as the change.
    entry = await log_audit_event(
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
        # Attribution columns, not only payload keys: the audit endpoints
        # filter on AuditLog.organization_id, so an entry stamped only inside
        # event_data never shows in the department's trail.
        user_id=str(current_user.id),
        organization_id=str(current_user.organization_id),
    )
    # The Claude (MCP) configuration is what a live service key may read
    # and write; widening it without a record is refused, the way a key
    # change is. Other integrations keep the best-effort audit.
    if integration.integration_type == MCP_INTEGRATION_TYPE:
        await require_audit_entry(db, entry, "updated", subject="configuration")
    await db.commit()
    await db.refresh(integration)

    return _integration_to_dict(
        integration,
        today=await resolve_org_today(db, integration.organization_id),
    )


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

    _require_available(integration)
    if integration.integration_type == MCP_INTEGRATION_TYPE:
        return await _test_mcp_connection(db, integration)

    # Delegate to the appropriate service
    from app.services.integration_services import test_integration_connection

    started = time.monotonic()
    try:
        result_msg = await test_integration_connection(integration)
        await record_integration_run(
            db,
            integration,
            operation="connection_test",
            trigger="manual",
            success=True,
            user_id=str(current_user.id),
            started_monotonic=started,
        )
        await db.commit()
        return {"success": True, "message": result_msg}
    except Exception as e:
        await record_integration_run(
            db,
            integration,
            operation="connection_test",
            trigger="manual",
            success=False,
            error=e,
            user_id=str(current_user.id),
            started_monotonic=started,
        )
        await db.commit()
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
        from app.services.integration_services.zeffy_service import ZeffyError

        return {
            "success": False,
            "message": sanitize_connector_error(
                e, trusted_types=(PayPalError, ZeffyError)
            ),
        }


# ============================================================
# Department iCalendar (ICS) feed
# ============================================================


async def _get_connected_ical(
    db: AsyncSession, integration_id: str, organization_id: str
) -> Integration:
    integration = await _get_org_integration(
        db, integration_id, organization_id, lock=True
    )
    if integration.integration_type != ICAL_INTEGRATION_TYPE:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found"
        )
    if not integration.enabled or integration.status != "connected":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Connect the iCalendar integration first.",
        )
    return integration


@router.get("/{integration_id}/ical-feed")
async def get_ical_feed(
    integration_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
):
    """The department events feed's subscribe path. Requires `integrations.manage`.

    The path carries the feed's bearer token, so it is only ever returned
    here. A connection made before the feed had a token is given one on
    first read.
    """
    integration = await _get_connected_ical(
        db, integration_id, current_user.organization_id
    )
    token = integration.get_secret(ORG_FEED_TOKEN_SECRET)
    if not token or not org_feed_token_matches(integration.config, token):
        token = _issue_ical_feed_token(integration)
        await log_audit_event(
            db,
            "integration.ical_feed_issued",
            "integrations",
            "info",
            {"integration_id": integration.id, "integration_type": "ical"},
            user_id=str(current_user.id),
            organization_id=str(current_user.organization_id),
            ip_address=get_client_ip(request),
        )
        await db.commit()
    return {"token": token, "feed_path": org_feed_path(token)}


@router.post("/{integration_id}/ical-feed/rotate")
async def rotate_ical_feed(
    integration_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
):
    """Replace the department feed's token. Requires `integrations.manage`.

    The previous subscribe URL stops working at once; every calendar
    subscribed to it has to be given the new one.
    """
    integration = await _get_connected_ical(
        db, integration_id, current_user.organization_id
    )
    token = _issue_ical_feed_token(integration)
    await log_audit_event(
        db,
        "integration.ical_feed_rotated",
        "integrations",
        "warning",
        {"integration_id": integration.id, "integration_type": "ical"},
        user_id=str(current_user.id),
        organization_id=str(current_user.organization_id),
        ip_address=get_client_ip(request),
    )
    await db.commit()
    return {"token": token, "feed_path": org_feed_path(token)}


# ============================================================
# Health: sync history and Retry Sync
# ============================================================


async def _get_org_integration(
    db: AsyncSession, integration_id: str, organization_id: str, *, lock: bool = False
) -> Integration:
    query = select(Integration).where(
        Integration.id == integration_id,
        Integration.organization_id == str(organization_id),
    )
    if lock:
        query = query.with_for_update()
    integration: Integration | None = (await db.execute(query)).scalar_one_or_none()
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found"
        )
    return integration


@router.get("/{integration_id}/sync-history")
async def get_integration_sync_history(
    integration_id: str,
    limit: int = Query(50, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
):
    """Recent runs of one integration, newest first. Requires `integrations.manage`.

    At most the last 50 are kept. Error text was sanitized when it was stored,
    and a run's summary holds counts only, never the records that moved.
    """
    integration = await _get_org_integration(
        db, integration_id, current_user.organization_id
    )
    rows = (
        (
            await db.execute(
                select(IntegrationSyncLog)
                .where(
                    IntegrationSyncLog.integration_id == integration.id,
                    IntegrationSyncLog.organization_id
                    == str(current_user.organization_id),
                )
                .order_by(
                    IntegrationSyncLog.started_at.desc(), IntegrationSyncLog.id.desc()
                )
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return {"runs": [sync_log_to_dict(row) for row in rows]}


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


async def _run_retry(db: AsyncSession, integration: Integration) -> tuple[str, Any]:
    """Run the integration once; return (success message, counts). Raises on failure."""
    if integration.integration_type in SYNC_CAPABLE_TYPES:
        from app.services.integration_services import salesforce_sync_service

        counts = await salesforce_sync_service.run_salesforce_sync(db, integration)
        return "Salesforce sync completed", counts
    if integration.integration_type == MCP_INTEGRATION_TYPE:
        outcome = await _test_mcp_connection(db, integration)
        if not outcome["success"]:
            raise Exception(outcome["message"])
        return outcome["message"], None

    from app.services.integration_services import test_integration_connection

    return await test_integration_connection(integration), None


@router.post("/{integration_id}/retry-sync")
async def retry_integration_sync(
    integration_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
):
    """Re-run an integration now and record the result. Requires `integrations.manage`.

    A sync-capable integration (Salesforce) runs the sync its configured
    direction allows; any other integration re-checks its connection. Limited
    to 10 calls a minute per caller IP and one run per integration every
    ``RETRY_SYNC_COOLDOWN_SECONDS`` — a 429 with ``Retry-After`` otherwise.
    """
    await check_rate_limit(
        request,
        max_requests=10,
        window_seconds=60,
        lockout_seconds=300,
        scope="integration_retry_sync",
    )
    # Locked while the cooldown is checked and the run row is written, so two
    # simultaneous retries cannot both pass the check. The lock is released by
    # the commit below, before the provider is called.
    integration = await _get_org_integration(
        db, integration_id, current_user.organization_id, lock=True
    )
    if (
        not _effective_enabled(integration)
        or _effective_status(integration) != "connected"
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Connect the integration before retrying it.",
        )

    last_retry = (
        await db.execute(
            select(IntegrationSyncLog.started_at)
            .where(
                IntegrationSyncLog.integration_id == integration.id,
                IntegrationSyncLog.trigger_source == "retry",
            )
            .order_by(IntegrationSyncLog.started_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if last_retry is not None:
        wait = timedelta(seconds=RETRY_SYNC_COOLDOWN_SECONDS) - (
            now - _as_utc(last_retry)
        )
        if wait.total_seconds() > 0:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="This integration was retried moments ago. Wait a minute "
                "before retrying it again.",
                headers={"Retry-After": str(max(1, int(wait.total_seconds()) + 1))},
            )

    is_sync = integration.integration_type in SYNC_CAPABLE_TYPES
    run = await start_integration_run(
        db,
        integration,
        operation=(
            f"{integration.integration_type}_sync" if is_sync else "connection_test"
        ),
        trigger="retry",
        user_id=str(current_user.id),
    )
    await db.commit()

    error: Exception | None = None
    message = ""
    counts: Any = None
    try:
        message, counts = await _run_retry(db, integration)
    except Exception as exc:
        error = exc
        # A failed sync may have staged member updates; none of them commit.
        await db.rollback()
        await db.refresh(integration)
        await db.refresh(run)

    await finish_integration_run(
        db,
        integration,
        run,
        success=error is None,
        summary=counts if isinstance(counts, dict) else None,
        error=error,
        mark_synced=is_sync,
    )
    await log_audit_event(
        db,
        "integration.retry_sync",
        "integrations",
        "info" if error is None else "warning",
        {
            "integration_id": integration.id,
            "integration_type": integration.integration_type,
            "success": error is None,
        },
        user_id=str(current_user.id),
        organization_id=str(current_user.organization_id),
        ip_address=get_client_ip(request),
    )
    await db.commit()
    await db.refresh(integration)

    return {
        "success": error is None,
        "message": message if error is None else sanitize_integration_error(error),
        "integration": _integration_to_dict(
            integration,
            today=await resolve_org_today(db, integration.organization_id),
        ),
    }

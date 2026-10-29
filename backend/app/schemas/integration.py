"""
Integration Pydantic Schemas

Request/response schemas for the integrations API.
Includes per-integration-type config schemas with strict validation.
"""

import json
import re
from datetime import date, datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

from app.core.utils import list_within_detail_limit

# ============================================
# Shared response config (camelCase)
# ============================================

_response_config = ConfigDict(
    from_attributes=True, alias_generator=to_camel, populate_by_name=True
)


# ============================================
# Request Schemas
# ============================================


class IntegrationConnectRequest(BaseModel):
    """Request body for connecting an integration."""

    config: Dict[str, Any] = Field(default_factory=dict)


class IntegrationUpdateRequest(BaseModel):
    """Request body for updating an integration's config."""

    config: Dict[str, Any] = Field(default_factory=dict)


# ============================================
# Per-Integration Config Schemas (strict)
# ============================================
# These validate the config dict for each integration type.
# extra="forbid" rejects unknown keys to prevent injection.


class SlackConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    webhook_url: str
    channel: str = ""
    event_types: List[str] = Field(default_factory=list)


class DiscordConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    webhook_url: str
    event_types: List[str] = Field(default_factory=list)


class TeamsConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    webhook_url: str
    channel_name: str = ""


class NWSWeatherConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    zone_id: str = Field(pattern=r"^[A-Z]{2}[CZ]\d{3}$")
    alert_types: List[str] = Field(default_factory=list)
    # How members hear about a Severe or Extreme alert; the department chooses
    # (owner decision 2026-10-29). A dashboard banner while it is active, a
    # bell notice when it is issued, and an email when it is issued.
    notify_banner: bool = True
    notify_bell: bool = True
    notify_email: bool = False


class NFIRSConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    state_fdid: str
    state_code: str = Field(max_length=2)


class NEMSISConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    state_code: str = Field(max_length=2)
    agency_id: str
    nemsis_version: str = "3.5.0"


# The events a Generic Webhook can be sent, keyed by the chat dispatch ``kind``
# that raises each one (notification_dispatch). Owner decision 2026-10-29: the
# same three the chat integrations receive, each one pickable in the webhook's
# settings.
WEBHOOK_EVENT_TYPES: Dict[str, str] = {
    "event": "event.created",
    "shift": "shift.created",
    "training": "training.recorded",
}


class GenericWebhookConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str
    secret: str = ""
    # Which events the webhook is sent; empty means all of them.
    event_types: List[str] = Field(default_factory=list)

    @field_validator("event_types")
    @classmethod
    def known_event_types(cls, value: List[str]) -> List[str]:
        unknown = sorted(set(value) - set(WEBHOOK_EVENT_TYPES.values()))
        if unknown:
            raise ValueError(
                list_within_detail_limit("Unknown webhook event type(s): ", unknown)
            )
        return list(dict.fromkeys(value))


class EPCRImportConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    import_format: str = Field(pattern=r"^(csv|nemsis_xml)$")
    field_mappings: Dict[str, str] = Field(default_factory=dict)
    auto_match_members: bool = True


# Calendar publishing is one way by design, and the tokens, the calendar and
# the signed-in account come only from the provider's sign-in: the connect
# flow writes them and the API refuses them (see
# CALENDAR_OAUTH_MANAGED_KEYS). What an administrator may set is below.
class _CalendarPublishConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sync_direction: Literal["push"] = "push"
    event_types_to_sync: List[str] = Field(default_factory=list)
    # Event descriptions can carry internal notes, so they stay out of the
    # published calendar unless an administrator opts in.
    sync_descriptions: bool = False
    days_ahead: int = Field(default=180, ge=1, le=730)
    # A department's own OAuth client, overriding the deployment's sign-in
    # app. Both are stored encrypted (SECRET_CONFIG_KEYS).
    client_id: str = ""
    client_secret: str = ""


class GoogleCalendarConfig(_CalendarPublishConfig):
    pass


class OutlookCalendarConfig(_CalendarPublishConfig):
    tenant_id: str = ""


# Keys of a calendar integration's config that only the provider sign-in and
# the calendar_sync reconciler write. A hand-typed refresh token or calendar
# id would point publishing at whatever account or calendar was typed.
CALENDAR_OAUTH_MANAGED_KEYS = frozenset(
    {
        "refresh_token",
        "access_token",
        "token",
        "calendar_id",
        "calendar_name",
        "account_email",
        "token_expires_at",
        "sync_paused_until",
    }
)


class ICalConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # The feed token is not configurable: the server issues it on connect and
    # on rotate (see the ical-feed endpoints), so a client cannot pick a
    # guessable one. Empty included_event_types means every event type.
    included_event_types: List[str] = Field(default_factory=list)


class CSVImportConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # CSV import has no required config — it's configured per-import action
    pass


class SalesforceConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Accepts production (*.my.salesforce.com), sandbox
    # (*.sandbox.my.salesforce.com), and gov-cloud URLs.
    instance_url: str = Field(pattern=r"^https://[a-zA-Z0-9\-\.]+\.salesforce\.com$")
    client_id: str = ""
    client_secret: str = ""
    refresh_token: str = ""
    # If refresh_token is omitted, the backend uses Salesforce's OAuth 2.0
    # client-credentials flow for a Connected App configured with a Run As
    # integration user. No service-account password is stored or transmitted.
    api_version: str = "v62.0"
    environment: str = Field(default="production", pattern=r"^(production|sandbox)$")
    sync_direction: str = Field(default="push", pattern=r"^(push|pull|both)$")
    sync_types: List[str] = Field(default_factory=list)
    # How to reconcile members with Contacts a department already has:
    #   email          — fall back to matching by email, then adopt
    #   email_lastname — require email AND last name to match
    #   external_id    — never adopt pre-existing records (may create duplicates)
    match_strategy: str = Field(
        default="email", pattern=r"^(email|email_lastname|external_id)$"
    )
    # When True, custom fields the target org has not created yet are dropped
    # at write time instead of failing the record (for orgs still being built).
    graceful_fields: bool = True
    # When True, the background scheduler pushes/pulls this org automatically
    # every 30 minutes per sync_direction (in addition to manual sync buttons).
    auto_sync_enabled: bool = False


class DocumensoConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Defaults to Documenso Cloud; self-hosted orgs point this at their own
    # https://<host>/api/v1. SSRF-validated at the endpoint layer.
    api_base_url: str = Field(
        default="https://app.documenso.com/api/v1",
        pattern=r"^https?://.+",
    )
    api_token: str = ""
    # Optional shared secret used to verify inbound Documenso webhooks.
    webhook_secret: str = ""


class CalcomConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Defaults to Cal.com Cloud; self-hosted orgs point this at their own
    # https://<host>/api/v1. SSRF-validated at the endpoint layer.
    api_base_url: str = Field(
        default="https://api.cal.com/v1",
        pattern=r"^https?://.+",
    )
    api_key: str = ""
    # Optional shared secret used to verify inbound Cal.com webhooks.
    webhook_secret: str = ""


# Owner decision (SF-auto-apply): an exact-amount PayPal capture settles its
# order unless the department turns this off. Named once so the setup schema
# and the webhook cannot drift apart.
PAYPAL_AUTO_APPLY_DEFAULT = True


class PayPalConfig(BaseModel):
    """PayPal REST app credentials plus reconciliation behaviour.

    The department connects its own PayPal *Business* account: there is no
    platform-wide app, and no payment is ever taken on this site. PayPal
    tells us what it received; we match it to a store order.
    """

    model_config = ConfigDict(extra="forbid")

    # Sandbox first — a department should be able to prove the webhook
    # round-trips before pointing it at real money.
    environment: Literal["sandbox", "live"] = "sandbox"
    client_id: str = ""
    client_secret: str = ""
    # From the PayPal dashboard's webhook listing. Required to verify
    # signatures: PayPal's verify API keys the check on this id.
    webhook_id: str = ""
    # When off, captures are still recorded and matched but never applied —
    # a department that wants a human to press the button keeps that. The
    # setup form always sends it; the default covers a config saved without
    # it, and the webhook reads the same constant (SF-auto-apply).
    auto_apply_payments: bool = PAYPAL_AUTO_APPLY_DEFAULT


class ClaudeMcpConfig(BaseModel):
    """What the department lets an MCP client see and do.

    Nothing here widens the personal-information boundary: contact details,
    home addresses, dates of birth, emergency contacts and medical results are
    stripped by ``app.mcp.redaction`` whatever these switches say. The two
    module switches expose *statuses and totals* for the modules that are off
    by default because their data is sensitive as a whole.
    """

    model_config = ConfigDict(extra="forbid")

    # ``read_write`` additionally registers the write tools (draft events,
    # action items, reorder requests). Reads are always available.
    access_mode: Literal["read_only", "read_write"] = "read_only"
    # Budget totals and fiscal years. Off by default: financial information.
    expose_finance: bool = False
    # Screening compliance status and expiry dates only — never a result,
    # a provider or a note. Off by default: potential PHI.
    expose_medical_screening: bool = False
    # The whole duty roster, as a scheduling manager sees it. Off by
    # default: an ordinary member sees only the shifts they are eligible
    # for, so without this the shift tools show only shifts open to all
    # members.
    expose_full_schedule: bool = False
    # Medical supply stock: item counts, low stock and expiring lots. Off by
    # default: the module has its own officer, and the department decides
    # whether Claude sees it. Read-only either way — a reorder request for
    # a medical item is refused whatever this says.
    expose_medical_supplies: bool = False
    # Whether members may connect an MCP client with their own account
    # through the OAuth authorization server, in addition to the service
    # key. Off by default, and inert unless the deployment also sets
    # MCP_OAUTH_ENABLED. A member's connection never sees more than the
    # switches above allow *and* that member's own permissions allow.
    oauth_enabled: bool = False


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_DOMAIN_RE = re.compile(
    r"^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$"
)
# A Google service-account key file is about 2.3 KB; anything far past that is
# not one.
_MAX_SERVICE_ACCOUNT_KEY_BYTES = 16 * 1024
MAX_GOOGLE_WORKSPACE_GROUPS = 20


def _normalize_email(value: str, field: str) -> str:
    cleaned = value.strip().lower()
    if len(cleaned) > 255 or not _EMAIL_RE.match(cleaned):
        raise ValueError(f"{field} must be an email address")
    return cleaned


class GoogleWorkspaceConfig(BaseModel):
    """Creates a Google Workspace account for each newly converted member.

    The service account acts as ``admin_email`` through domain-wide
    delegation; that admin needs the right to create users and, when
    ``group_emails`` is set, to manage group membership.
    ``suspend_on_retirement`` makes retiring suspend the account too, as a
    drop does; it applies to members who retire while it is on.
    """

    model_config = ConfigDict(extra="forbid")

    service_account_key: str = ""
    admin_email: str
    domain: str
    org_unit_path: str = "/"
    group_emails: List[str] = Field(default_factory=list)
    suspend_on_retirement: bool = False

    @field_validator("service_account_key")
    @classmethod
    def _check_key(cls, value: str) -> str:
        if not value:
            return value
        if len(value.encode("utf-8")) > _MAX_SERVICE_ACCOUNT_KEY_BYTES:
            raise ValueError("service_account_key is too large to be a key file")
        try:
            parsed = json.loads(value)
        except ValueError:
            raise ValueError("service_account_key must be the JSON key file")
        if not isinstance(parsed, dict) or parsed.get("type") != "service_account":
            raise ValueError("service_account_key is not a service-account key file")
        for required in ("client_email", "private_key", "token_uri"):
            if not isinstance(parsed.get(required), str) or not parsed[required]:
                raise ValueError(f"service_account_key is missing {required}")
        return value

    @field_validator("admin_email")
    @classmethod
    def _check_admin(cls, value: str) -> str:
        return _normalize_email(value, "admin_email")

    @field_validator("domain")
    @classmethod
    def _check_domain(cls, value: str) -> str:
        cleaned = value.strip().lower()
        if not _DOMAIN_RE.match(cleaned):
            raise ValueError("domain must be a domain name such as firedept.org")
        return cleaned

    @field_validator("org_unit_path")
    @classmethod
    def _check_org_unit(cls, value: str) -> str:
        cleaned = value.strip() or "/"
        if not cleaned.startswith("/") or len(cleaned) > 512:
            raise ValueError("org_unit_path must start with / (for example /Members)")
        if any(ord(ch) < 32 for ch in cleaned):
            raise ValueError("org_unit_path contains control characters")
        return cleaned

    @field_validator("group_emails")
    @classmethod
    def _check_groups(cls, value: List[str]) -> List[str]:
        groups: List[str] = []
        for raw in value:
            email = _normalize_email(raw, "group_emails")
            if email not in groups:
                groups.append(email)
        if len(groups) > MAX_GOOGLE_WORKSPACE_GROUPS:
            raise ValueError(
                f"at most {MAX_GOOGLE_WORKSPACE_GROUPS} groups can be configured"
            )
        return groups


_GUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_COUNTRY_RE = re.compile(r"^[A-Z]{2}$")
MAX_MICROSOFT_365_GROUPS = 20


class Microsoft365Config(BaseModel):
    """Creates a Microsoft 365 account for each newly converted member.

    An Entra ID application with Microsoft Graph application permissions acts
    on the tenant through the client credentials flow. ``usage_location`` is
    the country every new account is given -- Microsoft will not license an
    account without one -- and ``license_sku_id``, when set, is the license
    assigned after creation (leave it empty for group-based licensing).
    ``groups`` takes a group's object ID or, for a Microsoft 365 group, its
    address; a security group without mail can only be named by its ID.
    ``client_secret_expires_on`` is the date Entra ID shows beside the secret;
    the administrators' morning email warns before it (an expired secret
    stops every account change). Reading it from Graph would need
    Application.Read.All, which can read every app registration in the
    tenant, so an administrator types it in (owner decision, 2026-10-23).
    ``suspend_on_retirement`` makes retiring block the account too, as a drop
    does; it applies to members who retire while it is on.
    """

    model_config = ConfigDict(extra="forbid")

    tenant_id: str
    client_id: str
    client_secret: str = ""
    domain: str
    usage_location: str = "US"
    license_sku_id: str = ""
    groups: List[str] = Field(default_factory=list)
    client_secret_expires_on: str = ""
    suspend_on_retirement: bool = False

    @field_validator("tenant_id")
    @classmethod
    def _check_tenant(cls, value: str) -> str:
        from app.utils.microsoft_oauth import MicrosoftOAuthError, validate_tenant_id

        try:
            return validate_tenant_id(value)
        except MicrosoftOAuthError as exc:
            raise ValueError(str(exc)) from exc

    @field_validator("client_id")
    @classmethod
    def _check_client(cls, value: str) -> str:
        from app.utils.microsoft_oauth import MicrosoftOAuthError, validate_client_id

        try:
            return validate_client_id(value)
        except MicrosoftOAuthError as exc:
            raise ValueError(str(exc)) from exc

    @field_validator("client_secret")
    @classmethod
    def _check_secret(cls, value: str) -> str:
        if len(value) > 1024 or any(ord(ch) < 32 for ch in value):
            raise ValueError("client_secret is not a client secret value")
        return value

    @field_validator("domain")
    @classmethod
    def _check_domain(cls, value: str) -> str:
        cleaned = value.strip().lower()
        if not _DOMAIN_RE.match(cleaned):
            raise ValueError("domain must be a domain name such as firedept.org")
        return cleaned

    @field_validator("usage_location")
    @classmethod
    def _check_country(cls, value: str) -> str:
        cleaned = value.strip().upper()
        if not _COUNTRY_RE.match(cleaned):
            raise ValueError(
                "usage_location must be a two-letter country code such as US"
            )
        return cleaned

    @field_validator("license_sku_id")
    @classmethod
    def _check_sku(cls, value: str) -> str:
        cleaned = value.strip().lower()
        if cleaned and not _GUID_RE.match(cleaned):
            raise ValueError("license_sku_id must be a license SKU ID (a GUID)")
        return cleaned

    @field_validator("client_secret_expires_on")
    @classmethod
    def _check_secret_expiry(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            return ""
        try:
            return date.fromisoformat(cleaned).isoformat()
        except ValueError:
            raise ValueError(
                "client_secret_expires_on must be a date such as 2027-06-30"
            ) from None

    @field_validator("groups")
    @classmethod
    def _check_groups(cls, value: List[str]) -> List[str]:
        groups: List[str] = []
        for raw in value:
            cleaned = raw.strip().lower()
            if not _GUID_RE.match(cleaned):
                cleaned = _normalize_email(raw, "groups")
            if cleaned not in groups:
                groups.append(cleaned)
        if len(groups) > MAX_MICROSOFT_365_GROUPS:
            raise ValueError(
                f"at most {MAX_MICROSOFT_365_GROUPS} groups can be configured"
            )
        return groups


# Map integration_type → config schema for strict validation
INTEGRATION_CONFIG_SCHEMAS: Dict[str, type[BaseModel]] = {
    "slack": SlackConfig,
    "discord": DiscordConfig,
    "microsoft-teams": TeamsConfig,
    "nws-weather": NWSWeatherConfig,
    "nfirs-export": NFIRSConfig,
    "nemsis-export": NEMSISConfig,
    "generic-webhook": GenericWebhookConfig,
    "epcr-import": EPCRImportConfig,
    "google-calendar": GoogleCalendarConfig,
    "outlook": OutlookCalendarConfig,
    "ical": ICalConfig,
    "csv-import": CSVImportConfig,
    "salesforce": SalesforceConfig,
    "documenso": DocumensoConfig,
    "calcom": CalcomConfig,
    "paypal": PayPalConfig,
    "claude-mcp": ClaudeMcpConfig,
    "google-workspace": GoogleWorkspaceConfig,
    "microsoft-365": Microsoft365Config,
}

# Fields in config that contain secrets and should be stored encrypted
SECRET_CONFIG_KEYS = frozenset(
    {
        "webhook_url",
        "secret",
        "refresh_token",
        "feed_token",
        "api_key",
        "client_secret",
        "client_id",
        "token",
        "password",
        "access_token",
        "api_token",
        "webhook_secret",
        "service_account_key",
    }
)

# ``client_id`` matches SECRET_CONFIG_KEYS and is therefore encrypted, which is
# fine — but it means the connect form can never echo it back, so the UI has to
# treat a blank submission as "leave unchanged" rather than "clear it".


# ============================================
# Response Schemas
# ============================================


# ============================================
# External API Response Schemas (trust boundary)
# ============================================


class ActiveWeatherAlertResponse(BaseModel):
    """An active alert as the dashboard banner shows it."""

    id: str
    event: str
    severity: str
    headline: Optional[str] = None
    instruction: Optional[str] = None
    area_desc: Optional[str] = None
    onset: Optional[datetime] = None
    expires: Optional[datetime] = None


class WeatherAlertResponse(BaseModel):
    """Validated NWS weather alert — only trusted fields."""

    model_config = ConfigDict(extra="ignore")

    # NWS's own identifier for the alert; the dedupe key.
    id: str = ""
    event: str
    # "Actual" for a real alert; "Exercise", "System", "Test" or "Draft" else.
    status: str = ""
    severity: str = ""
    urgency: str = ""
    headline: str = ""
    description: str = ""
    instruction: str = ""
    onset: Optional[str] = None
    expires: Optional[str] = None
    area_desc: str = Field(default="", alias="areaDesc")


class EPCRImportRow(BaseModel):
    """Validated row from ePCR CSV/XML import — only dispatch fields."""

    model_config = ConfigDict(extra="ignore")

    incident_number: str
    incident_type: Optional[str] = None
    dispatched_at: Optional[str] = None
    on_scene_at: Optional[str] = None
    cleared_at: Optional[str] = None
    cancelled_en_route: Optional[bool] = None
    medical_refusal: Optional[bool] = None
    responding_members: Optional[List[str]] = None
    notes: Optional[str] = None

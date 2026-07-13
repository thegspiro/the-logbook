"""
Integration Pydantic Schemas

Request/response schemas for the integrations API.
Includes per-integration-type config schemas with strict validation.
"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

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


class NFIRSConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    state_fdid: str
    state_code: str = Field(max_length=2)


class NEMSISConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    state_code: str = Field(max_length=2)
    agency_id: str
    nemsis_version: str = "3.5.0"


class GenericWebhookConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str
    secret: str = ""
    event_types: List[str] = Field(default_factory=list)


class EPCRImportConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    import_format: str = Field(pattern=r"^(csv|nemsis_xml)$")
    field_mappings: Dict[str, str] = Field(default_factory=dict)
    auto_match_members: bool = True


class GoogleCalendarConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    refresh_token: str = ""
    calendar_id: str = "primary"
    sync_direction: str = Field(default="push", pattern=r"^(push|pull|both)$")
    event_types_to_sync: List[str] = Field(default_factory=list)


class OutlookCalendarConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    refresh_token: str = ""
    calendar_id: str = ""
    sync_direction: str = Field(default="push", pattern=r"^(push|pull|both)$")
    tenant_id: str = ""


class ICalConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    feed_token: str = ""
    included_event_types: List[str] = Field(default_factory=list)
    include_shifts: bool = False


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
    }
)


# ============================================
# Response Schemas
# ============================================


# ============================================
# External API Response Schemas (trust boundary)
# ============================================


class WeatherAlertResponse(BaseModel):
    """Validated NWS weather alert — only trusted fields."""

    model_config = ConfigDict(extra="ignore")

    event: str
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

"""
Integration Pydantic Schemas

Request/response schemas for the integrations API.
Includes per-integration-type config schemas with strict validation.
"""

from datetime import datetime
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
        "token",
        "password",
    }
)


# ============================================
# Response Schemas
# ============================================


class IntegrationResponse(BaseModel):
    model_config = _response_config

    id: str
    organization_id: str
    integration_type: str
    name: str
    description: Optional[str] = None
    category: str
    status: str
    config: Dict[str, Any] = Field(default_factory=dict)
    enabled: bool = False
    contains_phi: bool = False
    last_sync_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


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


class SlackWebhookTestResponse(BaseModel):
    """Expected response from Slack webhook POST."""

    model_config = ConfigDict(extra="ignore")

    ok: bool = True


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

"""
Tests for integration security fixes.

Tests cover:
- Config secret sanitization
- Config schema validation
- URL validation (SSRF protection)
- Response serialization helper
"""

import pytest
from unittest.mock import MagicMock

from app.api.v1.endpoints.integrations import (
    _sanitize_config,
    _integration_to_dict,
    _validate_config,
    _extract_secrets,
    _validate_urls_in_config,
)
from app.schemas.integration import (
    SlackConfig,
    NWSWeatherConfig,
    GenericWebhookConfig,
    INTEGRATION_CONFIG_SCHEMAS,
    SECRET_CONFIG_KEYS,
    EPCRImportRow,
)
from app.utils.url_validator import validate_integration_url


# ============================================
# Config Sanitization Tests
# ============================================


class TestSanitizeConfig:
    def test_replaces_secret_keys(self):
        config = {
            "webhook_url": "https://hooks.slack.com/services/123",
            "channel": "#general",
            "api_key": "sk-12345",
            "token": "xoxb-token",
        }
        result = _sanitize_config(config)
        assert result["webhook_url"] == "\u2022" * 8
        assert result["channel"] == "#general"
        assert result["api_key"] == "\u2022" * 8
        assert result["token"] == "\u2022" * 8

    def test_preserves_non_secret_keys(self):
        config = {"zone_id": "NYZ072", "state_code": "NY", "enabled": True}
        result = _sanitize_config(config)
        assert result == config

    def test_handles_none_config(self):
        assert _sanitize_config(None) == {}

    def test_handles_empty_config(self):
        assert _sanitize_config({}) == {}

    def test_does_not_redact_empty_values(self):
        config = {"webhook_url": "", "token": None}
        result = _sanitize_config(config)
        assert result["webhook_url"] == ""
        assert result["token"] is None


# ============================================
# Response Serialization Tests
# ============================================


class TestIntegrationToDict:
    def _make_integration(self, **overrides):
        mock = MagicMock()
        mock.id = "int-123"
        mock.organization_id = "org-456"
        mock.integration_type = "slack"
        mock.name = "Slack"
        mock.description = "Slack integration"
        mock.category = "Messaging"
        mock.status = "connected"
        mock.config = {"webhook_url": "https://hooks.slack.com/123", "channel": "#general"}
        mock.enabled = True
        mock.contains_phi = False
        mock.last_sync_at = None
        mock.created_at = None
        mock.updated_at = None
        for k, v in overrides.items():
            setattr(mock, k, v)
        return mock

    def test_sanitizes_secrets_by_default(self):
        integration = self._make_integration()
        result = _integration_to_dict(integration)
        assert result["config"]["webhook_url"] == "\u2022" * 8
        assert result["config"]["channel"] == "#general"

    def test_no_sanitization_when_disabled(self):
        integration = self._make_integration()
        result = _integration_to_dict(integration, sanitize_secrets=False)
        assert result["config"]["webhook_url"] == "https://hooks.slack.com/123"

    def test_includes_all_fields(self):
        integration = self._make_integration()
        result = _integration_to_dict(integration)
        required_keys = {
            "id", "organization_id", "integration_type", "name",
            "description", "category", "status", "config", "enabled",
            "contains_phi", "last_sync_at", "created_at", "updated_at",
        }
        assert set(result.keys()) == required_keys

    def test_includes_contains_phi(self):
        integration = self._make_integration(contains_phi=True)
        result = _integration_to_dict(integration)
        assert result["contains_phi"] is True


# ============================================
# Config Validation Tests
# ============================================


class TestValidateConfig:
    def test_valid_slack_config(self):
        config = {"webhook_url": "https://hooks.slack.com/services/123"}
        result = _validate_config("slack", config)
        assert result["webhook_url"] == "https://hooks.slack.com/services/123"

    def test_invalid_slack_config_rejects_extra_keys(self):
        config = {"webhook_url": "https://hooks.slack.com/123", "malicious_key": "payload"}
        with pytest.raises(Exception):
            _validate_config("slack", config)

    def test_valid_nws_zone(self):
        config = {"zone_id": "NYZ072"}
        result = _validate_config("nws-weather", config)
        assert result["zone_id"] == "NYZ072"

    def test_invalid_nws_zone_format(self):
        config = {"zone_id": "invalid"}
        with pytest.raises(Exception):
            _validate_config("nws-weather", config)

    def test_unknown_type_passes_through(self):
        config = {"any_key": "any_value"}
        result = _validate_config("unknown-type", config)
        assert result == config

    def test_empty_config_passes(self):
        result = _validate_config("slack", {})
        assert result == {}


# ============================================
# Secret Extraction Tests
# ============================================


class TestExtractSecrets:
    def test_separates_secrets_from_public(self):
        config = {
            "webhook_url": "https://hooks.slack.com/123",
            "channel": "#general",
            "event_types": ["event.created"],
        }
        public, secrets = _extract_secrets(config)
        assert "webhook_url" in secrets
        assert secrets["webhook_url"] == "https://hooks.slack.com/123"
        assert "channel" in public
        assert "event_types" in public
        assert "webhook_url" not in public

    def test_empty_config(self):
        public, secrets = _extract_secrets({})
        assert public == {}
        assert secrets == {}

    def test_non_string_secret_stays_public(self):
        config = {"secret": 123}
        public, secrets = _extract_secrets(config)
        assert "secret" in public
        assert len(secrets) == 0


# ============================================
# URL Validation Tests
# ============================================


class TestValidateUrls:
    def test_rejects_empty_url(self):
        with pytest.raises(ValueError, match="must not be empty"):
            validate_integration_url("")

    def test_rejects_http_in_non_dev(self):
        """HTTP is rejected when ENVIRONMENT != 'development'."""
        from unittest.mock import patch as mock_patch

        with mock_patch("app.utils.url_validator.settings") as mock_settings:
            mock_settings.ENVIRONMENT = "production"
            with pytest.raises(ValueError, match="HTTPS"):
                validate_integration_url("http://example.com/webhook")

    def test_rejects_no_hostname(self):
        with pytest.raises(ValueError, match="hostname"):
            validate_integration_url("https:///path")

    def test_rejects_metadata_endpoint(self):
        with pytest.raises(ValueError, match="not allowed"):
            validate_integration_url("https://169.254.169.254/latest/meta-data/")

    def test_rejects_metadata_google(self):
        with pytest.raises(ValueError, match="not allowed"):
            validate_integration_url("https://metadata.google.internal/computeMetadata")

    def test_accepts_valid_https_url(self):
        """Test with a mocked DNS resolution to avoid sandbox DNS issues."""
        from unittest.mock import patch as mock_patch

        with mock_patch("app.utils.url_validator.socket.getaddrinfo") as mock_dns:
            mock_dns.return_value = [
                (2, 1, 6, "", ("54.230.1.1", 0)),
            ]
            result = validate_integration_url("https://hooks.slack.com/services/T00/B00/xxx")
            assert result == "https://hooks.slack.com/services/T00/B00/xxx"

    def test_rejects_private_ip_resolution(self):
        """URL that resolves to private IP should be rejected."""
        from unittest.mock import patch as mock_patch

        with mock_patch("app.utils.url_validator.socket.getaddrinfo") as mock_dns:
            mock_dns.return_value = [
                (2, 1, 6, "", ("192.168.1.1", 0)),
            ]
            with pytest.raises(ValueError, match="private"):
                validate_integration_url("https://internal.example.com/api")


# ============================================
# Pydantic Schema Tests
# ============================================


class TestIntegrationSchemas:
    def test_slack_config_valid(self):
        config = SlackConfig(webhook_url="https://hooks.slack.com/123")
        assert config.webhook_url == "https://hooks.slack.com/123"
        assert config.event_types == []

    def test_slack_config_rejects_extra(self):
        with pytest.raises(Exception):
            SlackConfig(webhook_url="https://x.com", injected="bad")

    def test_nws_zone_valid(self):
        config = NWSWeatherConfig(zone_id="NYZ072")
        assert config.zone_id == "NYZ072"

    def test_nws_zone_invalid(self):
        with pytest.raises(Exception):
            NWSWeatherConfig(zone_id="INVALID")

    def test_webhook_config(self):
        config = GenericWebhookConfig(url="https://example.com")
        assert config.secret == ""

    def test_epcr_import_row_discards_extra(self):
        row = EPCRImportRow(
            incident_number="12345",
            incident_type="medical",
            patient_name="SHOULD BE IGNORED",
        )
        assert row.incident_number == "12345"
        # patient_name is not a field — extra="ignore" silently drops it
        assert not hasattr(row, "patient_name")

    def test_all_catalog_types_have_schemas(self):
        """Verify integration types with config have matching schemas."""
        types_needing_schemas = {
            "slack", "discord", "microsoft-teams", "nws-weather",
            "nfirs-export", "nemsis-export", "generic-webhook",
            "epcr-import", "google-calendar", "outlook", "ical",
        }
        for itype in types_needing_schemas:
            assert itype in INTEGRATION_CONFIG_SCHEMAS, f"Missing schema for {itype}"

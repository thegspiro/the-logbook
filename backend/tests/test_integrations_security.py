"""
Tests for integration security fixes.

Tests cover:
- Config secret sanitization
- Config schema validation
- URL validation (SSRF protection)
- Response serialization helper
"""

import socket
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.v1.endpoints.integrations import (
    _extract_secrets,
    _integration_to_dict,
    _sanitize_config,
    _validate_config,
)
from app.schemas.integration import (
    INTEGRATION_CONFIG_SCHEMAS,
    EPCRImportRow,
    GenericWebhookConfig,
    NWSWeatherConfig,
    SlackConfig,
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
        mock.config = {
            "webhook_url": "https://hooks.slack.com/123",
            "channel": "#general",
        }
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
            "id",
            "organization_id",
            "integration_type",
            "name",
            "description",
            "category",
            "status",
            "config",
            "enabled",
            "contains_phi",
            "last_sync_at",
            "created_at",
            "updated_at",
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
        config = {
            "webhook_url": "https://hooks.slack.com/123",
            "malicious_key": "payload",
        }
        with pytest.raises(HTTPException):
            _validate_config("slack", config)

    def test_valid_nws_zone(self):
        config = {"zone_id": "NYZ072"}
        result = _validate_config("nws-weather", config)
        assert result["zone_id"] == "NYZ072"

    def test_invalid_nws_zone_format(self):
        config = {"zone_id": "invalid"}
        with pytest.raises(HTTPException):
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
            result = validate_integration_url(
                "https://hooks.slack.com/services/T00/B00/xxx"
            )
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

    @staticmethod
    def _dns(*ips):
        """Build a getaddrinfo-style return value resolving to the given IPs."""
        return [(2, 1, 6, "", (ip, 0)) for ip in ips]

    def test_strips_surrounding_whitespace(self):
        """A URL padded with whitespace is trimmed and returned clean."""
        with patch("app.utils.url_validator.socket.getaddrinfo") as mock_dns:
            mock_dns.return_value = self._dns("54.230.1.1")
            result = validate_integration_url("  https://hooks.slack.com/abc  ")
            assert result == "https://hooks.slack.com/abc"

    def test_allows_http_in_development(self):
        """HTTP is permitted only when ENVIRONMENT == 'development'."""
        with patch("app.utils.url_validator.settings") as mock_settings, patch(
            "app.utils.url_validator.socket.getaddrinfo"
        ) as mock_dns:
            mock_settings.ENVIRONMENT = "development"
            mock_dns.return_value = self._dns("54.230.1.1")
            result = validate_integration_url("http://example.com/webhook")
            assert result == "http://example.com/webhook"

    def test_rejects_unresolvable_hostname(self):
        """A DNS failure surfaces as a clear resolution error, not a crash."""
        with patch("app.utils.url_validator.socket.getaddrinfo") as mock_dns:
            mock_dns.side_effect = socket.gaierror("name not known")
            with pytest.raises(ValueError, match="Could not resolve hostname"):
                validate_integration_url("https://no-such-host.example/api")

    def test_rejects_ipv6_metadata_endpoint(self):
        """The IPv6 AWS metadata host is blocked before DNS resolution."""
        with pytest.raises(ValueError, match="not allowed"):
            validate_integration_url("https://[fd00:ec2::254]/latest/meta-data/")

    def test_rejects_metadata_goog_endpoint(self):
        with pytest.raises(ValueError, match="not allowed"):
            validate_integration_url("https://metadata.goog/computeMetadata")

    @pytest.mark.parametrize(
        "ip",
        [
            "127.0.0.1",  # loopback
            "169.254.169.254",  # link-local (also a metadata IP)
            "10.0.0.5",  # private class A
            "172.16.0.1",  # private class B
            "224.0.0.1",  # multicast
            "fd00::1",  # IPv6 unique-local
            "::1",  # IPv6 loopback
        ],
    )
    def test_rejects_resolution_to_internal_addresses(self, ip):
        """Every private/reserved address family is rejected after resolution."""
        with patch("app.utils.url_validator.socket.getaddrinfo") as mock_dns:
            mock_dns.return_value = self._dns(ip)
            with pytest.raises(ValueError, match="private/internal IP"):
                validate_integration_url("https://rebind.example.com/api")

    def test_rejects_when_any_resolved_address_is_internal(self):
        """A public + private split-horizon result must still be rejected."""
        with patch("app.utils.url_validator.socket.getaddrinfo") as mock_dns:
            mock_dns.return_value = self._dns("54.230.1.1", "10.0.0.5")
            with pytest.raises(ValueError, match="private/internal IP"):
                validate_integration_url("https://rebind.example.com/api")

    def test_allow_known_only_accepts_exact_domain(self):
        with patch("app.utils.url_validator.socket.getaddrinfo") as mock_dns:
            mock_dns.return_value = self._dns("54.230.1.1")
            result = validate_integration_url(
                "https://hooks.slack.com/services/T00/B00/xxx",
                allow_known_only=True,
            )
            assert result.startswith("https://hooks.slack.com/")

    def test_allow_known_only_accepts_subdomain(self):
        """Subdomains of a known webhook domain are permitted."""
        with patch("app.utils.url_validator.socket.getaddrinfo") as mock_dns:
            mock_dns.return_value = self._dns("162.159.1.1")
            result = validate_integration_url(
                "https://canary.discord.com/api/webhooks/1/abc",
                allow_known_only=True,
            )
            assert result.startswith("https://canary.discord.com/")

    def test_allow_known_only_rejects_unknown_domain(self):
        """A perfectly valid public URL is still rejected if not allowlisted."""
        with pytest.raises(ValueError, match="not a recognized webhook domain"):
            validate_integration_url(
                "https://evil.example.com/webhook",
                allow_known_only=True,
            )

    def test_allow_known_only_rejects_lookalike_suffix(self):
        """A domain that merely ends in the allowed string (no dot) is rejected."""
        with pytest.raises(ValueError, match="not a recognized webhook domain"):
            validate_integration_url(
                "https://evildiscord.com/webhook",
                allow_known_only=True,
            )


# ============================================
# Pydantic Schema Tests
# ============================================


class TestIntegrationSchemas:
    def test_slack_config_valid(self):
        config = SlackConfig(webhook_url="https://hooks.slack.com/123")
        assert config.webhook_url == "https://hooks.slack.com/123"
        assert config.event_types == []

    def test_slack_config_rejects_extra(self):
        with pytest.raises(ValidationError):
            SlackConfig(webhook_url="https://x.com", injected="bad")

    def test_nws_zone_valid(self):
        config = NWSWeatherConfig(zone_id="NYZ072")
        assert config.zone_id == "NYZ072"

    def test_nws_zone_invalid(self):
        with pytest.raises(ValidationError):
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
            "slack",
            "discord",
            "microsoft-teams",
            "nws-weather",
            "nfirs-export",
            "nemsis-export",
            "generic-webhook",
            "epcr-import",
            "google-calendar",
            "outlook",
            "ical",
        }
        for itype in types_needing_schemas:
            assert itype in INTEGRATION_CONFIG_SCHEMAS, f"Missing schema for {itype}"

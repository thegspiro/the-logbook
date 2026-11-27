"""Integration settings round-trip through the screen without being damaged.

INT2-9: ``_sanitize_config`` masked every key whose name contains "auth",
"secret", "key"… — including values that are not secrets. ``oauth_enabled``
(a boolean) came back as bullets, so the Claude settings form opened with it
unticked and any save turned members' own MCP sign-in off. The Microsoft 365
``client_secret_expires_on`` (a date the admin types) came back as bullets too,
and was sent back as an invalid date, so Microsoft 365 settings could never be
saved.

INT2-10: connecting Microsoft 365 stores ``client_id`` encrypted
(SECRET_CONFIG_KEYS), but ``directory_for`` read it from public config, so a
directory connected through the screen failed every test and every account
creation with "missing its tenant ID, client ID or client secret".
"""

from types import SimpleNamespace

import pytest

from app.api.v1.endpoints.integrations import _sanitize_config
from app.services.integration_services.microsoft_365_service import directory_for

pytestmark = pytest.mark.unit

BULLETS = "•" * 8


class TestSanitizeConfig:
    def test_a_boolean_setting_is_not_masked(self):
        assert _sanitize_config({"oauth_enabled": True}) == {"oauth_enabled": True}

    def test_the_secret_expiry_date_is_not_masked(self):
        assert _sanitize_config({"client_secret_expires_on": "2027-03-01"}) == {
            "client_secret_expires_on": "2027-03-01"
        }

    def test_a_secret_string_is_still_masked(self):
        assert _sanitize_config({"api_key": "sk-live-123", "auth_token": "t"}) == {
            "api_key": BULLETS,
            "auth_token": BULLETS,
        }


class TestDirectoryFor:
    def test_reads_the_client_id_from_where_connect_stores_it(self):
        secrets = {"client_secret": "s3cret", "client_id": "app-client-id"}
        integration = SimpleNamespace(
            config={"tenant_id": "tenant-1", "usage_location": "US"},
            get_secret=secrets.get,
        )

        directory = directory_for(integration)

        assert directory is not None

    def test_still_reads_a_client_id_left_in_public_config(self):
        secrets = {"client_secret": "s3cret"}
        integration = SimpleNamespace(
            config={"tenant_id": "tenant-1", "client_id": "app-client-id"},
            get_secret=secrets.get,
        )

        assert directory_for(integration) is not None

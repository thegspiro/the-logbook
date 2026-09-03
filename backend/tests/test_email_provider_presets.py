"""
Gmail and Microsoft 365 send through provider SMTP with an App Password.

Before 2026-09-03 the settings screen stored Gmail credentials under
``google_*`` keys and the sender read only ``smtp_*`` keys, so a department
that picked Gmail saved successfully and then failed every send with
"SMTP host and from_email are required". These tests pin the resolution the
sender and the connection test now share.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Imported as a module: the helpers are named test_* and pytest would collect
# them as tests if they were bound in this namespace.
import app.api.v1.email_test_helper as email_test_helper
from app.api.v1.endpoints.organizations import (
    _resolve_redacted_secrets,
    _smtp_login_incomplete,
)
from app.schemas.organization import (
    _EMAIL_SECRET_FIELDS,
    _LEGACY_EMAIL_OAUTH_FIELDS,
    EmailServiceSettings,
    encrypt_settings_secrets,
)
from app.services.email_service import EmailService
from app.services.organization_service import OrganizationService
from app.utils.email_providers import (
    EMAIL_PLATFORMS,
    PROVIDER_SMTP_PRESETS,
    normalize_stored_platform,
    resolve_smtp_settings,
)


def _org(email_service: dict) -> SimpleNamespace:
    return SimpleNamespace(name="Test FD", settings={"email_service": email_service})


class TestResolveSmtpSettings:
    def test_gmail_uses_provider_host_and_from_address_login(self):
        resolved = resolve_smtp_settings(
            {
                "platform": "gmail",
                "from_email": "chief@example.org",
                "google_app_password": "abcd efgh ijkl mnop",
            }
        )

        assert resolved == {
            "host": "smtp.gmail.com",
            "port": 587,
            "user": "chief@example.org",
            "password": "abcdefghijklmnop",
            "encryption": "tls",
        }

    def test_microsoft_uses_office365_host(self):
        resolved = resolve_smtp_settings(
            {
                "platform": "microsoft",
                "from_email": "alerts@dept.example",
                "microsoft_app_password": "secret",
            }
        )

        assert resolved["host"] == "smtp.office365.com"
        assert resolved["port"] == 587
        assert resolved["user"] == "alerts@dept.example"
        assert resolved["password"] == "secret"
        assert resolved["encryption"] == "tls"

    def test_preset_platform_ignores_stray_smtp_keys(self):
        # A row saved while the form still exposed smtp_* for Gmail must not
        # send Gmail mail to somebody's old self-hosted server.
        resolved = resolve_smtp_settings(
            {
                "platform": "gmail",
                "from_email": "chief@example.org",
                "google_app_password": "pw",
                "smtp_host": "mail.old.example",
                "smtp_user": "old-user",
                "smtp_password": "old-pw",
            }
        )

        assert resolved["host"] == "smtp.gmail.com"
        assert resolved["user"] == "chief@example.org"
        assert resolved["password"] == "pw"

    def test_preset_platform_without_password_reports_none(self):
        resolved = resolve_smtp_settings(
            {"platform": "gmail", "from_email": "chief@example.org"}
        )

        assert resolved["host"] == "smtp.gmail.com"
        assert resolved["password"] is None

    def test_selfhosted_reads_smtp_keys_as_entered(self):
        resolved = resolve_smtp_settings(
            {
                "platform": "selfhosted",
                "smtp_host": "mail.dept.example",
                "smtp_port": "465",
                "smtp_user": "svc",
                "smtp_password": "pw",
                "smtp_encryption": "ssl",
            }
        )

        assert resolved == {
            "host": "mail.dept.example",
            "port": 465,
            "user": "svc",
            "password": "pw",
            "encryption": "ssl",
        }

    def test_selfhosted_bad_port_falls_back_to_submission_port(self):
        resolved = resolve_smtp_settings(
            {"platform": "selfhosted", "smtp_host": "h", "smtp_port": "nope"}
        )

        assert resolved["port"] == 587

    def test_every_preset_password_field_is_encrypted_at_rest(self):
        for preset in PROVIDER_SMTP_PRESETS.values():
            assert preset.password_field in _EMAIL_SECRET_FIELDS

    def test_every_preset_platform_is_a_valid_platform(self):
        for platform in PROVIDER_SMTP_PRESETS:
            assert platform in EMAIL_PLATFORMS


class TestEmailServiceUsesPresets:
    def test_gmail_org_config_resolves_to_gmail_smtp(self):
        service = EmailService(
            organization=_org(
                {
                    "enabled": True,
                    "platform": "gmail",
                    "from_email": "chief@example.org",
                    "from_name": "Test FD",
                    "google_app_password": "abcd efgh ijkl mnop",
                }
            )
        )

        config = service._get_smtp_config()

        assert config["host"] == "smtp.gmail.com"
        assert config["port"] == 587
        assert config["user"] == "chief@example.org"
        assert config["password"] == "abcdefghijklmnop"
        assert config["encryption"] == "tls"
        assert config["from_email"] == "chief@example.org"
        assert config["from_name"] == "Test FD"

    def test_gmail_org_config_decrypts_the_app_password(self):
        stored = encrypt_settings_secrets(
            {
                "email_service": {
                    "enabled": True,
                    "platform": "gmail",
                    "from_email": "chief@example.org",
                    "google_app_password": "plain-app-password",
                }
            }
        )
        assert stored["email_service"]["google_app_password"].startswith("enc:")

        service = EmailService(
            organization=SimpleNamespace(name="Test FD", settings=stored)
        )

        assert service._get_smtp_config()["password"] == "plain-app-password"

    def test_microsoft_org_config_resolves_to_office365_smtp(self):
        service = EmailService(
            organization=_org(
                {
                    "enabled": True,
                    "platform": "microsoft",
                    "from_email": "alerts@dept.example",
                    "microsoft_app_password": "pw",
                }
            )
        )

        config = service._get_smtp_config()

        assert config["host"] == "smtp.office365.com"
        assert config["user"] == "alerts@dept.example"
        assert config["password"] == "pw"

    def test_gmail_connect_no_longer_fails_on_missing_host(self):
        service = EmailService(
            organization=_org(
                {
                    "enabled": True,
                    "platform": "gmail",
                    "from_email": "chief@example.org",
                    "google_app_password": "pw",
                }
            )
        )
        smtp_instance = MagicMock()

        with patch(
            "app.services.email_service.smtplib.SMTP", return_value=smtp_instance
        ) as smtp_cls:
            service._smtp_connect()

        assert smtp_cls.call_args.args[:2] == ("smtp.gmail.com", 587)
        smtp_instance.starttls.assert_called_once()
        smtp_instance.login.assert_called_once_with("chief@example.org", "pw")

    def test_blank_from_name_falls_back_to_the_organization_name(self):
        # The settings form saves an empty From Name as null, not as a
        # missing key; the send path must not carry None into the header.
        service = EmailService(
            organization=_org(
                {
                    "enabled": True,
                    "platform": "gmail",
                    "from_email": "chief@example.org",
                    "from_name": None,
                    "google_app_password": "pw",
                }
            )
        )

        assert service._get_smtp_config()["from_name"] == "Test FD"

    def test_selfhosted_org_config_is_unchanged(self):
        service = EmailService(
            organization=_org(
                {
                    "enabled": True,
                    "platform": "selfhosted",
                    "smtp_host": "mail.dept.example",
                    "smtp_port": 2525,
                    "smtp_user": "svc",
                    "smtp_password": "pw",
                    "smtp_encryption": "none",
                    "from_email": "alerts@dept.example",
                }
            )
        )

        config = service._get_smtp_config()

        assert config["host"] == "mail.dept.example"
        assert config["port"] == 2525
        assert config["user"] == "svc"
        assert config["password"] == "pw"
        assert config["encryption"] == "none"

    def test_disabled_org_config_falls_back_to_global(self):
        service = EmailService(
            organization=_org(
                {"enabled": False, "platform": "gmail", "google_app_password": "pw"}
            )
        )

        with patch("app.services.email_service.settings") as global_settings:
            global_settings.SMTP_HOST = "global.example"
            global_settings.SMTP_PORT = 25
            global_settings.SMTP_USER = None
            global_settings.SMTP_PASSWORD = None
            global_settings.SMTP_FROM_EMAIL = "noreply@global.example"
            global_settings.SMTP_FROM_NAME = "Global"
            config = service._get_smtp_config()

        assert config["host"] == "global.example"


class TestEmailServiceSettingsSchema:
    def test_oauth_fields_are_gone(self):
        for field in _LEGACY_EMAIL_OAUTH_FIELDS:
            assert field not in EmailServiceSettings.model_fields

    def test_legacy_oauth_keys_are_ignored_on_input(self):
        # Rows written before the fields were removed still carry them.
        settings = EmailServiceSettings(
            platform="gmail",
            google_app_password="pw",
            **{"google_client_id": "x", "google_client_secret": "y"},
        )

        assert settings.google_app_password == "pw"
        assert not hasattr(settings, "google_client_id")

    def test_platform_is_validated(self):
        with pytest.raises(ValueError, match="platform must be one of"):
            EmailServiceSettings(platform="sendgrid")

    def test_redacted_covers_both_app_passwords(self):
        redacted = EmailServiceSettings(
            platform="gmail",
            google_app_password="a",
            microsoft_app_password="b",
            smtp_password="c",
            cloudflare_api_token="d",
        ).redacted()

        assert redacted.google_app_password == "••••••••"
        assert redacted.microsoft_app_password == "••••••••"
        assert redacted.smtp_password == "••••••••"
        assert redacted.cloudflare_api_token == "••••••••"

    def test_microsoft_app_password_is_encrypted_at_rest(self):
        stored = encrypt_settings_secrets(
            {"email_service": {"microsoft_app_password": "pw"}}
        )

        assert stored["email_service"]["microsoft_app_password"].startswith("enc:")


class TestLegacyPlatformOnRead:
    def test_unknown_platform_with_smtp_host_reads_as_selfhosted(self):
        stored = {
            "enabled": True,
            "platform": "sendgrid",
            "smtp_host": "smtp.sendgrid.net",
            "smtp_user": "apikey",
        }

        normalized = normalize_stored_platform(stored)

        assert normalized["platform"] == "selfhosted"
        assert normalized["smtp_host"] == "smtp.sendgrid.net"
        assert stored["platform"] == "sendgrid"  # input untouched

    def test_unknown_platform_without_smtp_host_reads_as_other(self):
        assert normalize_stored_platform({"platform": "mailgun"})["platform"] == "other"

    def test_known_platform_is_left_alone(self):
        assert normalize_stored_platform({"platform": "gmail"})["platform"] == "gmail"

    def test_null_section_reads_as_defaults(self):
        # OrganizationSettings.email_service is optional, so a row can store
        # the section as null; the read must not raise on it.
        assert normalize_stored_platform(None or {})["platform"] == "other"

    def test_missing_platform_reads_as_other(self):
        # Pre-validation rows could omit the key; the schema default was
        # "other" and must stay so.
        assert normalize_stored_platform({})["platform"] == "other"

    def test_legacy_platform_row_still_builds_the_settings_schema(self):
        settings = EmailServiceSettings(
            **{
                k: v
                for k, v in normalize_stored_platform(
                    {"platform": "sendgrid", "smtp_host": "h", "junk": 1}
                ).items()
                if k in EmailServiceSettings.model_fields
            }
        )

        assert settings.platform == "selfhosted"

    def test_sender_still_treats_a_legacy_platform_as_smtp(self):
        # The sender reads the raw row, not the schema; the label never
        # mattered to it and must keep not mattering.
        service = EmailService(
            organization=_org(
                {
                    "enabled": True,
                    "platform": "sendgrid",
                    "smtp_host": "smtp.sendgrid.net",
                    "smtp_user": "apikey",
                    "smtp_password": "pw",
                    "from_email": "alerts@dept.example",
                }
            )
        )

        assert service._get_smtp_config()["host"] == "smtp.sendgrid.net"


class TestLegacyKeysPrunedOnWrite:
    async def test_saving_email_settings_drops_oauth_keys(self):
        org = SimpleNamespace(
            settings={
                "email_service": {
                    "enabled": True,
                    "platform": "gmail",
                    "from_email": "chief@example.org",
                    "google_client_id": "123.apps.googleusercontent.com",
                    "google_client_secret": "enc:dead",
                    "microsoft_tenant_id": "tenant",
                },
                "modules": {"events": True},
            }
        )
        db = MagicMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        service = OrganizationService(db)

        with (
            patch.object(service, "get_organization", AsyncMock(return_value=org)),
            patch.object(
                service, "get_organization_settings", AsyncMock(return_value=None)
            ),
        ):
            await service.update_organization_settings(
                "org-id",
                {
                    "email_service": {
                        "enabled": True,
                        "platform": "gmail",
                        "from_email": "chief@example.org",
                        "google_app_password": "pw",
                    }
                },
            )

        email = org.settings["email_service"]
        assert not (set(email) & _LEGACY_EMAIL_OAUTH_FIELDS)
        assert email["google_app_password"].startswith("enc:")
        assert org.settings["modules"] == {"events": True}

    async def test_other_sections_do_not_touch_email_keys(self):
        # The prune runs only when the email section itself is being written.
        org = SimpleNamespace(
            settings={"email_service": {"google_client_id": "legacy"}}
        )
        db = MagicMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        service = OrganizationService(db)

        with (
            patch.object(service, "get_organization", AsyncMock(return_value=org)),
            patch.object(
                service, "get_organization_settings", AsyncMock(return_value=None)
            ),
        ):
            await service.update_organization_settings(
                "org-id", {"modules": {"events": False}}
            )

        assert org.settings["email_service"] == {"google_client_id": "legacy"}


class TestConnectionTestHelpers:
    def test_gmail_test_signs_in_to_gmail_with_app_password(self):
        with patch(
            "app.api.v1.email_test_helper.test_smtp_connection",
            return_value=(True, "ok", {}),
        ) as smtp_test:
            success, _, _ = email_test_helper.test_gmail_connection(
                {"fromEmail": "chief@example.org", "googleAppPassword": "ab cd"}
            )

        assert success
        config = smtp_test.call_args.args[0]
        assert config["smtpHost"] == "smtp.gmail.com"
        assert config["smtpPort"] == 587
        assert config["smtpEncryption"] == "tls"
        assert config["smtpUsername"] == "chief@example.org"
        assert config["smtpPassword"] == "abcd"

    def test_microsoft_test_signs_in_to_office365(self):
        with patch(
            "app.api.v1.email_test_helper.test_smtp_connection",
            return_value=(True, "ok", {}),
        ) as smtp_test:
            email_test_helper.test_microsoft_connection(
                {"fromEmail": "a@dept.example", "microsoftAppPassword": "pw"}
            )

        config = smtp_test.call_args.args[0]
        assert config["smtpHost"] == "smtp.office365.com"
        assert config["smtpUsername"] == "a@dept.example"
        assert config["smtpPassword"] == "pw"

    def test_missing_app_password_fails_before_any_connection(self):
        with patch("app.api.v1.email_test_helper.test_smtp_connection") as smtp_test:
            success, message, details = email_test_helper.test_gmail_connection(
                {"fromEmail": "chief@example.org"}
            )

        assert not success
        assert "App Password" in message
        assert "googleAppPassword" in details["required"]
        smtp_test.assert_not_called()

    def test_missing_from_email_fails_before_any_connection(self):
        with patch("app.api.v1.email_test_helper.test_smtp_connection") as smtp_test:
            success, message, _ = email_test_helper.test_microsoft_connection(
                {"microsoftAppPassword": "pw"}
            )

        assert not success
        assert "email address" in message
        smtp_test.assert_not_called()


class TestRedactedSecretsResolveAgainstStore:
    def test_placeholder_is_replaced_by_the_saved_secret(self):
        submitted = EmailServiceSettings(
            platform="gmail",
            from_email="chief@example.org",
            google_app_password="••••••••",
            smtp_password="••••••••",
        )

        resolved = _resolve_redacted_secrets(
            submitted,
            {
                "platform": "gmail",
                "from_email": "chief@example.org",
                "google_app_password": "saved-pw",
                "smtp_password": "s",
            },
        )

        assert resolved.google_app_password == "saved-pw"
        assert resolved.smtp_password == "s"

    def test_typed_value_wins_over_the_saved_secret(self):
        submitted = EmailServiceSettings(platform="gmail", google_app_password="new")

        resolved = _resolve_redacted_secrets(
            submitted, {"platform": "gmail", "google_app_password": "saved-pw"}
        )

        assert resolved.google_app_password == "new"

    def test_placeholder_is_not_reused_against_a_different_host(self):
        # SEC (Codex P2 on #2196): the caller cannot read the stored password,
        # and the test presents it to whatever host the form names. A marker
        # paired with a new host must not carry the saved secret there.
        stored = {
            "platform": "selfhosted",
            "smtp_host": "mail.dept.example",
            "smtp_port": 587,
            "smtp_user": "svc",
            "smtp_encryption": "tls",
            "smtp_password": "saved-pw",
        }
        submitted = EmailServiceSettings(
            platform="selfhosted",
            smtp_host="attacker.example",
            smtp_port=587,
            smtp_user="svc",
            smtp_encryption="tls",
            smtp_password="••••••••",
        )

        assert _resolve_redacted_secrets(submitted, stored).smtp_password is None

    def test_placeholder_is_reused_for_the_saved_host(self):
        stored = {
            "platform": "selfhosted",
            "smtp_host": "mail.dept.example",
            "smtp_port": "587",
            "smtp_user": "svc",
            "smtp_encryption": "tls",
            "smtp_password": "saved-pw",
        }
        submitted = EmailServiceSettings(
            platform="selfhosted",
            smtp_host="mail.dept.example",
            smtp_port=587,
            smtp_user="svc",
            smtp_encryption="tls",
            smtp_password="••••••••",
        )

        assert _resolve_redacted_secrets(submitted, stored).smtp_password == "saved-pw"

    def test_app_password_is_not_reused_for_a_different_account(self):
        stored = {
            "platform": "gmail",
            "from_email": "chief@example.org",
            "google_app_password": "saved-pw",
        }
        submitted = EmailServiceSettings(
            platform="gmail",
            from_email="someone-else@example.org",
            google_app_password="••••••••",
        )

        assert _resolve_redacted_secrets(submitted, stored).google_app_password is None

    def test_app_password_is_not_reused_across_platforms(self):
        # Switching Gmail -> self-hosted and naming a host must not carry the
        # Gmail password to that host, even though the stored dict has it.
        stored = {
            "platform": "gmail",
            "from_email": "chief@example.org",
            "google_app_password": "saved-pw",
            "smtp_password": "old-smtp-pw",
        }
        submitted = EmailServiceSettings(
            platform="selfhosted",
            smtp_host="attacker.example",
            smtp_user="chief@example.org",
            smtp_password="••••••••",
            google_app_password="••••••••",
        )

        resolved = _resolve_redacted_secrets(submitted, stored)

        assert resolved.smtp_password is None
        assert resolved.google_app_password is None

    def test_placeholder_with_nothing_saved_resolves_to_none(self):
        submitted = EmailServiceSettings(
            platform="microsoft", microsoft_app_password="••••••••"
        )

        resolved = _resolve_redacted_secrets(submitted, {})

        assert resolved.microsoft_app_password is None


class TestUnrestorablePasswordIsNotTestedAsAnonymous:
    def test_username_without_password_is_incomplete(self):
        # After an identity mismatch the marker resolves to None; the SMTP
        # helper would then connect anonymously and report success.
        resolved = EmailServiceSettings(
            platform="selfhosted", smtp_host="attacker.example", smtp_user="svc"
        )

        assert _smtp_login_incomplete(resolved)

    def test_anonymous_relay_is_still_testable(self):
        resolved = EmailServiceSettings(platform="selfhosted", smtp_host="relay")

        assert not _smtp_login_incomplete(resolved)

    def test_complete_login_is_testable(self):
        resolved = EmailServiceSettings(
            platform="selfhosted", smtp_host="h", smtp_user="svc", smtp_password="pw"
        )

        assert not _smtp_login_incomplete(resolved)

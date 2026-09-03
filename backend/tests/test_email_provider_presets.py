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
    _administers_settings,
    _resolve_redacted_secrets,
    _smtp_login_incomplete,
)
from app.api.v1.onboarding import (
    _email_settings_from_onboarding,
    _incomplete_session_email,
    _parse_smtp_port,
)
from app.core.security import encrypt_data
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
    connection_identity,
    is_valid_email,
    missing_for_enabled,
    normalize_app_password,
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

    def test_legacy_platform_label_still_matches_the_saved_server(self):
        stored = {
            "platform": "sendgrid",
            "smtp_host": "smtp.sendgrid.net",
            "smtp_port": 587,
            "smtp_user": "apikey",
            "smtp_encryption": "tls",
            "smtp_password": "saved-pw",
        }
        submitted = EmailServiceSettings(
            platform="selfhosted",
            smtp_host="smtp.sendgrid.net",
            smtp_port=587,
            smtp_user="apikey",
            smtp_encryption="tls",
            smtp_password="••••••••",
        )

        assert _resolve_redacted_secrets(submitted, stored).smtp_password == "saved-pw"

    def test_omitted_stored_port_matches_the_schema_default(self):
        # An older row saved without smtp_port; the form submits 587.
        stored = {
            "platform": "selfhosted",
            "smtp_host": "mail.dept.example",
            "smtp_user": "svc",
            "smtp_password": "saved-pw",
        }
        submitted = EmailServiceSettings(
            platform="selfhosted",
            smtp_host="mail.dept.example",
            smtp_port=587,
            smtp_user="svc",
            smtp_password="••••••••",
        )

        assert connection_identity("selfhosted", stored) == connection_identity(
            "selfhosted", submitted.model_dump()
        )
        assert _resolve_redacted_secrets(submitted, stored).smtp_password == "saved-pw"

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


class TestEnabledConfigurationMustBeAbleToSend:
    def test_enabled_gmail_without_password_is_rejected(self):
        config = {"enabled": True, "platform": "gmail", "from_email": "c@x.org"}

        assert missing_for_enabled(config) == "google_app_password"

    def test_enabled_microsoft_without_password_is_rejected(self):
        config = {"enabled": True, "platform": "microsoft", "from_email": "a@d.ex"}

        assert missing_for_enabled(config) == "microsoft_app_password"

    def test_enabled_preset_without_account_email_is_rejected(self):
        config = {"enabled": True, "platform": "gmail", "google_app_password": "pw"}

        assert missing_for_enabled(config) == "from_email"

    def test_whitespace_only_app_password_counts_as_missing(self):
        # resolve_smtp_settings strips the display spaces, so a value that is
        # only spaces reaches the server as no password at all.
        config = {
            "enabled": True,
            "platform": "gmail",
            "from_email": "c@x.org",
            "google_app_password": "    ",
        }

        assert missing_for_enabled(config) == "google_app_password"

    def test_enabled_selfhosted_without_host_is_rejected(self):
        config = {"enabled": True, "platform": "selfhosted", "smtp_user": "svc"}

        assert missing_for_enabled(config) == "smtp_host"

    def test_enabled_selfhosted_username_without_password_is_rejected(self):
        config = {
            "enabled": True,
            "platform": "selfhosted",
            "smtp_host": "h",
            "from_email": "alerts@dept.example",
            "smtp_user": "svc",
        }

        assert missing_for_enabled(config) == "smtp_password"

    def test_anonymous_relay_is_complete(self):
        config = {
            "enabled": True,
            "platform": "selfhosted",
            "smtp_host": "relay",
            "from_email": "alerts@dept.example",
        }

        assert missing_for_enabled(config) is None

    def test_malformed_account_address_is_rejected(self):
        # The address is the SMTP login; "not-an-email" fails authentication.
        config = {
            "enabled": True,
            "platform": "gmail",
            "from_email": "not-an-email",
            "google_app_password": "pw",
        }

        assert missing_for_enabled(config) == "from_email"

    def test_selfhosted_needs_a_valid_from_address_too(self):
        # _smtp_connect refuses to send without one.
        config = {"enabled": True, "platform": "selfhosted", "smtp_host": "h"}

        assert missing_for_enabled(config) == "from_email"

    def test_is_valid_email(self):
        assert is_valid_email("chief@example.org")
        assert not is_valid_email("not-an-email")
        assert not is_valid_email("")
        assert not is_valid_email(None)

    def test_complete_preset_configuration_passes(self):
        config = {
            "enabled": True,
            "platform": "gmail",
            "from_email": "c@x.org",
            "google_app_password": "abcd efgh",
        }

        assert missing_for_enabled(config) is None

    def test_disabled_configuration_may_be_incomplete(self):
        # Disabled is the "configure later" state onboarding records; it must
        # stay saveable with nothing filled in.
        assert missing_for_enabled({"enabled": False, "platform": "gmail"}) is None

    def test_cloudflare_and_other_are_not_gated_here(self):
        assert missing_for_enabled({"enabled": True, "platform": "cloudflare"}) is None
        assert missing_for_enabled({"enabled": True, "platform": "other"}) is None

    def test_read_path_still_accepts_an_enabled_row_without_password(self):
        # Write-only: an OAuth-era row is enabled with no App Password and
        # must still build on read so the admin can reach the screen.
        settings = EmailServiceSettings(
            enabled=True, platform="gmail", from_email="chief@example.org"
        )

        assert settings.enabled
        assert settings.google_app_password is None


class TestNormalizeAppPassword:
    def test_strips_display_spaces(self):
        assert normalize_app_password("abcd efgh ijkl mnop") == "abcdefghijklmnop"

    def test_only_spaces_is_nothing(self):
        assert normalize_app_password("   ") is None

    def test_none_and_non_strings_are_nothing(self):
        assert normalize_app_password(None) is None
        assert normalize_app_password(42) is None

    def test_connection_test_rejects_a_whitespace_app_password(self):
        with patch("app.api.v1.email_test_helper.test_smtp_connection") as smtp_test:
            success, message, _ = email_test_helper.test_gmail_connection(
                {"fromEmail": "chief@example.org", "googleAppPassword": "   "}
            )

        assert not success
        assert "App Password" in message
        smtp_test.assert_not_called()


def _service_with(org):
    db = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    service = OrganizationService(db)
    return service


class TestSaveBindsSecretsAndRefusesUnsendable:
    async def _save(self, org, update):
        service = _service_with(org)
        with (
            patch.object(service, "get_organization", AsyncMock(return_value=org)),
            patch.object(
                service, "get_organization_settings", AsyncMock(return_value=None)
            ),
        ):
            await service.update_organization_settings("org-id", update)

    async def test_marker_is_restored_for_the_same_account(self):
        org = SimpleNamespace(
            settings={
                "email_service": {
                    "enabled": True,
                    "platform": "gmail",
                    "from_email": "chief@example.org",
                    "google_app_password": "enc:saved",
                }
            }
        )

        await self._save(
            org,
            {
                "email_service": {
                    "enabled": True,
                    "platform": "gmail",
                    "from_email": "chief@example.org",
                    "from_name": "Renamed",
                    "google_app_password": "••••••••",
                }
            },
        )

        assert org.settings["email_service"]["google_app_password"] == "enc:saved"
        assert org.settings["email_service"]["from_name"] == "Renamed"

    async def test_changing_the_account_under_a_marker_is_refused(self):
        # The saved password belongs to the old account; pairing it with the
        # new login would save green and fail every send. With no password
        # for the new account the enabled check refuses the save.
        org = SimpleNamespace(
            settings={
                "email_service": {
                    "enabled": True,
                    "platform": "gmail",
                    "from_email": "chief@example.org",
                    "google_app_password": "enc:saved",
                }
            }
        )

        with pytest.raises(ValueError, match="Google App Password"):
            await self._save(
                org,
                {
                    "email_service": {
                        "enabled": True,
                        "platform": "gmail",
                        "from_email": "someone-else@example.org",
                        "google_app_password": "••••••••",
                    }
                },
            )

    async def test_changing_the_server_under_a_marker_drops_the_password(self):
        org = SimpleNamespace(
            settings={
                "email_service": {
                    "enabled": False,
                    "platform": "selfhosted",
                    "smtp_host": "mail.dept.example",
                    "smtp_password": "enc:saved",
                }
            }
        )

        await self._save(
            org,
            {
                "email_service": {
                    "enabled": False,
                    "platform": "selfhosted",
                    "smtp_host": "other.example",
                    "smtp_password": "••••••••",
                }
            },
        )

        assert org.settings["email_service"]["smtp_password"] is None

    async def test_partial_patch_changing_the_host_clears_the_omitted_password(self):
        # The full settings PATCH can send only smtp_host. The deep merge
        # would otherwise carry the stored password to the new host, where
        # the next login discloses it.
        org = SimpleNamespace(
            settings={
                "email_service": {
                    "enabled": False,
                    "platform": "selfhosted",
                    "smtp_host": "mail.dept.example",
                    "smtp_user": "svc",
                    "smtp_password": "enc:saved",
                    "from_email": "alerts@dept.example",
                }
            }
        )

        await self._save(org, {"email_service": {"smtp_host": "attacker.example"}})

        assert org.settings["email_service"]["smtp_host"] == "attacker.example"
        assert org.settings["email_service"]["smtp_password"] is None

    async def test_partial_patch_of_an_unrelated_field_keeps_the_password(self):
        org = SimpleNamespace(
            settings={
                "email_service": {
                    "enabled": False,
                    "platform": "selfhosted",
                    "smtp_host": "mail.dept.example",
                    "smtp_password": "enc:saved",
                }
            }
        )

        await self._save(org, {"email_service": {"from_name": "Renamed"}})

        assert org.settings["email_service"]["smtp_password"] == "enc:saved"

    async def test_fresh_password_survives_an_identity_change(self):
        org = SimpleNamespace(
            settings={
                "email_service": {
                    "enabled": False,
                    "platform": "selfhosted",
                    "smtp_host": "mail.dept.example",
                    "smtp_password": "enc:saved",
                }
            }
        )

        await self._save(
            org,
            {"email_service": {"smtp_host": "new.example", "smtp_password": "fresh"}},
        )

        assert org.settings["email_service"]["smtp_password"].startswith("enc:")
        assert org.settings["email_service"]["smtp_password"] != "enc:saved"

    async def test_legacy_platform_row_round_trips_with_a_marker(self):
        # The read path presents "sendgrid" as "selfhosted"; an unchanged
        # save must compare like with like and keep the stored password.
        org = SimpleNamespace(
            settings={
                "email_service": {
                    "enabled": True,
                    "platform": "sendgrid",
                    "smtp_host": "smtp.sendgrid.net",
                    "smtp_port": 587,
                    "smtp_user": "apikey",
                    "smtp_encryption": "tls",
                    "smtp_password": "enc:saved",
                    "from_email": "alerts@dept.example",
                }
            }
        )

        await self._save(
            org,
            {
                "email_service": {
                    "enabled": True,
                    "platform": "selfhosted",
                    "smtp_host": "smtp.sendgrid.net",
                    "smtp_port": 587,
                    "smtp_user": "apikey",
                    "smtp_encryption": "tls",
                    "smtp_password": "••••••••",
                    "from_email": "alerts@dept.example",
                    "from_name": "Dept",
                }
            },
        )

        assert org.settings["email_service"]["smtp_password"] == "enc:saved"
        assert org.settings["email_service"]["platform"] == "selfhosted"

    async def test_full_settings_patch_is_gated_too(self):
        # The invariant lives in the service, so PATCH /settings with an
        # email_service section is refused the same way as PATCH /settings/email.
        org = SimpleNamespace(settings={"modules": {"events": True}})

        with pytest.raises(ValueError, match="App Password"):
            await self._save(
                org,
                {
                    "modules": {"events": False},
                    "email_service": {
                        "enabled": True,
                        "platform": "microsoft",
                        "from_email": "a@dept.example",
                    },
                },
            )

    async def test_unrelated_sections_are_not_gated(self):
        org = SimpleNamespace(
            settings={"email_service": {"enabled": True, "platform": "gmail"}}
        )

        await self._save(org, {"modules": {"events": False}})

        assert org.settings["modules"] == {"events": False}


class TestOnboardingEmailMapping:
    def test_gmail_config_maps_to_the_settings_shape(self):
        mapped = _email_settings_from_onboarding(
            "gmail",
            {"fromEmail": "chief@example.org", "googleAppPassword": "ab cd"},
        )

        assert mapped["enabled"] is True
        assert mapped["platform"] == "gmail"
        assert mapped["google_app_password"] == "ab cd"
        assert "smtp_host" not in mapped
        assert missing_for_enabled(mapped) is None

    def test_whitespace_app_password_is_reported_at_save_time(self):
        # The session save runs missing_for_enabled on this mapping and
        # returns 400, so completion never sees a config it must disable.
        mapped = _email_settings_from_onboarding(
            "microsoft",
            {"fromEmail": "a@dept.example", "microsoftAppPassword": "   "},
        )

        assert missing_for_enabled(mapped) == "microsoft_app_password"

    def test_skip_persists_disabled(self):
        mapped = _email_settings_from_onboarding("other", {})

        assert mapped["enabled"] is False
        assert missing_for_enabled(mapped) is None


class TestOnboardingPortParsing:
    def test_missing_or_blank_is_the_submission_default(self):
        assert _parse_smtp_port(None) == 587
        assert _parse_smtp_port("") == 587

    def test_numeric_strings_and_ints_are_accepted(self):
        assert _parse_smtp_port("465") == 465
        assert _parse_smtp_port(25) == 25

    def test_malformed_values_raise_a_value_error_not_a_type_error(self):
        # The session save turns ValueError into a 400; anything else would
        # escape as a 500.
        for bad in ("abc", {"port": 587}, [587], True, 0, 70000, "-1"):
            with pytest.raises(ValueError, match="SMTP port"):
                _parse_smtp_port(bad)

    def test_mapping_surfaces_the_port_error(self):
        with pytest.raises(ValueError, match="SMTP port"):
            _email_settings_from_onboarding("selfhosted", {"smtpPort": "abc"})


class TestSettingsReadVisibility:
    def test_either_settings_write_grant_sees_infrastructure(self):
        assert _administers_settings({"settings.manage"})
        assert _administers_settings({"organization.update_settings"})

    def test_wildcards_count(self):
        assert _administers_settings({"*"})
        assert _administers_settings({"settings.*"})

    def test_an_ordinary_member_does_not(self):
        assert not _administers_settings({"events.view", "members.view"})
        assert not _administers_settings(set())


def _session_email(platform: str, config: dict) -> dict:
    import json

    return {
        "email": {
            "platform": platform,
            "config_encrypted": encrypt_data(json.dumps(config)),
        }
    }


class TestCompletionRefusesAnUnsendableSessionEmail:
    def test_oauth_era_session_is_sent_back_to_the_email_step(self):
        # Persisted before this branch: Gmail with only the OAuth fields.
        problem = _incomplete_session_email(
            _session_email(
                "gmail",
                {
                    "fromEmail": "chief@example.org",
                    "googleClientId": "123.apps.googleusercontent.com",
                    "googleClientSecret": "GOCSPX-x",
                },
            )
        )

        assert problem is not None
        assert "Google App Password" in problem
        assert "email step" in problem

    def test_complete_session_passes(self):
        assert (
            _incomplete_session_email(
                _session_email(
                    "gmail",
                    {"fromEmail": "chief@example.org", "googleAppPassword": "pw"},
                )
            )
            is None
        )

    def test_skip_and_absent_pass(self):
        assert _incomplete_session_email(_session_email("other", {})) is None
        assert _incomplete_session_email({}) is None
        assert _incomplete_session_email(None) is None

    def test_malformed_port_is_reported_not_raised(self):
        problem = _incomplete_session_email(
            _session_email("selfhosted", {"smtpHost": "h", "smtpPort": "abc"})
        )

        assert problem is not None
        assert "SMTP port" in problem

    def test_undecryptable_config_is_reported_not_raised(self):
        problem = _incomplete_session_email(
            {"email": {"platform": "gmail", "config_encrypted": "not-ciphertext"}}
        )

        assert problem is not None
        assert "could not be read" in problem

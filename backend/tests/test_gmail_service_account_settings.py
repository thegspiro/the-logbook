"""Gmail sending through a domain-wide delegated service account: settings.

A Gmail row with ``google_auth_method == "service_account"`` sends through the
Gmail API with a stored key instead of signing in to smtp.gmail.com. These
tests pin how that row is validated, stored, redacted, tested and routed, and
that only an organization administrator can set it up.
"""

import json
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

import app.api.v1.email_test_helper as email_test_helper
from app.api.v1.endpoints.organizations import _resolve_redacted_secrets
from app.models.user import Organization
from app.schemas.organization import (
    _EMAIL_SECRET_FIELDS,
    EmailServiceSettings,
    decrypt_settings_secrets,
    encrypt_settings_secrets,
)
from app.services.email_service import EmailService
from app.services.organization_service import OrganizationService
from app.utils.email_providers import (
    EMAIL_SECRET_FIELDS,
    REDACTED_SECRET,
    connection_identity,
    google_auth_method,
    invalid_for_enabled,
    missing_for_enabled,
    required_field_message,
    resolve_smtp_settings,
    uses_google_service_account,
)
from app.utils.google_oauth import GoogleOAuthError

SENDER = "notifications@example.org"
CLIENT_ID = "112233445566778899"


def _private_key_pem() -> str:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()


KEY = json.dumps(
    {
        "type": "service_account",
        "project_id": "dept-mail",
        "private_key_id": "abc123",
        "private_key": _private_key_pem(),
        "client_email": "mailer@dept-mail.iam.gserviceaccount.com",
        "client_id": CLIENT_ID,
        "token_uri": "https://oauth2.googleapis.com/token",
    }
)


def sa_section(**overrides) -> dict:
    section = {
        "enabled": True,
        "platform": "gmail",
        "google_auth_method": "service_account",
        "google_service_account_key": KEY,
        "from_email": SENDER,
        "from_name": "Test FD",
    }
    section.update(overrides)
    return section


@pytest.mark.unit
class TestMethodDefaultsToAppPassword:
    def test_absent_method_is_app_password(self):
        # Every Gmail row written before this method existed.
        assert google_auth_method({"platform": "gmail"}) == "app_password"
        assert not uses_google_service_account({"platform": "gmail"})

    def test_unknown_method_is_app_password(self):
        assert google_auth_method({"google_auth_method": "carrier-pigeon"}) == (
            "app_password"
        )

    def test_only_gmail_uses_the_service_account(self):
        assert uses_google_service_account(sa_section())
        assert not uses_google_service_account(sa_section(platform="microsoft"))

    def test_schema_reads_a_stored_null_as_app_password(self):
        settings = EmailServiceSettings(platform="gmail", google_auth_method=None)
        assert settings.google_auth_method == "app_password"

    def test_schema_refuses_an_unknown_method(self):
        with pytest.raises(ValueError, match="google_auth_method"):
            EmailServiceSettings(platform="gmail", google_auth_method="oauth")


@pytest.mark.unit
class TestEnabledServiceAccountMustBeAbleToSend:
    def test_key_is_required(self):
        section = sa_section(google_service_account_key=None)
        assert missing_for_enabled(section) == "google_service_account_key"
        assert "service account key" in required_field_message(
            "gmail", "google_service_account_key"
        )

    def test_app_password_is_not_required(self):
        assert missing_for_enabled(sa_section()) is None

    def test_from_address_is_still_required(self):
        assert missing_for_enabled(sa_section(from_email="")) == "from_email"

    def test_a_key_that_cannot_sign_is_refused(self):
        bad = json.dumps({"type": "authorized_user"})
        assert "service account key" in invalid_for_enabled(
            sa_section(google_service_account_key=bad)
        )

    def test_a_valid_key_is_accepted(self):
        assert invalid_for_enabled(sa_section()) is None

    def test_a_stored_encrypted_key_is_decrypted_to_be_checked(self):
        # What a re-save carries once the redaction marker is swapped for the
        # stored value.
        stored = encrypt_settings_secrets({"email_service": sa_section()})
        assert invalid_for_enabled(stored["email_service"]) is None

    def test_a_stored_key_that_cannot_be_decrypted_is_refused(self):
        section = sa_section(google_service_account_key="enc:not-ciphertext")
        assert "could not be read" in invalid_for_enabled(section)


@pytest.mark.unit
class TestKeyIsASecret:
    def test_listed_in_both_secret_lists(self):
        assert "google_service_account_key" in EMAIL_SECRET_FIELDS
        assert "google_service_account_key" in _EMAIL_SECRET_FIELDS

    def test_encrypted_at_rest_and_decrypted_on_read(self):
        stored = encrypt_settings_secrets({"email_service": sa_section()})
        value = stored["email_service"]["google_service_account_key"]
        assert value.startswith("enc:")
        assert "PRIVATE KEY" not in value
        assert (
            decrypt_settings_secrets(stored)["email_service"][
                "google_service_account_key"
            ]
            == KEY
        )

    def test_redacted_in_responses(self):
        redacted = EmailServiceSettings(**sa_section()).redacted()
        assert redacted.google_service_account_key == REDACTED_SECRET

    def test_client_id_is_reported_for_the_admin_console(self):
        settings = EmailServiceSettings(**sa_section())
        assert settings.google_service_account_client_id == CLIENT_ID
        assert settings.redacted().google_service_account_client_id == CLIENT_ID

    def test_client_id_is_not_shown_to_non_administrators(self):
        settings = EmailServiceSettings(**sa_section()).redacted()
        assert settings.without_infrastructure().google_service_account_client_id is (
            None
        )

    def test_a_submitted_client_id_is_ignored(self):
        settings = EmailServiceSettings(
            **sa_section(google_service_account_key=None),
            google_service_account_client_id="999",
        )
        assert settings.google_service_account_client_id is None


@pytest.mark.unit
class TestIdentityAndTransport:
    def test_switching_method_changes_the_identity(self):
        app_password = {"platform": "gmail", "from_email": SENDER}
        assert connection_identity("gmail", app_password) != connection_identity(
            "gmail", sa_section()
        )

    def test_changing_the_from_address_changes_the_identity(self):
        assert connection_identity("gmail", sa_section()) != connection_identity(
            "gmail", sa_section(from_email="chief@example.org")
        )

    def test_never_resolves_a_password_for_smtp(self):
        # An App Password left behind from the previous method must not be
        # presented to smtp.gmail.com.
        resolved = resolve_smtp_settings(sa_section(google_app_password="leftover"))
        assert resolved["password"] is None
        assert resolved["oauth"] is None

    def test_redacted_key_resolves_only_for_the_same_sender(self):
        stored = sa_section()
        same = EmailServiceSettings(
            **sa_section(google_service_account_key=REDACTED_SECRET)
        )
        other = EmailServiceSettings(
            **sa_section(
                google_service_account_key=REDACTED_SECRET,
                from_email="chief@example.org",
            )
        )

        assert _resolve_redacted_secrets(same, stored).google_service_account_key == (
            KEY
        )
        assert _resolve_redacted_secrets(other, stored).google_service_account_key is (
            None
        )


def _service(org):
    db = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    return OrganizationService(db)


async def _save(org, update, *, admin: bool):
    service = _service(org)
    with (
        patch.object(service, "get_organization", AsyncMock(return_value=org)),
        patch.object(
            service, "get_organization_settings", AsyncMock(return_value=None)
        ),
    ):
        await service.update_organization_settings(
            "org-id", update, may_configure_delegated_email=admin
        )


def _app_password_org() -> SimpleNamespace:
    return SimpleNamespace(
        settings={
            "email_service": {
                "enabled": True,
                "platform": "gmail",
                "from_email": SENDER,
                "google_app_password": "enc:saved",
            }
        }
    )


def _service_account_org() -> SimpleNamespace:
    return SimpleNamespace(
        settings=encrypt_settings_secrets({"email_service": sa_section()})
    )


@pytest.mark.unit
class TestOnlyAnAdministratorConfiguresTheServiceAccount:
    async def test_settings_manage_cannot_switch_to_it(self):
        org = _app_password_org()

        with pytest.raises(PermissionError, match="administrator"):
            await _save(org, {"email_service": sa_section()}, admin=False)

        assert "google_service_account_key" not in org.settings["email_service"]

    async def test_an_administrator_can_switch_to_it(self):
        org = _app_password_org()

        await _save(org, {"email_service": sa_section()}, admin=True)

        stored = decrypt_settings_secrets(org.settings)["email_service"]
        assert stored["google_auth_method"] == "service_account"
        assert stored["google_service_account_key"] == KEY
        # The App Password belonged to the previous method's identity.
        assert stored["google_app_password"] is None

    async def test_settings_manage_cannot_change_whom_it_sends_as(self):
        org = _service_account_org()

        with pytest.raises(PermissionError):
            await _save(
                org,
                {
                    "email_service": sa_section(
                        from_email="chief@example.org",
                        google_service_account_key=REDACTED_SECRET,
                    )
                },
                admin=False,
            )

    async def test_settings_manage_cannot_replace_the_key(self):
        org = _service_account_org()

        with pytest.raises(PermissionError):
            await _save(org, {"email_service": sa_section()}, admin=False)

    async def test_settings_manage_can_save_an_unchanged_form(self):
        org = _service_account_org()

        await _save(
            org,
            {
                "email_service": sa_section(
                    from_name="Renamed FD",
                    google_service_account_key=REDACTED_SECRET,
                )
            },
            admin=False,
        )

        stored = decrypt_settings_secrets(org.settings)["email_service"]
        assert stored["from_name"] == "Renamed FD"
        assert stored["google_service_account_key"] == KEY

    async def test_settings_manage_can_switch_away_from_it(self):
        org = _service_account_org()

        await _save(
            org,
            {
                "email_service": {
                    "enabled": True,
                    "platform": "gmail",
                    "google_auth_method": "app_password",
                    "google_app_password": "abcdefghijklmnop",
                    "from_email": SENDER,
                }
            },
            admin=False,
        )

        stored = decrypt_settings_secrets(org.settings)["email_service"]
        assert stored["google_auth_method"] == "app_password"
        # The key is dropped with the identity it was saved for.
        assert stored["google_service_account_key"] is None

    async def test_other_sections_are_not_affected(self):
        org = _service_account_org()

        await _save(org, {"setup": {"acknowledged": ["members"]}}, admin=False)

        assert org.settings["setup"] == {"acknowledged": ["members"]}


@pytest.mark.unit
class TestEndpointsPassTheAdministratorFlag:
    async def _call_email_patch(self, permissions: set):
        from app.api.v1.endpoints import organizations as endpoint

        org_service = MagicMock()
        org_service.update_organization_settings = AsyncMock(
            return_value=SimpleNamespace(
                email_service=EmailServiceSettings(**sa_section())
            )
        )
        with (
            patch.object(endpoint, "OrganizationService", return_value=org_service),
            patch.object(endpoint, "log_audit_event", AsyncMock()) as audit,
            patch.object(
                endpoint,
                "user_has_permission",
                side_effect=lambda user, perm: perm in permissions,
            ),
        ):
            await endpoint.update_email_settings(
                email_settings=EmailServiceSettings(**sa_section()),
                db=AsyncMock(),
                current_user=SimpleNamespace(
                    id="u1", username="chief", organization_id="org-1"
                ),
            )
        return org_service.update_organization_settings, audit

    async def test_admin_access_is_passed_through(self):
        update, _ = await self._call_email_patch({"admin.access"})
        assert update.call_args.kwargs["may_configure_delegated_email"] is True

    async def test_without_admin_access_it_is_refused_downstream(self):
        update, _ = await self._call_email_patch(set())
        assert update.call_args.kwargs["may_configure_delegated_email"] is False

    async def test_the_method_is_audited(self):
        _, audit = await self._call_email_patch({"admin.access"})
        assert audit.call_args.kwargs["event_data"]["email_auth_method"] == (
            "service_account"
        )


@pytest.mark.unit
class TestConnectionTestObtainsAToken:
    def _config(self, **overrides) -> dict:
        config = {
            "fromEmail": SENDER,
            "googleAuthMethod": "service_account",
            "googleServiceAccountKey": KEY,
        }
        config.update(overrides)
        return config

    def test_success_sends_nothing_and_names_the_sender(self):
        with (
            patch.object(
                email_test_helper, "acquire_gmail_send_token", return_value="tok"
            ) as acquire,
            patch.object(email_test_helper, "test_smtp_connection") as smtp,
        ):
            success, message, details = email_test_helper.test_gmail_connection(
                self._config()
            )

        assert success
        assert SENDER in message
        assert "No message was sent" in message
        assert details["client_id"] == CLIENT_ID
        acquire.assert_called_once_with(KEY, SENDER)
        smtp.assert_not_called()

    def test_refusal_reports_googles_reason(self):
        with patch.object(
            email_test_helper,
            "acquire_gmail_send_token",
            side_effect=GoogleOAuthError("authorize client ID 1 for gmail.send"),
        ):
            success, message, details = email_test_helper.test_gmail_connection(
                self._config()
            )

        assert not success
        assert "gmail.send" in message
        assert details["error"] == "token_request_failed"

    def test_missing_key_is_named(self):
        success, _, details = email_test_helper.test_gmail_connection(
            self._config(googleServiceAccountKey=None)
        )
        assert not success
        assert details["required"] == ["googleServiceAccountKey"]

    def test_app_password_rows_still_sign_in_over_smtp(self):
        with patch.object(
            email_test_helper,
            "test_smtp_connection",
            return_value=(True, "ok", {}),
        ) as smtp:
            email_test_helper.test_gmail_connection(
                {"fromEmail": SENDER, "googleAppPassword": "abcd efgh ijkl mnop"}
            )

        assert smtp.call_args.args[0]["smtpHost"] == "smtp.gmail.com"


def _org(section: dict) -> SimpleNamespace:
    return SimpleNamespace(
        id="org-1",
        name="Test FD",
        email=None,
        settings=encrypt_settings_secrets({"email_service": section}),
    )


@pytest.mark.unit
class TestSendsGoThroughTheGmailApi:
    async def test_send_email_uses_the_api_with_bcc_in_the_recipients(self):
        service = EmailService(_org(sa_section()))
        api_send = AsyncMock(return_value=[True])

        with (
            patch.object(service, "_gmail_api_send", api_send),
            patch.object(service, "_smtp_send") as smtp,
        ):
            sent, failed = await service.send_email(
                to_emails=["member@example.org"],
                subject="Drill",
                html_body="<p>Drill tonight</p>",
                bcc_emails=["records@example.org"],
            )

        assert (sent, failed) == (1, 0)
        smtp.assert_not_called()
        [(recipients, mime)] = api_send.call_args.args[0]
        assert recipients == ["member@example.org", "records@example.org"]
        assert f"<{SENDER}>" in mime

    async def test_send_batch_uses_the_api(self):
        service = EmailService(_org(sa_section()))
        message = service.build_batch_message("member@example.org", "S", "<p>b</p>")
        api_send = AsyncMock(return_value=[True])

        with (
            patch.object(service, "_gmail_api_send", api_send),
            patch.object(service, "_smtp_send_batch") as smtp,
        ):
            assert await service.send_batch([message]) == [True]

        smtp.assert_not_called()
        assert api_send.call_args.args[0] == [(message.recipients, message.mime)]

    async def test_app_password_rows_still_use_smtp(self):
        service = EmailService(
            _org(
                {
                    "enabled": True,
                    "platform": "gmail",
                    "from_email": SENDER,
                    "google_app_password": "abcdefghijklmnop",
                }
            )
        )

        with (
            patch.object(service, "_gmail_api_send") as api_send,
            patch.object(service, "_smtp_send") as smtp,
        ):
            await service.send_email(["member@example.org"], "S", "<p>b</p>")

        api_send.assert_not_called()
        smtp.assert_called_once()

    def test_a_disabled_row_does_not_use_the_api(self):
        service = EmailService(_org(sa_section(enabled=False)))
        assert service._gmail_api_config is None

    async def test_a_row_without_a_usable_key_never_falls_back_to_smtp(self):
        service = EmailService(_org(sa_section(google_service_account_key=None)))

        with (
            patch(
                "app.services.gmail_api_sender.acquire_gmail_send_token",
                side_effect=GoogleOAuthError(
                    "A Google service account key is required"
                ),
            ),
            patch.object(service, "_smtp_send") as smtp,
        ):
            sent, failed = await service.send_email(
                ["member@example.org"], "S", "<p>b</p>"
            )

        assert (sent, failed) == (0, 1)
        smtp.assert_not_called()

    def test_the_sender_is_handed_the_decrypted_key(self):
        service = EmailService(_org(sa_section()))
        assert service._gmail_api_config == {"key": KEY, "from_email": SENDER}


@pytest.mark.integration
class TestServiceAccountWriteEndToEnd:
    async def test_saved_encrypted_and_read_back_with_client_id(self, db_session):
        org = Organization(
            name="Test FD",
            slug=f"fd-{uuid.uuid4().hex[:8]}",
            settings=encrypt_settings_secrets(
                {
                    "email_service": {
                        "enabled": True,
                        "platform": "gmail",
                        "from_email": SENDER,
                        "google_app_password": "abcdefghijklmnop",
                    }
                }
            ),
        )
        db_session.add(org)
        await db_session.flush()
        service = OrganizationService(db_session)

        with pytest.raises(PermissionError):
            await service.update_organization_settings(
                org.id, {"email_service": sa_section()}
            )

        updated = await service.update_organization_settings(
            org.id, {"email_service": sa_section()}, may_configure_delegated_email=True
        )

        assert updated.email_service.google_auth_method == "service_account"
        assert updated.email_service.google_service_account_client_id == CLIENT_ID
        raw = org.settings["email_service"]["google_service_account_key"]
        assert raw.startswith("enc:")
        assert "PRIVATE KEY" not in raw

"""
Member-visible PII and infrastructure exposure (ORU-8).

Two endpoints returned more than the caller was entitled to:

  * `GET /users/with-roles` served every column on the user model while
    `GET /users` filtered contact details against the organization's
    contact_info_visibility setting. Both need only `users.view`, so the
    setting was bypassable by choosing the other URL.

  * `GET /organization/settings` is open to every authenticated member. It
    redacted credentials but not the identifiers they authenticate to.
"""

import uuid
from datetime import datetime, timezone

import pytest

from app.api.v1.endpoints.users import _redact_contact_fields
from app.models.user import User, UserStatus
from app.schemas.organization import OrganizationSettingsResponse

pytestmark = [pytest.mark.unit]


def _member() -> User:
    user = User(
        id=str(uuid.uuid4()),
        organization_id=str(uuid.uuid4()),
        username="jsmith",
        email="jsmith@example.com",
        personal_email="jsmith@example.org",
        first_name="Jordan",
        last_name="Smith",
        phone="555-0100",
        mobile="555-0199",
        address_street="12 Ladder Lane",
        address_city="Oakville",
        address_state="VA",
        address_zip="22046",
        address_country="US",
        status=UserStatus.ACTIVE,
        # Columns whose defaults only materialize on flush; this model is
        # never persisted because the redaction under test is pure.
        compliance_exempt=False,
        email_verified=True,
        mfa_enabled=False,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    user.positions = []
    return user


ALL_VISIBLE = {"show_email": True, "show_phone": True, "show_mobile": True}


class TestWithRolesContactRedaction:
    def test_hides_everything_when_visibility_is_off(self):
        result = _redact_contact_fields(_member(), {}, is_admin=False)

        assert result.email is None
        assert result.phone is None
        assert result.mobile is None

    def test_honors_each_visibility_flag_independently(self):
        result = _redact_contact_fields(
            _member(),
            {"show_email": True, "show_phone": False, "show_mobile": False},
            is_admin=False,
        )

        assert result.email == "jsmith@example.com"
        assert result.phone is None
        assert result.mobile is None

    def test_home_address_is_never_shown_to_non_admins(self):
        # The roster endpoint has no visibility flag for these at all, so
        # "all flags on" must still not disclose them.
        result = _redact_contact_fields(_member(), ALL_VISIBLE, is_admin=False)

        assert result.personal_email is None
        assert result.address_street is None
        assert result.address_city is None
        assert result.address_state is None
        assert result.address_zip is None
        assert result.address_country is None

    def test_members_managers_still_see_the_full_record(self):
        result = _redact_contact_fields(_member(), {}, is_admin=True)

        assert result.email == "jsmith@example.com"
        assert result.phone == "555-0100"
        assert result.address_street == "12 Ladder Lane"

    def test_non_contact_fields_survive_redaction(self):
        # Redaction must not blank the roster itself.
        result = _redact_contact_fields(_member(), {}, is_admin=False)

        assert result.first_name == "Jordan"
        assert result.last_name == "Smith"
        assert result.username == "jsmith"


class TestSettingsInfrastructureRedaction:
    def _settings(self) -> OrganizationSettingsResponse:
        return OrganizationSettingsResponse.model_validate(
            {
                "contact_info_visibility": {"enabled": False},
                "email_service": {
                    "platform": "selfhosted",
                    "smtp_host": "mail.internal.dept.test",
                    "smtp_user": "svc-mailer",
                    "smtp_password": "hunter2",
                    "microsoft_tenant_id": "tenant-abc",
                },
                "file_storage": {
                    "platform": "s3",
                    "s3_bucket_name": "oakville-fd-documents",
                    "s3_region": "us-east-2",
                    "s3_endpoint_url": "https://minio.internal.dept.test",
                    "s3_access_key_id": "AKIAEXAMPLE",
                    "s3_secret_access_key": "supersecret",
                },
                "auth": {
                    "provider": "authentik",
                    "authentik_url": "https://sso.internal.dept.test",
                    "authentik_client_id": "client-123",
                    "authentik_client_secret": "shh",
                },
            }
        )

    def test_strips_deployment_identifiers(self):
        stripped = self._settings().without_infrastructure()

        assert stripped.email_service.smtp_host is None
        assert stripped.email_service.smtp_user is None
        assert stripped.email_service.microsoft_tenant_id is None
        assert stripped.file_storage.s3_bucket_name is None
        assert stripped.file_storage.s3_region is None
        assert stripped.file_storage.s3_endpoint_url is None
        assert stripped.file_storage.s3_access_key_id is None
        assert stripped.auth.authentik_url is None
        assert stripped.auth.authentik_client_id is None

    def test_keeps_the_platform_and_provider_choices(self):
        # The UI needs to know which SSO button to render and which storage
        # backend is in use; those name products, not endpoints.
        stripped = self._settings().without_infrastructure()

        assert stripped.auth.provider == "authentik"
        assert stripped.file_storage.platform == "s3"
        assert stripped.email_service.platform == "selfhosted"

    def test_administrators_keep_the_full_settings(self):
        full = self._settings().redacted()

        assert full.email_service.smtp_host == "mail.internal.dept.test"
        assert full.file_storage.s3_bucket_name == "oakville-fd-documents"
        # Secrets stay redacted even for administrators.
        assert full.email_service.smtp_password != "hunter2"
        assert full.file_storage.s3_secret_access_key != "supersecret"

    def test_secrets_stay_redacted_after_stripping(self):
        stripped = self._settings().redacted().without_infrastructure()

        assert stripped.email_service.smtp_password != "hunter2"
        assert stripped.auth.authentik_client_secret != "shh"

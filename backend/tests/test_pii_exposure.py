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
from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.v1.endpoints.users import (
    _clear_hidden_contact_fields,
    _redact_contact_fields,
    get_user_with_roles,
)
from app.models.user import User, UserStatus
from app.schemas.organization import OrganizationSettingsResponse
from app.schemas.user import UserProfileResponse

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
        date_of_birth=date(1988, 4, 12),
        emergency_contacts=[
            {
                "name": "Alex Smith",
                "relationship": "Spouse",
                "phone": "555-0177",
                "is_primary": True,
            }
        ],
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


class TestLeadershipOnlyFields:
    """Date of birth and emergency contacts are restricted to leadership.

    Distinct from the contact block above: `contact_info_visibility` has no
    flag for these, so no organization setting can publish them. Emergency
    contacts are PII belonging to people who are not members at all.
    """

    def test_roster_hides_them_from_ordinary_members(self):
        result = _redact_contact_fields(_member(), ALL_VISIBLE, is_admin=False)

        assert result.date_of_birth is None
        assert result.emergency_contacts == []

    def test_no_visibility_setting_can_reveal_them(self):
        # Every flag on is still not enough — there is no flag for these.
        every_flag_on = dict.fromkeys(["show_email", "show_phone", "show_mobile"], True)
        result = _redact_contact_fields(_member(), every_flag_on, is_admin=False)

        assert result.date_of_birth is None
        assert result.emergency_contacts == []

    def test_leadership_sees_them(self):
        result = _redact_contact_fields(_member(), {}, is_admin=True)

        assert result.date_of_birth == date(1988, 4, 12)
        assert len(result.emergency_contacts) == 1
        assert result.emergency_contacts[0].name == "Alex Smith"


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
                "it_team": {
                    "members": [
                        {
                            "name": "Dana Reyes",
                            "email": "dana@it-contractor.test",
                            "phone": "555-0142",
                            "role": "Primary IT Contact",
                        }
                    ],
                    "backup_access": {
                        "notes": "Recovery codes in the safe, combination with Chief"
                    },
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

    def test_strips_the_it_team_block(self):
        # ORU-8b: names, direct contact details and break-glass notes for the
        # people who administer the deployment. Same disclosure class as the
        # identifiers above, and missed when those were stripped.
        stripped = self._settings().without_infrastructure()

        assert stripped.it_team.members == []
        assert stripped.it_team.backup_access == {}

    def test_administrators_keep_the_it_team_block(self):
        full = self._settings().redacted()

        assert len(full.it_team.members) == 1
        assert full.it_team.members[0].email == "dana@it-contractor.test"
        assert full.it_team.backup_access != {}


class TestProfileContactRedaction:
    """ORU-8a: `GET /users/{id}/with-roles` must redact on the roster's terms.

    The roster redacted and the detail endpoint did not, so the visibility
    setting was advisory: anything withheld on the roster was one request to
    the detail URL away.
    """

    def test_detail_and_roster_hide_the_same_fields(self):
        member = _member()
        roster = _redact_contact_fields(member, {}, is_admin=False)

        payload = UserProfileResponse.model_validate(member)
        _clear_hidden_contact_fields(payload, {})

        for field in (
            "email",
            "phone",
            "mobile",
            "personal_email",
            "address_street",
            "address_city",
            "address_state",
            "address_zip",
            "address_country",
        ):
            assert getattr(payload, field) == getattr(roster, field), field
            assert getattr(payload, field) is None, field

    def test_honors_each_visibility_flag_independently(self):
        payload = UserProfileResponse.model_validate(_member())
        _clear_hidden_contact_fields(
            payload, {"show_email": True, "show_phone": False, "show_mobile": True}
        )

        assert payload.email == "jsmith@example.com"
        assert payload.phone is None
        assert payload.mobile == "555-0199"

    def test_home_address_is_never_shown_even_when_all_flags_are_on(self):
        payload = UserProfileResponse.model_validate(_member())
        _clear_hidden_contact_fields(payload, ALL_VISIBLE)

        assert payload.address_street is None
        assert payload.personal_email is None

    def test_non_contact_fields_survive_redaction(self):
        payload = UserProfileResponse.model_validate(_member())
        _clear_hidden_contact_fields(payload, {})

        assert payload.first_name == "Jordan"
        assert payload.username == "jsmith"


class TestProfileEndpointAppliesRedaction:
    """The helper being correct is not the property that broke.

    ORU-8a was the endpoint never calling it, so these drive
    `get_user_with_roles` itself. Redaction is asserted at the boundary the
    client actually reads.
    """

    @staticmethod
    def _db_returning(user: User) -> MagicMock:
        db = MagicMock()
        result = MagicMock()
        result.scalar_one_or_none = MagicMock(return_value=user)
        db.execute = AsyncMock(return_value=result)
        return db

    @staticmethod
    def _caller(*, user_id: str, org_id: str, permissions: list[str]) -> MagicMock:
        caller = MagicMock()
        caller.id = user_id
        caller.username = "caller"
        caller.organization_id = org_id
        # Permissions are aggregated from `positions`, not `roles` — see
        # `_collect_user_permissions`. `rank` must be falsy or the rank-default
        # lookup runs against a MagicMock.
        position = MagicMock()
        position.permissions = permissions
        caller.positions = [position]
        caller.rank = None
        return caller

    async def _call(self, subject: User, caller: MagicMock) -> UserProfileResponse:
        with (
            patch("app.api.v1.endpoints.users.log_audit_event", new=AsyncMock()),
            patch(
                "app.api.v1.endpoints.users._load_contact_visibility",
                new=AsyncMock(return_value={}),
            ),
        ):
            return await get_user_with_roles(
                user_id=uuid.UUID(subject.id),
                db=self._db_returning(subject),
                current_user=caller,
            )

    async def test_plain_viewer_gets_a_redacted_profile(self):
        subject = _member()
        caller = self._caller(
            user_id=str(uuid.uuid4()),
            org_id=subject.organization_id,
            permissions=["users.view"],
        )

        result = await self._call(subject, caller)

        assert result.address_street is None
        assert result.personal_email is None
        assert result.phone is None
        # Still a usable profile — redaction, not removal.
        assert result.first_name == "Jordan"

    async def test_members_manager_gets_the_full_profile(self):
        subject = _member()
        caller = self._caller(
            user_id=str(uuid.uuid4()),
            org_id=subject.organization_id,
            permissions=["members.manage"],
        )

        result = await self._call(subject, caller)

        assert result.address_street == "12 Ladder Lane"
        assert result.personal_email == "jsmith@example.org"

    async def test_plain_viewer_gets_no_dob_or_emergency_contacts(self):
        subject = _member()
        caller = self._caller(
            user_id=str(uuid.uuid4()),
            org_id=subject.organization_id,
            permissions=["users.view"],
        )

        result = await self._call(subject, caller)

        assert result.date_of_birth is None
        assert result.emergency_contacts == []

    async def test_leadership_sees_dob_and_emergency_contacts(self):
        subject = _member()
        caller = self._caller(
            user_id=str(uuid.uuid4()),
            org_id=subject.organization_id,
            permissions=["members.manage"],
        )

        result = await self._call(subject, caller)

        assert result.date_of_birth == date(1988, 4, 12)
        assert result.emergency_contacts[0].phone == "555-0177"

    async def test_members_see_their_own_dob_and_emergency_contacts(self):
        subject = _member()
        caller = self._caller(
            user_id=subject.id,
            org_id=subject.organization_id,
            permissions=["users.view"],
        )

        result = await self._call(subject, caller)

        assert result.date_of_birth == date(1988, 4, 12)
        assert len(result.emergency_contacts) == 1

    async def test_members_see_their_own_contact_details(self):
        # UserSettingsPage loads the member's own profile through this endpoint
        # and writes the fields back on save. Redacting for self would blank a
        # member's own address and phone on their next save.
        subject = _member()
        caller = self._caller(
            user_id=subject.id,
            org_id=subject.organization_id,
            permissions=["users.view"],
        )

        result = await self._call(subject, caller)

        assert result.address_street == "12 Ladder Lane"
        assert result.phone == "555-0100"
        assert result.personal_email == "jsmith@example.org"

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
from fastapi import HTTPException

from app.api.v1.endpoints.users import (
    _clear_directory_only_profile_metadata,
    _clear_hidden_contact_fields,
    _profile_response,
    _redact_contact_fields,
    _withhold_profile_visibility,
    get_user_with_roles,
)
from app.models.user import Position, User, UserStatus
from app.schemas.organization import OrganizationSettingsResponse
from app.schemas.user import (
    PROFILE_VISIBILITY_DEFAULTS,
    ProfileVisibility,
    UserProfileResponse,
    normalize_profile_visibility,
    resolve_profile_visibility,
)
from app.services.user_service import UserService

pytestmark = [pytest.mark.unit]


def _member(profile_visibility: dict | None = None) -> User:
    user = User(
        id=str(uuid.uuid4()),
        # NULL by default: the state every pre-existing row is in, which must
        # resolve to exactly the behaviour the redaction had before the column.
        profile_visibility=profile_visibility,
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
        mfa_enabled=True,
        last_login_at=datetime(2026, 8, 1, 6, 30, tzinfo=timezone.utc),
        notification_preferences={"email": True, "sms_notifications": False},
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
    # `User.roles` is a synonym for `positions`; giving the subject one with a
    # real permissions list lets the role-permission redaction be observed.
    # is_system/priority defaults only materialize on flush, so set them.
    user.positions = [
        Position(
            id=str(uuid.uuid4()),
            organization_id=user.organization_id,
            name="Treasurer",
            slug="treasurer",
            permissions=["finance.view", "finance.manage"],
            is_system=False,
            priority=10,
        )
    ]
    return user


ALL_VISIBLE = {"show_email": True, "show_phone": True, "show_mobile": True}
DEFAULT_CHOICE = ProfileVisibility(**PROFILE_VISIBILITY_DEFAULTS)
SHARE_EVERYTHING = {
    "email": True,
    "personal_email": True,
    "phone": True,
    "mobile": True,
    "address": True,
}


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

    def test_home_address_is_hidden_unless_the_member_opts_in(self):
        # The organisation's setting has no flag for these at all: they are
        # the member's own call, and a member who has never chosen (NULL
        # column) has not opted in — so "all org flags on" must still not
        # disclose them.
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
                    "cloudflare_account_id": "0123456789abcdef0123456789abcdef",
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
        assert stripped.email_service.cloudflare_account_id is None
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
        _clear_hidden_contact_fields(payload, {}, DEFAULT_CHOICE)

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
            payload,
            {"show_email": True, "show_phone": False, "show_mobile": True},
            DEFAULT_CHOICE,
        )

        assert payload.email == "jsmith@example.com"
        assert payload.phone is None
        assert payload.mobile == "555-0199"

    def test_home_address_is_hidden_by_default_even_when_all_flags_are_on(self):
        payload = UserProfileResponse.model_validate(_member())
        _clear_hidden_contact_fields(payload, ALL_VISIBLE, DEFAULT_CHOICE)

        assert payload.address_street is None
        assert payload.personal_email is None

    def test_non_contact_fields_survive_redaction(self):
        payload = UserProfileResponse.model_validate(_member())
        _clear_hidden_contact_fields(payload, {}, DEFAULT_CHOICE)

        assert payload.first_name == "Jordan"
        assert payload.username == "jsmith"


class TestMemberPreferenceRedaction:
    """The member's own `profile_visibility` choice, combined with the org ceiling.

    Work contact fields show only when the organisation allows them AND the
    member does. Personal email and the home address answer to the member
    alone — there is no organisation flag for them, so the org switch being
    off must not hide them once the member has opted in, and the org switch
    being on must not reveal them while the member has not.
    """

    def test_member_can_hide_a_field_the_org_would_show(self):
        member = _member({**SHARE_EVERYTHING, "email": False, "mobile": False})
        result = _redact_contact_fields(member, ALL_VISIBLE, is_admin=False)

        assert result.email is None
        assert result.mobile is None
        assert result.phone == "555-0100"

    def test_org_ceiling_still_wins_over_a_member_who_shares(self):
        member = _member(SHARE_EVERYTHING)
        result = _redact_contact_fields(member, {}, is_admin=False)

        assert result.email is None
        assert result.phone is None
        assert result.mobile is None

    def test_personal_email_answers_to_the_member_alone(self):
        member = _member(SHARE_EVERYTHING)
        # Org switch off: the ceiling covers work contact fields only.
        result = _redact_contact_fields(member, {}, is_admin=False)

        assert result.personal_email == "jsmith@example.org"

    def test_address_is_shown_as_a_whole_when_opted_in(self):
        member = _member({**PROFILE_VISIBILITY_DEFAULTS, "address": True})
        result = _redact_contact_fields(member, {}, is_admin=False)

        assert result.address_street == "12 Ladder Lane"
        assert result.address_city == "Oakville"
        assert result.address_state == "VA"
        assert result.address_zip == "22046"
        assert result.address_country == "US"

    def test_address_is_hidden_as_a_whole_when_not(self):
        member = _member({**SHARE_EVERYTHING, "address": False})
        result = _redact_contact_fields(member, ALL_VISIBLE, is_admin=False)

        for field in (
            "address_street",
            "address_city",
            "address_state",
            "address_zip",
            "address_country",
        ):
            assert getattr(result, field) is None, field

    def test_detail_endpoint_and_roster_agree_on_the_member_choice(self):
        member = _member({**SHARE_EVERYTHING, "phone": False})
        roster = _redact_contact_fields(member, ALL_VISIBLE, is_admin=False)

        payload = UserProfileResponse.model_validate(member)
        _clear_hidden_contact_fields(
            payload, ALL_VISIBLE, resolve_profile_visibility(member)
        )

        for field in ("email", "phone", "mobile", "personal_email", "address_street"):
            assert getattr(payload, field) == getattr(roster, field), field
        assert payload.phone is None
        assert payload.address_street == "12 Ladder Lane"

    def test_members_manager_is_not_subject_to_the_member_choice(self):
        member = _member({**SHARE_EVERYTHING, "email": False, "address": False})
        result = _redact_contact_fields(member, {}, is_admin=True)

        assert result.email == "jsmith@example.com"
        assert result.address_street == "12 Ladder Lane"


class TestProfileVisibilityResolver:
    """NULL and malformed storage resolve to the defaults, never to an error."""

    def test_null_column_is_the_defaults(self):
        assert normalize_profile_visibility(None) == PROFILE_VISIBILITY_DEFAULTS

    def test_defaults_reproduce_the_pre_column_behaviour(self):
        # Work contact fields shown where the org allows; personal email and
        # address hidden. Changing these changes every existing installation's
        # roster on upgrade, so they are pinned by value.
        assert PROFILE_VISIBILITY_DEFAULTS == {
            "email": True,
            "personal_email": False,
            "phone": True,
            "mobile": True,
            "address": False,
        }

    def test_partial_dict_fills_missing_keys_from_defaults(self):
        assert normalize_profile_visibility({"address": True}) == {
            **PROFILE_VISIBILITY_DEFAULTS,
            "address": True,
        }

    def test_only_genuine_booleans_are_honoured(self):
        stored = {"email": "no", "phone": 0, "mobile": 1, "address": "true", "x": 1}
        assert normalize_profile_visibility(stored) == PROFILE_VISIBILITY_DEFAULTS

    def test_non_dict_storage_is_the_defaults(self):
        assert normalize_profile_visibility(["email"]) == PROFILE_VISIBILITY_DEFAULTS
        assert normalize_profile_visibility("email") == PROFILE_VISIBILITY_DEFAULTS

    def test_resolver_tolerates_an_object_without_the_attribute(self):
        class Bare:
            pass

        assert resolve_profile_visibility(Bare()) == DEFAULT_CHOICE

    def test_schema_refuses_partial_extra_and_non_bool(self):
        import pydantic

        with pytest.raises(pydantic.ValidationError):
            ProfileVisibility(**{**SHARE_EVERYTHING, "address": "true"})
        with pytest.raises(pydantic.ValidationError):
            ProfileVisibility(
                **{k: v for k, v in SHARE_EVERYTHING.items() if k != "address"}
            )
        with pytest.raises(pydantic.ValidationError):
            ProfileVisibility(**SHARE_EVERYTHING, date_of_birth=True)


class _ScalarsResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return self._rows


class TestListUsersHonorsMemberPreference:
    """`GET /users` (the directory) applies the member choice inside the org ceiling."""

    @staticmethod
    def _service_for(user: User) -> UserService:
        db = MagicMock()
        db.execute = AsyncMock(return_value=_ScalarsResult([user]))
        return UserService(db)

    async def test_member_hiding_phone_is_hidden_on_the_directory(self):
        member = _member({**SHARE_EVERYTHING, "phone": False})
        rows = await self._service_for(member).get_users_for_organization(
            organization_id=uuid.UUID(member.organization_id),
            include_contact_info=True,
            contact_settings={"contact_info_visibility": ALL_VISIBLE},
        )

        assert rows[0].phone is None
        assert rows[0].email == "jsmith@example.com"
        assert rows[0].mobile == "555-0199"

    async def test_org_switch_off_hides_everything_regardless(self):
        member = _member(SHARE_EVERYTHING)
        rows = await self._service_for(member).get_users_for_organization(
            organization_id=uuid.UUID(member.organization_id),
            include_contact_info=False,
            contact_settings=None,
        )

        assert rows[0].email is None
        assert rows[0].phone is None
        assert rows[0].mobile is None

    async def test_members_manager_is_exempt_from_the_member_choice(self):
        # The management table and its CSV export must keep what leadership
        # keeps on the profile; the org ceiling still applies to them here.
        member = _member({**SHARE_EVERYTHING, "phone": False, "mobile": False})
        rows = await self._service_for(member).get_users_for_organization(
            organization_id=uuid.UUID(member.organization_id),
            include_contact_info=True,
            contact_settings={
                "contact_info_visibility": {**ALL_VISIBLE, "show_mobile": False}
            },
            honor_member_choice=False,
        )

        assert rows[0].phone == "555-0100"
        assert rows[0].mobile is None


class TestWithholdProfileVisibility:
    """Every route serialising UserProfileResponse withholds the choice object
    from anyone but the subject and members-managers — including the two
    PATCH routes a users.edit holder may use on a colleague."""

    @staticmethod
    def _payload() -> UserProfileResponse:
        return UserProfileResponse.model_validate(_member(SHARE_EVERYTHING))

    def test_subject_keeps_it(self):
        payload = self._payload()
        _withhold_profile_visibility(payload, _caller_with([]), is_self=True)

        assert payload.profile_visibility is not None

    def test_members_manager_keeps_it(self):
        payload = self._payload()
        _withhold_profile_visibility(
            payload, _caller_with(["members.manage"]), is_self=False
        )

        assert payload.profile_visibility is not None

    def test_users_edit_holder_does_not(self):
        payload = self._payload()
        _withhold_profile_visibility(
            payload, _caller_with(["users.edit", "users.view"]), is_self=False
        )

        assert payload.profile_visibility is None

    def test_profile_writes_hand_the_row_back_to_subject_and_managers(self):
        # The row itself, serialised by FastAPI as before — not a rebuilt
        # payload — so the write handlers stay indifferent to row shape.
        member = _member(SHARE_EVERYTHING)
        assert _profile_response(member, _caller_with([]), is_self=True) is member
        assert (
            _profile_response(member, _caller_with(["members.manage"]), is_self=False)
            is member
        )

    def test_profile_writes_withhold_the_choice_from_a_users_edit_holder(self):
        member = _member(SHARE_EVERYTHING)
        result = _profile_response(member, _caller_with(["users.edit"]), is_self=False)

        assert isinstance(result, UserProfileResponse)
        assert result.profile_visibility is None
        assert result.address_street == "12 Ladder Lane"


def _caller_with(permissions: list[str]) -> MagicMock:
    return _caller(
        user_id=str(uuid.uuid4()), org_id=str(uuid.uuid4()), permissions=permissions
    )


class TestDirectoryProfileMetadataRedaction:
    """Account and authorization metadata is leadership/self-only.

    `members.view` opens any colleague's profile, so anything the profile
    passes through is org-wide public. `mfa_enabled` in particular maps which
    accounts lack MFA; the roles' permissions lists map the org's access
    control. No contact-visibility flag exists for any of these.
    """

    def test_clears_account_and_authorization_metadata(self):
        payload = UserProfileResponse.model_validate(_member())

        _clear_directory_only_profile_metadata(payload)

        # None, not False: a neutral False would misreport an MFA-protected
        # account as unprotected.
        assert payload.email_verified is None
        assert payload.mfa_enabled is None
        assert payload.last_login_at is None
        assert payload.created_at is None
        assert payload.updated_at is None
        assert payload.notification_preferences is None
        assert payload.roles[0].permissions == []

    def test_role_names_survive_but_permissions_are_blanked(self):
        payload = UserProfileResponse.model_validate(_member())
        assert payload.roles[0].permissions  # factory sanity check

        _clear_directory_only_profile_metadata(payload)

        # The profile page renders role names only; the permission map is the
        # part with security value.
        assert payload.roles[0].name == "Treasurer"
        assert payload.roles[0].permissions == []

    def test_does_not_mutate_the_orm_row(self):
        # The helper edits the response payload; the Position row backing the
        # role must keep its permissions or the redaction would corrupt the
        # in-session object other code still reads.
        member = _member()
        payload = UserProfileResponse.model_validate(member)
        _clear_directory_only_profile_metadata(payload)

        assert member.positions[0].permissions == ["finance.view", "finance.manage"]


def _db_returning(user: User) -> MagicMock:
    db = MagicMock()
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=user)
    db.execute = AsyncMock(return_value=result)
    return db


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


async def _call_endpoint(subject: User, caller: MagicMock) -> UserProfileResponse:
    with (
        patch("app.api.v1.endpoints.users.log_audit_event", new=AsyncMock()),
        patch(
            "app.api.v1.endpoints.users._load_contact_visibility",
            new=AsyncMock(return_value={}),
        ),
    ):
        return await get_user_with_roles(
            user_id=uuid.UUID(subject.id),
            db=_db_returning(subject),
            current_user=caller,
        )


class TestProfileEndpointAppliesRedaction:
    """The helper being correct is not the property that broke.

    ORU-8a was the endpoint never calling it, so these drive
    `get_user_with_roles` itself. Redaction is asserted at the boundary the
    client actually reads.
    """

    async def test_plain_viewer_gets_a_redacted_profile(self):
        subject = _member()
        caller = _caller(
            user_id=str(uuid.uuid4()),
            org_id=subject.organization_id,
            permissions=["users.view"],
        )

        result = await _call_endpoint(subject, caller)

        assert result.address_street is None
        assert result.personal_email is None
        assert result.phone is None
        # Still a usable profile — redaction, not removal.
        assert result.first_name == "Jordan"

    async def test_members_manager_gets_the_full_profile(self):
        subject = _member()
        caller = _caller(
            user_id=str(uuid.uuid4()),
            org_id=subject.organization_id,
            permissions=["members.manage"],
        )

        result = await _call_endpoint(subject, caller)

        assert result.address_street == "12 Ladder Lane"
        assert result.personal_email == "jsmith@example.org"

    async def test_plain_viewer_sees_what_the_member_opted_to_share(self):
        subject = _member({**PROFILE_VISIBILITY_DEFAULTS, "address": True})
        caller = _caller(
            user_id=str(uuid.uuid4()),
            org_id=subject.organization_id,
            permissions=["members.view"],
        )

        result = await _call_endpoint(subject, caller)

        assert result.address_street == "12 Ladder Lane"
        assert result.address_zip == "22046"
        # Still under the org ceiling (patched to {} in _call_endpoint).
        assert result.email is None

    async def test_plain_viewer_never_receives_the_choice_object(self):
        # The nulls say nothing about whether a field is empty or withheld;
        # the choice object would say exactly that.
        subject = _member({**SHARE_EVERYTHING, "address": False})
        for permission in ("users.view", "members.view"):
            caller = _caller(
                user_id=str(uuid.uuid4()),
                org_id=subject.organization_id,
                permissions=[permission],
            )

            result = await _call_endpoint(subject, caller)

            assert result.profile_visibility is None, permission

    async def test_member_receives_their_own_resolved_choice(self):
        subject = _member()  # NULL column
        caller = _caller(
            user_id=subject.id,
            org_id=subject.organization_id,
            permissions=[],
        )

        result = await _call_endpoint(subject, caller)

        assert result.profile_visibility == DEFAULT_CHOICE

    async def test_members_manager_receives_the_resolved_choice(self):
        subject = _member({**PROFILE_VISIBILITY_DEFAULTS, "mobile": False})
        caller = _caller(
            user_id=str(uuid.uuid4()),
            org_id=subject.organization_id,
            permissions=["members.manage"],
        )

        result = await _call_endpoint(subject, caller)

        assert result.profile_visibility is not None
        assert result.profile_visibility.mobile is False
        assert result.profile_visibility.email is True

    async def test_malformed_storage_resolves_without_raising(self):
        subject = _member({"email": "yes", "junk": 1})
        caller = _caller(
            user_id=subject.id,
            org_id=subject.organization_id,
            permissions=[],
        )

        result = await _call_endpoint(subject, caller)

        assert result.profile_visibility == DEFAULT_CHOICE

    async def test_plain_viewer_gets_no_dob_or_emergency_contacts(self):
        subject = _member()
        caller = _caller(
            user_id=str(uuid.uuid4()),
            org_id=subject.organization_id,
            permissions=["users.view"],
        )

        result = await _call_endpoint(subject, caller)

        assert result.date_of_birth is None
        assert result.emergency_contacts == []

    async def test_leadership_sees_dob_and_emergency_contacts(self):
        subject = _member()
        caller = _caller(
            user_id=str(uuid.uuid4()),
            org_id=subject.organization_id,
            permissions=["members.manage"],
        )

        result = await _call_endpoint(subject, caller)

        assert result.date_of_birth == date(1988, 4, 12)
        assert result.emergency_contacts[0].phone == "555-0177"

    async def test_members_see_their_own_dob_and_emergency_contacts(self):
        subject = _member()
        caller = _caller(
            user_id=subject.id,
            org_id=subject.organization_id,
            permissions=["users.view"],
        )

        result = await _call_endpoint(subject, caller)

        assert result.date_of_birth == date(1988, 4, 12)
        assert len(result.emergency_contacts) == 1

    async def test_plain_viewer_gets_no_account_security_metadata(self):
        subject = _member()
        caller = _caller(
            user_id=str(uuid.uuid4()),
            org_id=subject.organization_id,
            permissions=["members.view"],
        )

        result = await _call_endpoint(subject, caller)

        assert result.mfa_enabled is None
        assert result.email_verified is None
        assert result.last_login_at is None
        assert result.notification_preferences is None
        # Role names still render on the profile page; the permission map
        # does not leave the server.
        assert result.roles[0].name == "Treasurer"
        assert result.roles[0].permissions == []

    async def test_members_manager_keeps_account_security_metadata(self):
        subject = _member()
        caller = _caller(
            user_id=str(uuid.uuid4()),
            org_id=subject.organization_id,
            permissions=["members.manage"],
        )

        result = await _call_endpoint(subject, caller)

        assert result.mfa_enabled is True
        assert result.email_verified is True
        assert result.last_login_at is not None
        assert result.notification_preferences == {
            "email": True,
            "sms_notifications": False,
        }
        assert result.roles[0].permissions == ["finance.view", "finance.manage"]

    async def test_members_keep_their_own_account_security_metadata(self):
        # UserSettingsPage shows the member their own MFA state and
        # notification preferences through this endpoint.
        subject = _member()
        caller = _caller(
            user_id=subject.id,
            org_id=subject.organization_id,
            permissions=[],
        )

        result = await _call_endpoint(subject, caller)

        assert result.mfa_enabled is True
        assert result.email_verified is True
        assert result.last_login_at is not None
        assert result.notification_preferences == {
            "email": True,
            "sms_notifications": False,
        }
        assert result.roles[0].permissions == ["finance.view", "finance.manage"]

    async def test_members_see_their_own_contact_details(self):
        # UserSettingsPage loads the member's own profile through this endpoint
        # and writes the fields back on save. Redacting for self would blank a
        # member's own address and phone on their next save.
        subject = _member()
        caller = _caller(
            user_id=subject.id,
            org_id=subject.organization_id,
            permissions=["users.view"],
        )

        result = await _call_endpoint(subject, caller)

        assert result.address_street == "12 Ladder Lane"
        assert result.phone == "555-0100"
        assert result.personal_email == "jsmith@example.org"


class TestProfileEndpointAccessControl:
    """Self-access to `GET /users/{id}/with-roles` needs no permission grant.

    The default Member position carries neither `users.view` nor
    `members.manage`, yet MemberIdCardPage, MemberProfilePage and
    UserSettingsPage all load the caller's own record through this endpoint —
    gating it entirely behind those permissions 403'd every ordinary member
    off their own ID card. Viewing anyone else requires a grant:
    `members.view` (the directory permission every default position carries)
    opens a redacted profile; a caller with no grants at all is refused.
    """

    async def test_member_without_grants_reads_their_own_record(self):
        subject = _member()
        caller = _caller(
            user_id=subject.id,
            org_id=subject.organization_id,
            permissions=[],
        )

        result = await _call_endpoint(subject, caller)

        assert result.username == "jsmith"
        # Self-access is also exempt from redaction, per the tests above.
        assert result.phone == "555-0100"

    async def test_member_without_grants_cannot_read_someone_else(self):
        subject = _member()
        caller = _caller(
            user_id=str(uuid.uuid4()),
            org_id=subject.organization_id,
            permissions=[],
        )

        with pytest.raises(HTTPException) as exc:
            await _call_endpoint(subject, caller)

        assert exc.value.status_code == 403

    async def test_users_view_still_reads_other_records(self):
        subject = _member()
        caller = _caller(
            user_id=str(uuid.uuid4()),
            org_id=subject.organization_id,
            permissions=["users.view"],
        )

        result = await _call_endpoint(subject, caller)

        assert result.username == "jsmith"

    async def test_members_view_reads_other_records_redacted(self):
        # The directory permission opens colleagues' profiles, but on the
        # roster's terms: contact info per org visibility settings (all off
        # here), DOB and emergency contacts leadership-only.
        subject = _member()
        caller = _caller(
            user_id=str(uuid.uuid4()),
            org_id=subject.organization_id,
            permissions=["members.view"],
        )

        result = await _call_endpoint(subject, caller)

        assert result.username == "jsmith"
        assert result.phone is None
        assert result.address_street is None
        assert result.date_of_birth is None
        assert result.emergency_contacts == []
        assert result.email_verified is None
        assert result.mfa_enabled is None
        assert result.created_at is None
        assert result.updated_at is None
        assert result.notification_preferences is None

    async def test_members_manage_reads_other_records_unredacted(self):
        subject = _member()
        caller = _caller(
            user_id=str(uuid.uuid4()),
            org_id=subject.organization_id,
            permissions=["members.manage"],
        )

        result = await _call_endpoint(subject, caller)

        assert result.username == "jsmith"
        # members.manage is the leadership grant: contact info, emergency
        # contacts and account metadata all come through unredacted.
        assert result.phone == "555-0100"
        assert result.emergency_contacts != []
        assert result.email_verified is True

    async def test_users_view_retains_account_metadata(self):
        subject = _member()
        caller = _caller(
            user_id=str(uuid.uuid4()),
            org_id=subject.organization_id,
            permissions=["users.view"],
        )

        result = await _call_endpoint(subject, caller)

        assert result.email_verified is True
        assert result.created_at is not None

    async def test_wildcard_grant_satisfies_the_gate(self):
        # `users.*` must satisfy `users.view` — the gate goes through
        # `_has_permission`, which is wildcard-aware.
        subject = _member()
        caller = _caller(
            user_id=str(uuid.uuid4()),
            org_id=subject.organization_id,
            permissions=["users.*"],
        )

        result = await _call_endpoint(subject, caller)

        assert result.username == "jsmith"

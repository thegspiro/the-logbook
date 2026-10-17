"""Google Workspace accounts for members converted from applicants.

Covers the config schema, the Directory connector's error translation, the
conversion hook (the account is created only after the member commits, and
its password reaches the member's personal address) and the officer retry.
Google itself is never called: ``directory_for`` is replaced by a fake.
"""

import asyncio
import json
import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.directory_account import (
    GOOGLE_WORKSPACE_INTEGRATION,
    DirectoryAccountProvision,
    DirectoryAccountStatus,
)
from app.models.integration import Integration
from app.models.user import Organization, User, UserStatus
from app.schemas.integration import GoogleWorkspaceConfig
from app.services.directory_account_service import (
    DirectoryAccountService,
    ProvisionRetryError,
    ProvisionRetryTooSoon,
    credentials_html,
)
from app.services.email_service import append_to_email_html
from app.services.integration_services.google_workspace_service import (
    GOOGLE_WORKSPACE_PROVIDER,
    GoogleAccountExistsError,
    GoogleWorkspaceDirectory,
    GoogleWorkspaceError,
    _translate,
    directory_for,
    to_directory_account,
)
from app.services.membership_pipeline_service import MembershipPipelineService

SERVICE = "app.services.directory_account_service"
DOMAIN = "firedept.org"
GROUP = "members@firedept.org"


def _key(**overrides: Any) -> str:
    key = {
        "type": "service_account",
        "client_email": "provisioner@project.iam.gserviceaccount.com",
        "private_key": "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
        "token_uri": "https://oauth2.googleapis.com/token",
    }
    key.update(overrides)
    return json.dumps(key)


def _tag(member_id: str) -> dict:
    from app.services.integration_services.google_workspace_service import (
        LOGBOOK_EXTERNAL_ID_TYPE,
    )

    return {
        "type": "custom",
        "customType": LOGBOOK_EXTERNAL_ID_TYPE,
        "value": member_id,
    }


class FakeDirectory:
    """Stands in for GoogleWorkspaceDirectory; records what it was asked."""

    def __init__(
        self,
        create_error: Optional[Exception] = None,
        group_error: Optional[Exception] = None,
        reset_error: Optional[Exception] = None,
    ):
        self.create_error = create_error
        self.group_error = group_error
        self.reset_error = reset_error
        self.created: list[tuple[str, ...]] = []
        self.groups: list[tuple[str, str]] = []
        self.resets: list[str] = []
        self.suspend_calls = []
        self.keys = []
        self.member_ids: list[str] = []
        self.domain_users: list[dict] = []

    async def create_user(self, email, given, family, password, member_id):
        if self.create_error:
            raise self.create_error
        self.created.append((email, given, family, password))
        self.member_ids.append(member_id)
        return "google-id-1"

    async def add_to_group(self, group, email):
        if self.group_error:
            raise self.group_error
        self.groups.append((group, email))

    async def reset_password(self, key, password):
        if self.reset_error:
            raise self.reset_error
        self.keys.append(key)
        self.resets.append(password)

    # ``existing`` is what users.get answers for the address (an account
    # created elsewhere); ``lookup_error`` replaces that answer. ``suspended``
    # is Google's suspension state for the one account.
    existing: Optional[dict] = None
    lookup_error: Optional[Exception] = None
    suspended = False
    suspend_error: Optional[Exception] = None
    suspend_calls: list[bool]
    keys: list[str]

    async def list_users(self, domain):
        return [to_directory_account(u) for u in self.domain_users]

    async def get_user(self, key):
        self.keys.append(key)
        if self.suspend_error:
            raise self.suspend_error
        if self.lookup_error:
            raise self.lookup_error
        account = dict(self.existing or {"id": "google-id-1"})
        account["suspended"] = self.suspended
        return to_directory_account(account)

    async def is_suspended(self, key):
        return (await self.get_user(key)).suspended

    async def set_suspended(self, key, suspended):
        if self.suspend_error:
            raise self.suspend_error
        self.keys.append(key)
        self.suspend_calls.append(suspended)
        self.suspended = suspended


# ---------------------------------------------------------------------------
# Unit: no database
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestConfigSchema:
    def test_a_valid_config_is_normalized(self):
        config = GoogleWorkspaceConfig(
            service_account_key=_key(),
            admin_email=" Admin@FireDept.org ",
            domain="FireDept.org",
            org_unit_path=" /Members ",
            group_emails=["Members@firedept.org", "members@firedept.org"],
        )
        assert config.admin_email == "admin@firedept.org"
        assert config.domain == "firedept.org"
        assert config.org_unit_path == "/Members"
        assert config.group_emails == ["members@firedept.org"]

    @pytest.mark.parametrize(
        "key",
        [
            "not json",
            json.dumps(["a"]),
            _key(type="authorized_user"),
            _key(private_key=""),
        ],
    )
    def test_anything_but_a_service_account_key_is_refused(self, key):
        with pytest.raises(ValidationError):
            GoogleWorkspaceConfig(
                service_account_key=key, admin_email="a@firedept.org", domain=DOMAIN
            )

    @pytest.mark.parametrize(
        "domain", ["", "firedept", "http://firedept.org", "a b.org"]
    )
    def test_a_bad_domain_is_refused(self, domain):
        with pytest.raises(ValidationError):
            GoogleWorkspaceConfig(admin_email="a@firedept.org", domain=domain)

    def test_an_org_unit_must_be_a_path(self):
        with pytest.raises(ValidationError):
            GoogleWorkspaceConfig(
                admin_email="a@firedept.org", domain=DOMAIN, org_unit_path="Members"
            )

    def test_the_group_list_is_capped(self):
        with pytest.raises(ValidationError):
            GoogleWorkspaceConfig(
                admin_email="a@firedept.org",
                domain=DOMAIN,
                group_emails=[f"g{i}@firedept.org" for i in range(21)],
            )

    def test_an_omitted_key_is_not_reported_as_supplied(self):
        # The update handler merges only supplied keys; an empty default must
        # not wipe the stored, encrypted key.
        config = GoogleWorkspaceConfig(admin_email="a@firedept.org", domain=DOMAIN)
        assert "service_account_key" not in config.model_dump(exclude_unset=True)


def _http_error(status: int):
    from googleapiclient.errors import HttpError

    return HttpError(SimpleNamespace(status=status, reason="x"), b'{"error": "raw"}')


@pytest.mark.unit
class TestErrorTranslation:
    def test_a_conflict_means_the_address_exists(self):
        assert isinstance(_translate(_http_error(409), "x"), GoogleAccountExistsError)

    @pytest.mark.parametrize("status", [400, 401, 403, 404, 412, 429, 503, 418])
    def test_messages_are_written_here_not_copied(self, status):
        translated = _translate(_http_error(status), "account creation")
        assert isinstance(translated, GoogleWorkspaceError)
        assert "raw" not in str(translated)

    def test_a_delegation_failure_says_so(self):
        from google.auth.exceptions import RefreshError

        translated = _translate(RefreshError("unauthorized_client"), "x")
        assert "delegation" in str(translated)

    async def test_already_being_a_group_member_is_success(self):
        directory = GoogleWorkspaceDirectory({}, "admin@firedept.org")
        service = MagicMock()
        service.members.return_value.insert.return_value.execute.side_effect = (
            _http_error(409)
        )
        with patch.object(directory, "_service", return_value=service):
            await directory.add_to_group(GROUP, "a@firedept.org")

    def test_a_missing_key_is_reported_before_google_is_called(self):
        integration = Integration(config={"admin_email": "a@firedept.org"})
        with pytest.raises(GoogleWorkspaceError):
            directory_for(integration)


@pytest.mark.unit
class TestCredentialsBlock:
    def test_values_are_escaped(self):
        block = credentials_html(GOOGLE_WORKSPACE_PROVIDER, "a@firedept.org", "<b>&pw")
        assert "&lt;b&gt;&amp;pw" in block
        assert "<b>&pw" not in block

    def test_the_block_goes_above_the_footer(self):
        body = '<div class="content">x</div><div class="footer">f</div></body>'
        result = append_to_email_html(body, "BLOCK")
        assert result.index("BLOCK") < result.index('<div class="footer"')

    def test_a_body_without_footer_or_body_tag_gets_it_appended(self):
        assert append_to_email_html("<p>x</p>", "BLOCK").endswith("BLOCK")


# ---------------------------------------------------------------------------
# Integration: database
# ---------------------------------------------------------------------------


def _hex() -> str:
    return uuid.uuid4().hex[:8]


async def _org(db: AsyncSession, *, department_email: bool = True) -> Organization:
    org = Organization(
        name="Google Test VFD",
        slug=f"gws-{_hex()}",
        settings=(
            {
                "department_email": {
                    "enabled": True,
                    "domain": DOMAIN,
                    "format": "first.last",
                }
            }
            if department_email
            else {}
        ),
    )
    db.add(org)
    await db.flush()
    return org


async def _connect(db: AsyncSession, org: Organization, **config: Any) -> Integration:
    integration = Integration(
        organization_id=org.id,
        integration_type=GOOGLE_WORKSPACE_INTEGRATION,
        name="Google Workspace",
        category="Access Control",
        status="connected",
        enabled=True,
        config={
            "admin_email": "admin@firedept.org",
            "domain": DOMAIN,
            "org_unit_path": "/Members",
            "group_emails": [GROUP],
            **config,
        },
    )
    integration.set_secret("service_account_key", _key())
    db.add(integration)
    await db.flush()
    return integration


async def _prospect(db: AsyncSession, org: Organization):
    svc = MembershipPipelineService(db)
    prospect = await svc.create_prospect(
        organization_id=org.id,
        data={
            "first_name": "Jordan",
            "last_name": f"Hale{_hex()}",
            "email": f"jordan-{_hex()}@example.org",
        },
    )
    return svc, await svc.get_prospect(str(prospect.id), org.id)


async def _row(db: AsyncSession, user_id: str) -> DirectoryAccountProvision:
    row = (
        await db.execute(
            select(DirectoryAccountProvision).where(
                DirectoryAccountProvision.user_id == str(user_id)
            )
        )
    ).scalar_one()
    await db.refresh(row)
    return row


@pytest.mark.integration
class TestConversion:
    async def test_without_the_integration_nothing_changes(self, db_session):
        org = await _org(db_session)
        svc, prospect = await _prospect(db_session, org)

        result = await svc._do_transfer(prospect, None)

        assert result["success"] is True
        assert result["google_account"] is None
        assert "_provision_directory_account" not in result
        assert "_send_welcome_email" not in result

    async def test_the_welcome_email_waits_and_carries_the_google_password(
        self, db_session
    ):
        org = await _org(db_session)
        await _connect(db_session, org)
        svc, prospect = await _prospect(db_session, org)
        fake = FakeDirectory()

        with patch.object(
            svc, "_send_transfer_welcome_email", AsyncMock(return_value=True)
        ) as welcome:
            result = await svc._do_transfer(prospect, None, send_welcome_email=True)
            # Nothing reaches Google or the member before the caller commits.
            welcome.assert_not_called()
            assert result["google_account"]["status"] == "pending"
            await db_session.commit()

            with patch(f"{SERVICE}.directory_for", return_value=fake):
                assert await result["_send_welcome_email"]() is True

        dept = result["email"]
        assert dept.endswith(f"@{DOMAIN}")
        assert fake.created[0][0] == dept
        assert fake.member_ids == [str(result["user_id"])]
        assert fake.groups == [(GROUP, dept)]
        kwargs = welcome.call_args.kwargs
        # The new mailbox cannot receive the password that opens it.
        assert kwargs["recipient_email"] == prospect.email
        assert kwargs["directory_account"] == (
            GOOGLE_WORKSPACE_PROVIDER,
            dept,
            fake.created[0][3],
        )
        assert kwargs["temp_password"] != fake.created[0][3]

        row = await _row(db_session, result["user_id"])
        assert row.status == DirectoryAccountStatus.CREATED.value
        assert row.credentials_sent is True
        assert row.pending_groups is None

    async def test_without_a_welcome_email_the_password_goes_on_its_own(
        self, db_session
    ):
        org = await _org(db_session)
        await _connect(db_session, org)
        svc, prospect = await _prospect(db_session, org)
        fake = FakeDirectory()

        result = await svc._do_transfer(prospect, None, send_welcome_email=False)
        await db_session.commit()
        with (
            patch(f"{SERVICE}.directory_for", return_value=fake),
            patch(
                "app.services.email_service.EmailService.send_email",
                AsyncMock(return_value=(1, 0)),
            ) as send,
        ):
            await result["_provision_directory_account"]()

        assert send.call_args.kwargs["to_emails"] == [prospect.email]
        assert fake.created[0][3] in send.call_args.kwargs["text_body"]
        row = await _row(db_session, result["user_id"])
        assert row.credentials_sent is True

    async def test_a_crash_in_provisioning_still_sends_the_welcome_email(
        self, db_session
    ):
        org = await _org(db_session)
        await _connect(db_session, org)
        svc, prospect = await _prospect(db_session, org)

        with patch.object(
            svc, "_send_transfer_welcome_email", AsyncMock(return_value=True)
        ) as welcome:
            result = await svc._do_transfer(prospect, None, send_welcome_email=True)
            await db_session.commit()
            with patch.object(
                DirectoryAccountService,
                "provision",
                AsyncMock(side_effect=RuntimeError("boom")),
            ):
                assert await result["_send_welcome_email"]() is True

        assert welcome.call_args.kwargs["directory_account"] is None
        assert welcome.call_args.kwargs["prospect"].first_name == "Jordan"

    async def _provision_into_existing(self, db_session, **lookup):
        """Convert a member whose address Google already holds."""
        org = await _org(db_session)
        await _connect(db_session, org)
        if lookup.get("former_account"):
            former = await _member(
                db_session,
                org,
                f"anon-{_hex()}@anonymized.invalid",
                status=UserStatus.DROPPED_VOLUNTARY,
            )
            db_session.add(
                DirectoryAccountProvision(
                    organization_id=org.id,
                    user_id=former.id,
                    primary_email=f"reused-{_hex()}@{DOMAIN}",
                    status=DirectoryAccountStatus.CREATED.value,
                    external_user_id=lookup["former_account"],
                )
            )
        svc, prospect = await _prospect(db_session, org)
        result = await svc._do_transfer(prospect, None)
        await db_session.commit()
        fake = FakeDirectory(create_error=GoogleAccountExistsError("exists"))
        fake.existing = lookup.get("existing")
        fake.lookup_error = lookup.get("lookup_error")
        if callable(fake.existing):
            fake.existing = fake.existing(result["email"], str(result["user_id"]))
        with (
            patch(f"{SERVICE}.directory_for", return_value=fake),
            patch(
                "app.services.email_service.EmailService.send_email",
                AsyncMock(return_value=(1, 0)),
            ) as send,
        ):
            await result["_provision_directory_account"]()
        return await _row(db_session, result["user_id"]), fake, send

    async def test_an_existing_account_is_linked_and_left_alone(self, db_session):
        row, fake, _ = await self._provision_into_existing(
            db_session,
            existing=lambda email, _member: {
                "id": "g-other",
                "primaryEmail": email,
                "creationTime": "2019-03-01T12:00:00.000Z",
            },
        )
        assert row.status == DirectoryAccountStatus.LINKED_EXISTING.value
        assert row.external_user_id == "g-other"
        assert fake.groups == []
        assert fake.resets == []
        assert row.credentials_sent is False

    async def test_an_alias_on_someone_elses_account_is_never_linked(self, db_session):
        # Google answers a lookup of an alias with the account that owns it.
        # Linking it would make this member's departure suspend that person.
        row, fake, _ = await self._provision_into_existing(
            db_session,
            existing={
                "id": "g-chief",
                "primaryEmail": "chief@firedept.org",
                "creationTime": "2019-03-01T12:00:00.000Z",
            },
        )
        assert row.status == DirectoryAccountStatus.FAILED.value
        assert row.external_user_id is None
        assert "alias" in (row.last_error or "")
        # Nothing of the chief's is ever touched: the member's departure
        # stages no suspension on a record with no account of its own.
        member = await db_session.get(User, row.user_id)
        member.status = UserStatus.DROPPED_VOLUNTARY
        await db_session.commit()
        await db_session.refresh(row)
        assert row.suspension_settled is True
        assert row.suspension_wanted is False

    async def test_an_address_held_by_a_group_is_never_linked(self, db_session):
        from app.services.integration_services.google_workspace_service import (
            GoogleAccountNotFoundError,
        )

        row, _, _ = await self._provision_into_existing(
            db_session, lookup_error=GoogleAccountNotFoundError("group")
        )
        assert row.status == DirectoryAccountStatus.FAILED.value
        assert "group" in (row.last_error or "")

    async def test_an_account_an_earlier_attempt_created_is_recognised_as_ours(
        self, db_session
    ):
        # users.insert succeeded at Google but its answer never arrived; the
        # retry's 409 is The Logbook's own account -- tagged with this
        # member's id at creation -- whose password nobody has.
        row, fake, send = await self._provision_into_existing(
            db_session,
            existing=lambda email, member: {
                "id": "g-ours",
                "primaryEmail": email,
                "externalIds": [_tag(member)],
            },
        )
        assert row.status == DirectoryAccountStatus.CREATED.value
        assert row.external_user_id == "g-ours"
        assert fake.keys[-1] == "g-ours"
        assert len(fake.resets) == 1
        assert fake.resets[0] in send.call_args.kwargs["text_body"]
        assert row.credentials_sent is True

    async def test_an_account_created_moments_ago_by_someone_else_is_not_ours(
        self, db_session
    ):
        # Recency proves nothing: only the tag does.
        row, fake, _ = await self._provision_into_existing(
            db_session,
            existing=lambda email, _member: {
                "id": "g-new",
                "primaryEmail": email,
                "creationTime": datetime.now(timezone.utc).isoformat(),
            },
        )
        assert row.status == DirectoryAccountStatus.LINKED_EXISTING.value
        assert fake.resets == []

    async def test_an_account_tagged_for_another_member_is_not_reset(self, db_session):
        row, fake, _ = await self._provision_into_existing(
            db_session,
            existing=lambda email, _member: {
                "id": "g-former",
                "primaryEmail": email,
                "externalIds": [_tag("someone-else")],
            },
        )
        assert row.status == DirectoryAccountStatus.LINKED_EXISTING.value
        assert fake.resets == []

    async def test_an_account_a_former_member_still_holds_is_not_linked_again(
        self, db_session
    ):
        # Anonymizing a departed member frees their address for a new one,
        # but the former member's record still governs the account. A second
        # record would let either member's departure or return move it.
        row, fake, _ = await self._provision_into_existing(
            db_session,
            former_account="g-reused",
            existing=lambda email, _member: {
                "id": "g-reused",
                "primaryEmail": email,
                "suspended": True,
            },
        )
        assert row.status == DirectoryAccountStatus.FAILED.value
        assert row.external_user_id is None
        assert "still recorded for another member" in (row.last_error or "")
        assert fake.resets == []

    async def test_a_google_failure_never_undoes_the_conversion(self, db_session):
        org = await _org(db_session)
        await _connect(db_session, org)
        svc, prospect = await _prospect(db_session, org)
        fake = FakeDirectory(create_error=GoogleWorkspaceError("No licenses left."))

        result = await svc._do_transfer(prospect, None)
        await db_session.commit()
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await result["_provision_directory_account"]()

        row = await _row(db_session, result["user_id"])
        assert row.status == DirectoryAccountStatus.FAILED.value
        assert row.last_error == "No licenses left."
        await db_session.refresh(prospect)
        assert str(prospect.transferred_user_id) == str(result["user_id"])

    async def test_an_address_off_the_domain_fails_without_calling_google(
        self, db_session
    ):
        org = await _org(db_session)
        await _connect(db_session, org, domain="other.org")
        svc, prospect = await _prospect(db_session, org)

        with patch.object(
            svc, "_send_transfer_welcome_email", AsyncMock(return_value=True)
        ) as welcome:
            result = await svc._do_transfer(prospect, None, send_welcome_email=True)

        row = await _row(db_session, result["user_id"])
        assert row.status == DirectoryAccountStatus.FAILED.value
        # No mailbox is being created, so nothing is deferred or rerouted: the
        # welcome email goes now, to the department address, without a card.
        assert "_provision_directory_account" not in result
        assert "_send_welcome_email" not in result
        assert result["welcome_email_sent"] is True
        assert welcome.call_args.kwargs["recipient_email"] == result["email"]
        assert welcome.call_args.kwargs["directory_account"] is None

    async def test_a_failed_group_is_kept_for_retry(self, db_session):
        org = await _org(db_session)
        await _connect(db_session, org)
        svc, prospect = await _prospect(db_session, org)
        fake = FakeDirectory(group_error=GoogleWorkspaceError("nope"))

        result = await svc._do_transfer(prospect, None)
        await db_session.commit()
        with (
            patch(f"{SERVICE}.directory_for", return_value=fake),
            patch(
                "app.services.email_service.EmailService.send_email",
                AsyncMock(return_value=(1, 0)),
            ),
        ):
            await result["_provision_directory_account"]()

        row = await _row(db_session, result["user_id"])
        assert row.status == DirectoryAccountStatus.CREATED.value
        assert row.pending_groups == [GROUP]
        assert GROUP in (row.last_error or "")


@pytest.mark.integration
class TestRetry:
    async def _staged(self, db_session, **row_fields):
        org = await _org(db_session)
        await _connect(db_session, org)
        svc, prospect = await _prospect(db_session, org)
        result = await svc._do_transfer(prospect, None)
        row = await _row(db_session, result["user_id"])
        for key, value in row_fields.items():
            setattr(row, key, value)
        await db_session.commit()
        return org, result["user_id"]

    async def test_a_failed_account_is_created_and_its_password_sent(self, db_session):
        org, user_id = await self._staged(
            db_session, status=DirectoryAccountStatus.FAILED.value
        )
        fake = FakeDirectory()
        with (
            patch(f"{SERVICE}.directory_for", return_value=fake),
            patch(
                "app.services.email_service.EmailService.send_email",
                AsyncMock(return_value=(1, 0)),
            ),
        ):
            row = await DirectoryAccountService(db_session).retry(user_id, org.id)
        assert row.status == DirectoryAccountStatus.CREATED.value
        assert row.credentials_sent is True
        assert row.attempts == 1

    async def test_an_undelivered_password_is_reset_and_resent(self, db_session):
        org, user_id = await self._staged(
            db_session,
            status=DirectoryAccountStatus.CREATED.value,
            credentials_sent=False,
            pending_groups=None,
        )
        fake = FakeDirectory()
        with (
            patch(f"{SERVICE}.directory_for", return_value=fake),
            patch(
                "app.services.email_service.EmailService.send_email",
                AsyncMock(return_value=(1, 0)),
            ) as send,
        ):
            row = await DirectoryAccountService(db_session).retry(user_id, org.id)
        assert len(fake.resets) == 1
        assert fake.resets[0] in send.call_args.kwargs["text_body"]
        assert row.credentials_sent is True

    async def test_a_linked_account_is_never_touched(self, db_session):
        org, user_id = await self._staged(
            db_session, status=DirectoryAccountStatus.LINKED_EXISTING.value
        )
        with pytest.raises(ProvisionRetryError):
            await DirectoryAccountService(db_session).retry(user_id, org.id)

    async def test_a_second_retry_inside_a_minute_is_refused(self, db_session):
        org, user_id = await self._staged(
            db_session,
            status=DirectoryAccountStatus.FAILED.value,
            last_attempt_at=datetime.now(timezone.utc) - timedelta(seconds=5),
        )
        with pytest.raises(ProvisionRetryTooSoon):
            await DirectoryAccountService(db_session).retry(user_id, org.id)

    async def test_another_orgs_member_is_not_found(self, db_session):
        _, user_id = await self._staged(
            db_session, status=DirectoryAccountStatus.FAILED.value
        )
        other = await _org(db_session)
        with pytest.raises(LookupError):
            await DirectoryAccountService(db_session).retry(user_id, other.id)

    async def test_the_endpoint_maps_refusals_to_status_codes(self, db_session):
        from app.api.v1.endpoints.google_workspace import (
            get_member_google_account,
            retry_member_google_account,
        )

        org, user_id = await self._staged(
            db_session, status=DirectoryAccountStatus.LINKED_EXISTING.value
        )
        caller = SimpleNamespace(id=None, organization_id=org.id)
        envelope = await get_member_google_account(
            uuid.UUID(user_id), db=db_session, current_user=caller
        )
        assert envelope.account is not None
        assert envelope.account.status == "linked_existing"

        with patch(
            "app.api.v1.endpoints.google_workspace.check_rate_limit", AsyncMock()
        ):
            with pytest.raises(HTTPException) as refused:
                await retry_member_google_account(
                    uuid.UUID(user_id),
                    request=MagicMock(),
                    db=db_session,
                    current_user=caller,
                )
        assert refused.value.status_code == 409

        stranger = SimpleNamespace(id=None, organization_id=(await _org(db_session)).id)
        envelope = await get_member_google_account(
            uuid.UUID(user_id), db=db_session, current_user=stranger
        )
        assert envelope.account is None


@pytest.mark.integration
class TestConnectGate:
    async def test_integrations_manage_alone_cannot_connect_it(self, db_session):
        from app.api.v1.endpoints.integrations import _require_google_workspace_admin

        integration = Integration(integration_type=GOOGLE_WORKSPACE_INTEGRATION)
        with patch(
            "app.api.v1.endpoints.integrations.user_has_permission",
            return_value=False,
        ) as check:
            with pytest.raises(HTTPException) as refused:
                _require_google_workspace_admin(integration, MagicMock())
        assert refused.value.status_code == 403
        assert check.call_args.args[1] == "admin.access"

    async def test_other_integrations_are_not_gated(self):
        from app.api.v1.endpoints.integrations import _require_google_workspace_admin

        with patch(
            "app.api.v1.endpoints.integrations.user_has_permission",
            return_value=False,
        ):
            _require_google_workspace_admin(
                Integration(integration_type="slack"), MagicMock()
            )

    async def test_department_email_must_be_on_for_the_same_domain(self, db_session):
        from app.api.v1.endpoints.integrations import _check_google_workspace_ready

        org = await _org(db_session, department_email=False)
        integration = Integration(
            organization_id=org.id, integration_type=GOOGLE_WORKSPACE_INTEGRATION
        )
        with pytest.raises(HTTPException) as refused:
            await _check_google_workspace_ready(
                db_session,
                integration,
                {"domain": DOMAIN, "service_account_key": _key()},
            )
        assert refused.value.status_code == 422

        ready = await _org(db_session)
        integration.organization_id = ready.id
        await _check_google_workspace_ready(
            db_session, integration, {"domain": DOMAIN, "service_account_key": _key()}
        )

    async def test_a_first_connection_needs_a_key(self, db_session):
        from app.api.v1.endpoints.integrations import _check_google_workspace_ready

        org = await _org(db_session)
        integration = Integration(
            organization_id=org.id, integration_type=GOOGLE_WORKSPACE_INTEGRATION
        )
        with pytest.raises(HTTPException) as refused:
            await _check_google_workspace_ready(
                db_session, integration, {"domain": DOMAIN}
            )
        assert refused.value.status_code == 422


@pytest.mark.unit
class TestTransferEndpointAfterCommit:
    """The manual Convert endpoint commits before Google or email is touched."""

    async def _run(self, transfer_result: dict, row: Any = None):
        from app.api.v1.endpoints import membership_pipeline as pipeline_ep
        from app.models.membership_pipeline import ProspectStatus
        from app.schemas.membership_pipeline import TransferProspectRequest

        pipeline = "app.services.membership_pipeline_service.MembershipPipelineService"
        events: list[str] = []
        db = MagicMock()
        db.commit = AsyncMock(side_effect=lambda: events.append("commit"))
        db.rollback = AsyncMock(side_effect=lambda: events.append("rollback"))
        prospect = SimpleNamespace(status=ProspectStatus.ACTIVE, target_role_id=None)
        with (
            patch(f"{pipeline}.get_prospect", AsyncMock(return_value=prospect)),
            patch(
                f"{pipeline}.transfer_to_membership",
                AsyncMock(return_value=transfer_result),
            ),
            patch.object(
                pipeline_ep, "welcome_email_can_send", AsyncMock(return_value=True)
            ),
            patch.object(
                pipeline_ep, "_canonical_rank_or_400", AsyncMock(return_value=None)
            ),
            patch.object(pipeline_ep, "_enforce_rank_grant_ceiling", AsyncMock()),
            patch.object(pipeline_ep, "log_audit_event", AsyncMock()),
            patch.object(
                DirectoryAccountService,
                "get_for_user",
                AsyncMock(return_value=row),
            ),
        ):
            result = await pipeline_ep.transfer_prospect(
                prospect_id=uuid.uuid4(),
                data=TransferProspectRequest(send_welcome_email=True),
                request=MagicMock(),
                db=db,
                current_user=SimpleNamespace(
                    id="admin-1", organization_id="org-a", username="admin"
                ),
            )
        return result, events

    async def test_delivery_runs_after_the_commit_and_reports_the_account(self):
        events: list[str] = []

        async def send() -> bool:
            events.append("send")
            return True

        row = SimpleNamespace(
            status="created",
            primary_email="jordan.hale@firedept.org",
            credentials_sent=True,
            last_error=None,
        )
        transfer = {
            "success": True,
            "user_id": "u-new",
            "message": "ok",
            "welcome_email_sent": False,
            "google_account": {"status": "pending", "email": row.primary_email},
            "_send_welcome_email": send,
        }
        result, db_events = await self._run(transfer, row)

        assert db_events == ["commit"]
        assert events == ["send"]
        assert result["welcome_email_sent"] is True
        assert result["google_account"]["status"] == "created"
        assert "_send_welcome_email" not in result

    async def test_a_delivery_failure_never_fails_a_committed_conversion(self):
        transfer = {
            "success": True,
            "user_id": "u-new",
            "message": "ok",
            "google_account": {"status": "pending", "email": "a@firedept.org"},
            "_provision_directory_account": AsyncMock(side_effect=RuntimeError("boom")),
        }
        result, db_events = await self._run(transfer)

        assert db_events == ["commit", "rollback"]
        assert result["success"] is True
        assert "_provision_directory_account" not in result


async def _member_with_account(db_session, status=DirectoryAccountStatus.CREATED.value):
    """A converted member whose Google account exists (or was linked)."""
    org = await _org(db_session)
    await _connect(db_session, org)
    svc, prospect = await _prospect(db_session, org)
    result = await svc._do_transfer(prospect, None)
    row = await _row(db_session, result["user_id"])
    row.status = status
    row.credentials_sent = True
    row.pending_groups = None
    await db_session.commit()
    officer = User(
        organization_id=org.id,
        username=f"officer-{_hex()}",
        email=f"officer-{_hex()}@example.org",
        first_name="Pat",
        last_name="Officer",
    )
    db_session.add(officer)
    await db_session.commit()
    caller = SimpleNamespace(
        id=officer.id, organization_id=org.id, username=officer.username
    )
    return org, str(result["user_id"]), caller


async def _backdate_service(db_session, user_id):
    """A rejoin must come after the last day of service, which a same-day drop
    makes today; back-date the closed stints, as the service-history tests do."""
    from app.models.user import MemberServicePeriod

    stints = (
        (
            await db_session.execute(
                select(MemberServicePeriod).where(
                    MemberServicePeriod.user_id == user_id,
                    MemberServicePeriod.end_date.is_not(None),
                )
            )
        )
        .scalars()
        .all()
    )
    for stint in stints:
        stint.end_date = date.today() - timedelta(days=30)
    await db_session.flush()


async def _settle(db_session):
    """Run what the departure hook staged. The test session's commits only
    release savepoints, so the after-commit task deliberately does not run."""
    from app.models.directory_account_departure import run_staged_now

    await run_staged_now(db_session)


async def _change_status(db_session, user_id, caller, new_status):
    from fastapi import BackgroundTasks

    from app.api.v1.endpoints.member_status import (
        MemberStatusChangeRequest,
        change_member_status,
    )

    await _backdate_service(db_session, user_id)
    response = await change_member_status(
        uuid.UUID(user_id),
        MemberStatusChangeRequest(new_status=new_status, reason="test"),
        BackgroundTasks(),
        db=db_session,
        current_user=caller,
    )
    await _settle(db_session)
    return response


@pytest.mark.integration
class TestSuspension:
    async def test_a_drop_suspends_and_undoing_it_lifts_the_suspension(
        self, db_session
    ):
        from app.api.v1.endpoints.member_status import (
            UndoDropRequest,
            undo_member_drop,
        )

        org, user_id, caller = await _member_with_account(db_session)
        fake = FakeDirectory()
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _change_status(db_session, user_id, caller, "dropped_voluntary")
            row = await _row(db_session, user_id)
            assert fake.suspend_calls == [True]
            assert row.suspended_by_logbook is True
            assert row.suspension_settled is True
            assert row.suspended_at is not None

            await undo_member_drop(
                uuid.UUID(user_id),
                UndoDropRequest(),
                db=db_session,
                current_user=caller,
            )
            await _settle(db_session)
        row = await _row(db_session, user_id)
        assert fake.suspend_calls == [True, False]
        assert row.suspended_by_logbook is False
        assert row.suspension_wanted is False
        assert row.suspended_at is None

    async def test_a_rejoin_by_status_change_lifts_it(self, db_session):
        org, user_id, caller = await _member_with_account(db_session)
        fake = FakeDirectory()
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _change_status(db_session, user_id, caller, "dropped_involuntary")
            await _change_status(db_session, user_id, caller, "active")
        assert fake.suspend_calls == [True, False]

    async def test_a_status_change_that_is_not_a_drop_leaves_google_alone(
        self, db_session
    ):
        org, user_id, caller = await _member_with_account(db_session)
        fake = FakeDirectory()
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _change_status(db_session, user_id, caller, "retired")
            await _change_status(db_session, user_id, caller, "active")
            await _change_status(db_session, user_id, caller, "leave")
        assert fake.suspend_calls == []

    async def test_reactivating_an_archived_member_lifts_it(self, db_session):
        from app.services.member_archive_service import reactivate_member

        org, user_id, caller = await _member_with_account(db_session)
        fake = FakeDirectory()
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _change_status(db_session, user_id, caller, "dropped_voluntary")
            member = await db_session.get(User, user_id)
            member.status = UserStatus.ARCHIVED
            await db_session.commit()
            await _backdate_service(db_session, user_id)
            await reactivate_member(
                db=db_session,
                user_id=user_id,
                organization_id=org.id,
                reactivated_by=caller.id,
            )
            await _settle(db_session)
        assert fake.suspend_calls == [True, False]

    async def test_a_soft_delete_suspends(self, db_session):
        from app.api.v1.endpoints.users import delete_user

        org, user_id, caller = await _member_with_account(db_session)
        fake = FakeDirectory()
        with (
            patch(f"{SERVICE}.directory_for", return_value=fake),
            patch("app.api.v1.endpoints.users.log_audit_event", AsyncMock()),
        ):
            await delete_user(
                uuid.UUID(user_id), hard=False, db=db_session, current_user=caller
            )
            await _settle(db_session)
        assert fake.suspend_calls == [True]
        assert (await _row(db_session, user_id)).suspended_by_logbook is True

    async def test_a_hard_delete_suspends_from_the_captured_address(self, db_session):
        from app.api.v1.endpoints.users import delete_user

        org, user_id, caller = await _member_with_account(db_session)
        address = (await _row(db_session, user_id)).primary_email
        fake = FakeDirectory()
        with (
            patch(f"{SERVICE}.directory_for", return_value=fake),
            patch("app.api.v1.endpoints.users.log_audit_event", AsyncMock()),
            patch(
                "app.api.v1.endpoints.users.find_hard_delete_blockers",
                AsyncMock(return_value=[]),
            ),
        ):
            await delete_user(
                uuid.UUID(user_id), hard=True, db=db_session, current_user=caller
            )
            await _settle(db_session)
        assert fake.suspend_calls == [True]
        gone = (
            await db_session.execute(
                select(DirectoryAccountProvision).where(
                    DirectoryAccountProvision.primary_email == address
                )
            )
        ).scalar_one_or_none()
        assert gone is None

    async def test_a_linked_account_is_suspended_too(self, db_session):
        org, user_id, caller = await _member_with_account(
            db_session, status=DirectoryAccountStatus.LINKED_EXISTING.value
        )
        fake = FakeDirectory()
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _change_status(db_session, user_id, caller, "dropped_voluntary")
        assert fake.suspend_calls == [True]

    async def test_a_suspension_that_was_not_ours_is_never_lifted(self, db_session):
        org, user_id, caller = await _member_with_account(
            db_session, status=DirectoryAccountStatus.LINKED_EXISTING.value
        )
        fake = FakeDirectory()
        fake.suspended = True
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _change_status(db_session, user_id, caller, "dropped_voluntary")
            row = await _row(db_session, user_id)
            assert row.suspension_settled is True
            assert row.suspended_by_logbook is False
            await _change_status(db_session, user_id, caller, "active")
        assert fake.suspend_calls == []
        assert fake.suspended is True

    async def test_a_google_failure_never_undoes_the_drop_and_can_be_retried(
        self, db_session
    ):
        org, user_id, caller = await _member_with_account(db_session)
        fake = FakeDirectory()
        fake.suspend_error = GoogleWorkspaceError("Google is busy.")
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _change_status(db_session, user_id, caller, "dropped_voluntary")
        member = await db_session.get(User, user_id)
        await db_session.refresh(member)
        assert member.status == UserStatus.DROPPED_VOLUNTARY
        row = await _row(db_session, user_id)
        assert row.suspension_settled is False
        assert row.suspension_error == "Google is busy."

        row.last_attempt_at = None
        await db_session.commit()
        fake.suspend_error = None
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            row = await DirectoryAccountService(db_session).retry(user_id, org.id)
        assert row.suspension_settled is True
        assert row.suspended_by_logbook is True

    async def test_an_account_deleted_in_google_settles_with_a_note(self, db_session):
        from app.services.integration_services.google_workspace_service import (
            GoogleAccountNotFoundError,
        )

        org, user_id, caller = await _member_with_account(db_session)
        fake = FakeDirectory()
        fake.suspend_error = GoogleAccountNotFoundError("gone")
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _change_status(db_session, user_id, caller, "dropped_voluntary")
        row = await _row(db_session, user_id)
        assert row.suspension_settled is True
        assert row.suspension_error == "gone"

    async def test_no_account_is_created_for_a_member_who_has_left(self, db_session):
        org, user_id, caller = await _member_with_account(
            db_session, status=DirectoryAccountStatus.FAILED.value
        )
        with patch(f"{SERVICE}.directory_for", return_value=FakeDirectory()):
            await _change_status(db_session, user_id, caller, "dropped_voluntary")
        with pytest.raises(ProvisionRetryError):
            await DirectoryAccountService(db_session).retry(user_id, org.id)

    async def test_a_member_without_an_account_record_is_untouched(self, db_session):
        org = await _org(db_session)
        await _connect(db_session, org)
        svc, prospect = await _prospect(db_session, org)
        result = await svc._do_transfer(prospect, None)
        await db_session.execute(
            DirectoryAccountProvision.__table__.delete().where(
                DirectoryAccountProvision.user_id == str(result["user_id"])
            )
        )
        await db_session.commit()
        member = await db_session.get(User, str(result["user_id"]))
        member.status = UserStatus.DROPPED_VOLUNTARY
        await db_session.commit()
        fake = FakeDirectory()
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _settle(db_session)
        assert fake.keys == []


@pytest.mark.integration
class TestReviewFixes:
    async def test_no_password_is_reset_for_a_member_who_has_left(self, db_session):
        # A created account whose password never arrived offers "Finish setup";
        # after a drop it must not mail a fresh password to the departed member.
        org, user_id, caller = await _member_with_account(db_session)
        row = await _row(db_session, user_id)
        row.credentials_sent = False
        await db_session.commit()
        fake = FakeDirectory()
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _change_status(db_session, user_id, caller, "dropped_voluntary")
            row = await _row(db_session, user_id)
            row.last_attempt_at = None
            await db_session.commit()
            with pytest.raises(ProvisionRetryError):
                await DirectoryAccountService(db_session).retry(user_id, org.id)
        assert fake.resets == []

    async def test_an_unreadable_key_is_recorded_not_raised(self, db_session):
        org, user_id, caller = await _member_with_account(db_session)
        row = await _row(db_session, user_id)
        row.pending_groups = [GROUP]
        await db_session.commit()
        with patch(
            f"{SERVICE}.directory_for",
            side_effect=GoogleWorkspaceError("The stored key is unreadable."),
        ):
            row = await DirectoryAccountService(db_session).retry(user_id, org.id)
        assert row.last_error == "The stored key is unreadable."
        assert row.pending_groups == [GROUP]

    async def test_a_crash_in_the_suspension_sync_never_fails_the_drop(
        self, db_session
    ):
        org, user_id, caller = await _member_with_account(db_session)
        with patch.object(
            DirectoryAccountService,
            "_reconcile_suspension",
            AsyncMock(side_effect=RuntimeError("boom")),
        ):
            response = await _change_status(
                db_session, user_id, caller, "dropped_voluntary"
            )
        assert response.new_status == "dropped_voluntary"
        member = await db_session.get(User, user_id)
        await db_session.refresh(member)
        assert member.status == UserStatus.DROPPED_VOLUNTARY

    async def test_suspension_addresses_the_account_by_its_google_id(self, db_session):
        org, user_id, caller = await _member_with_account(db_session)
        row = await _row(db_session, user_id)
        row.external_user_id = "g-123"
        await db_session.commit()
        fake = FakeDirectory()
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _change_status(db_session, user_id, caller, "dropped_voluntary")
        assert fake.keys
        assert set(fake.keys) == {"g-123"}


@pytest.mark.unit
class TestDirectoryClientHygiene:
    def test_failures_are_logged_without_the_request_or_body(self):
        from loguru import logger

        from app.services.integration_services.google_workspace_service import (
            _translate,
        )

        lines: list[str] = []
        handler = logger.add(lines.append, level="WARNING")
        try:
            error = _http_error(403)
            error.uri = "https://admin.googleapis.com/users/jordan@firedept.org"
            _translate(error, "account suspension")
        finally:
            logger.remove(handler)
        assert lines
        assert "HTTP 403" in lines[0]
        assert "firedept.org" not in lines[0]
        assert "raw" not in lines[0]

    def test_one_set_of_credentials_serves_every_call(self):
        directory = GoogleWorkspaceDirectory({"type": "service_account"}, "a@b.org")
        with (
            patch(
                "google.oauth2.service_account.Credentials.from_service_account_info"
            ) as make_credentials,
            patch("googleapiclient.discovery.build"),
            patch("google_auth_httplib2.AuthorizedHttp"),
        ):
            directory._service()
            directory._service()
        make_credentials.assert_called_once()


@pytest.mark.integration
class TestCentralDepartureHook:
    """Any path that changes a member's status or deleted_at is covered, with
    no call at that path: the session hook stages the suspension."""

    async def test_a_path_that_knows_nothing_of_google_still_suspends(self, db_session):
        org, user_id, _ = await _member_with_account(db_session)
        member = await db_session.get(User, user_id)
        member.status = UserStatus.DROPPED_INVOLUNTARY
        await db_session.commit()

        row = await _row(db_session, user_id)
        assert row.suspension_wanted is True
        assert row.suspension_settled is False
        fake = FakeDirectory()
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _settle(db_session)
        assert fake.suspend_calls == [True]

    async def test_a_departure_that_rolls_back_leaves_nothing(self, db_session):
        from app.models.directory_account_departure import _RECONCILE

        org, user_id, _ = await _member_with_account(db_session)
        member = await db_session.get(User, user_id)
        member.status = UserStatus.DROPPED_VOLUNTARY
        await db_session.flush()
        await db_session.rollback()

        assert not db_session.sync_session.info.get(_RECONCILE)
        row = await _row(db_session, user_id)
        assert row.suspension_settled is True
        assert row.suspension_wanted is False

    async def test_archiving_a_dropped_member_is_not_a_second_departure(
        self, db_session
    ):
        org, user_id, _ = await _member_with_account(db_session)
        member = await db_session.get(User, user_id)
        member.status = UserStatus.DROPPED_VOLUNTARY
        await db_session.commit()
        fake = FakeDirectory()
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _settle(db_session)
            member.status = UserStatus.ARCHIVED
            await db_session.commit()
            await _settle(db_session)
        assert fake.suspend_calls == [True]

    async def test_another_departments_record_is_never_staged(self, db_session):
        org, user_id, _ = await _member_with_account(db_session)
        other = await _org(db_session)
        row = await _row(db_session, user_id)
        row.organization_id = other.id
        await db_session.commit()
        member = await db_session.get(User, user_id)
        member.status = UserStatus.DROPPED_VOLUNTARY
        await db_session.commit()
        await db_session.refresh(row)
        assert row.suspension_settled is True


@pytest.mark.integration
class TestSuspensionSweep:
    async def _unsettled(self, db_session, **fields):
        org, user_id, _ = await _member_with_account(db_session)
        row = await _row(db_session, user_id)
        row.suspension_wanted = True
        row.suspension_settled = False
        for key, value in fields.items():
            setattr(row, key, value)
        await db_session.commit()
        return user_id

    async def test_a_staged_row_is_finished_and_a_recent_failure_waits(
        self, db_session
    ):
        fresh = await self._unsettled(db_session)
        waiting = await self._unsettled(
            db_session,
            suspension_error="Google is busy.",
            last_attempt_at=datetime.now(timezone.utc) - timedelta(minutes=2),
        )
        due = await self._unsettled(
            db_session,
            suspension_error="Google is busy.",
            last_attempt_at=datetime.now(timezone.utc) - timedelta(hours=1),
        )
        with patch(f"{SERVICE}.directory_for", return_value=FakeDirectory()):
            await DirectoryAccountService(db_session).sync_pending_suspensions()

        assert (await _row(db_session, fresh)).suspension_settled is True
        assert (await _row(db_session, due)).suspension_settled is True
        assert (await _row(db_session, waiting)).suspension_settled is False

    async def test_the_scheduled_task_is_registered_and_runs(self, db_session):
        from app.services.scheduled_tasks import (
            TASK_INTERVALS_SECONDS,
            TASK_RUNNERS,
            run_google_workspace_suspension_sync,
        )

        assert TASK_RUNNERS["google_workspace_suspension_sync"] is (
            run_google_workspace_suspension_sync
        )
        assert TASK_INTERVALS_SECONDS["google_workspace_suspension_sync"] > 0
        user_id = await self._unsettled(db_session)
        with patch(f"{SERVICE}.directory_for", return_value=FakeDirectory()):
            result = await run_google_workspace_suspension_sync(db_session)
        assert result["attempted"] >= 1
        assert (await _row(db_session, user_id)).suspension_settled is True


@pytest.mark.unit
class TestAfterCommit:
    async def test_a_real_commit_starts_the_sync_in_the_background(self):
        from app.models import directory_account_departure as hook

        session = SimpleNamespace(
            bind=object(),
            info={hook._RECONCILE: {("org-1", "u-1")}, hook._DETACHED: []},
        )
        with patch.object(hook, "_run_after_commit", AsyncMock()) as run:
            hook._sync_after_commit(session)
            assert hook._tasks
            await asyncio.gather(*list(hook._tasks))
        run.assert_awaited_once_with([("org-1", "u-1")], [])
        assert hook._RECONCILE not in session.info

    def test_nothing_staged_starts_nothing(self):
        from app.models import directory_account_departure as hook

        session = SimpleNamespace(bind=object(), info={})
        with patch.object(hook, "_run_after_commit", AsyncMock()) as run:
            hook._sync_after_commit(session)
        run.assert_not_called()


@pytest.mark.unit
class TestCreationTag:
    async def test_the_account_is_created_carrying_the_member_id(self):
        from app.services.integration_services.google_workspace_service import (
            LOGBOOK_EXTERNAL_ID_TYPE,
            logbook_member_id,
        )

        directory = GoogleWorkspaceDirectory({}, "admin@firedept.org")
        service = MagicMock()
        service.users.return_value.insert.return_value.execute.return_value = {
            "id": "g-1"
        }
        with patch.object(directory, "_service", return_value=service):
            await directory.create_user(
                "a@firedept.org", "A", "B", "pw", member_id="member-9"
            )
        body = service.users.return_value.insert.call_args.kwargs["body"]
        assert body["externalIds"] == [
            {
                "type": "custom",
                "customType": LOGBOOK_EXTERNAL_ID_TYPE,
                "value": "member-9",
            }
        ]
        assert logbook_member_id({"externalIds": body["externalIds"]}) == "member-9"
        assert (
            logbook_member_id({"externalIds": [{"type": "work", "value": "x"}]}) is None
        )

    async def test_the_account_goes_into_the_configured_org_unit(self):
        # The org unit is the Google client's own setting, read from the
        # integration when the client is built; the engine never sees it.
        integration = Integration(
            config={"admin_email": "a@firedept.org", "org_unit_path": "/Members"}
        )
        integration.set_secret("service_account_key", _key())
        directory = directory_for(integration)
        service = MagicMock()
        service.users.return_value.insert.return_value.execute.return_value = {
            "id": "g-1"
        }
        with patch.object(directory, "_service", return_value=service):
            await directory.create_user(
                "a@firedept.org", "A", "B", "pw", member_id="member-9"
            )
        body = service.users.return_value.insert.call_args.kwargs["body"]
        assert body["orgUnitPath"] == "/Members"

    def test_a_user_resource_is_read_as_the_engine_reads_accounts(self):
        account = to_directory_account(
            {
                "id": "g-1",
                "primaryEmail": "Pat@FireDept.org",
                "suspended": True,
                "externalIds": [_tag("member-9")],
            }
        )
        assert account.id == "g-1"
        assert account.primary_email == "pat@firedept.org"
        assert account.suspended is True
        assert account.member_id == "member-9"
        assert to_directory_account({}).id == ""

    async def test_the_domain_listing_follows_every_page(self):
        directory = GoogleWorkspaceDirectory({}, "admin@firedept.org")
        service = MagicMock()
        service.users.return_value.list.return_value.execute.side_effect = [
            {"users": [{"id": "1", "primaryEmail": "a@x.org"}], "nextPageToken": "p2"},
            {"users": [{"id": "2", "primaryEmail": "b@x.org"}]},
        ]
        with patch.object(directory, "_service", return_value=service):
            users = await directory.list_users("x.org")
        assert [u.id for u in users] == ["1", "2"]
        assert [u.primary_email for u in users] == ["a@x.org", "b@x.org"]
        tokens = [
            c.kwargs["pageToken"]
            for c in service.users.return_value.list.call_args_list
        ]
        assert tokens == [None, "p2"]


async def _member(db_session, org, email, **fields):
    member = User(
        organization_id=org.id,
        username=f"m-{_hex()}",
        email=email,
        first_name="Pat",
        last_name="Member",
        **fields,
    )
    db_session.add(member)
    await db_session.flush()
    return member


@pytest.mark.integration
class TestLinkExistingMembers:
    async def _roster(self, db_session):
        org = await _org(db_session)
        await _connect(db_session, org)
        tag = _hex()
        members = {
            "match": await _member(db_session, org, f"match-{tag}@{DOMAIN}"),
            "missing": await _member(db_session, org, f"missing-{tag}@{DOMAIN}"),
            "alias": await _member(db_session, org, f"alias-{tag}@{DOMAIN}"),
            "personal": await _member(db_session, org, f"pat-{tag}@gmail.com"),
            "dropped": await _member(
                db_session,
                org,
                f"dropped-{tag}@{DOMAIN}",
                status=UserStatus.DROPPED_VOLUNTARY,
            ),
        }
        await db_session.commit()
        fake = FakeDirectory()
        fake.domain_users = [
            {"id": "g-match", "primaryEmail": f"Match-{tag}@{DOMAIN}"},
            {"id": "g-dropped", "primaryEmail": f"dropped-{tag}@{DOMAIN}"},
            # The alias address belongs to this account; users.list never
            # lists an alias as a user, so it must not match.
            {"id": "g-chief", "primaryEmail": f"chief-{tag}@{DOMAIN}"},
        ]
        return org, members, fake

    async def test_a_preview_counts_without_writing(self, db_session):
        org, members, fake = await self._roster(db_session)
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            counts = await DirectoryAccountService(db_session).link_existing_members(
                org.id, GOOGLE_WORKSPACE_PROVIDER, apply=False, actor_id=None
            )
        assert counts == {
            "linked": 1,
            "already_linked": 0,
            "unfinished": 0,
            "departed": 1,
            "not_in_google": 2,
            "off_domain": 1,
            "account_in_use": 0,
        }
        rows = (
            await db_session.execute(
                select(DirectoryAccountProvision).where(
                    DirectoryAccountProvision.organization_id == org.id
                )
            )
        ).all()
        assert rows == []

    async def test_applying_links_only_exact_primary_addresses(self, db_session):
        org, members, fake = await self._roster(db_session)
        service = DirectoryAccountService(db_session)
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await service.link_existing_members(
                org.id, GOOGLE_WORKSPACE_PROVIDER, apply=True, actor_id=None
            )
            again = await service.link_existing_members(
                org.id, GOOGLE_WORKSPACE_PROVIDER, apply=True, actor_id=None
            )

        row = await _row(db_session, str(members["match"].id))
        assert row.status == DirectoryAccountStatus.LINKED_EXISTING.value
        assert row.external_user_id == "g-match"
        assert again["linked"] == 0
        assert again["already_linked"] == 1
        for key in ("missing", "alias", "personal", "dropped"):
            assert (await service.get_for_user(str(members[key].id), org.id)) is None

    async def test_a_record_with_no_account_is_unfinished_not_linked(self, db_session):
        # A failed conversion is no account to suspend; reporting it as
        # linked would tell an administrator a departure is covered.
        org, members, fake = await self._roster(db_session)
        db_session.add(
            DirectoryAccountProvision(
                organization_id=org.id,
                user_id=members["match"].id,
                primary_email=members["match"].email,
                status=DirectoryAccountStatus.FAILED.value,
            )
        )
        await db_session.commit()
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            counts = await DirectoryAccountService(db_session).link_existing_members(
                org.id, GOOGLE_WORKSPACE_PROVIDER, apply=False, actor_id=None
            )
        assert counts["unfinished"] == 1
        assert counts["already_linked"] == 0
        assert counts["linked"] == 0

    async def test_an_account_recorded_for_a_former_member_is_left_alone(
        self, db_session
    ):
        org, members, fake = await self._roster(db_session)
        former = await _member(
            db_session,
            org,
            f"anon-{_hex()}@anonymized.invalid",
            status=UserStatus.DROPPED_VOLUNTARY,
        )
        db_session.add(
            DirectoryAccountProvision(
                organization_id=org.id,
                user_id=former.id,
                primary_email=members["match"].email,
                status=DirectoryAccountStatus.CREATED.value,
                external_user_id="g-match",
                suspended_by_logbook=True,
            )
        )
        await db_session.commit()
        service = DirectoryAccountService(db_session)
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            counts = await service.link_existing_members(
                org.id, GOOGLE_WORKSPACE_PROVIDER, apply=True, actor_id=None
            )
        assert counts["account_in_use"] == 1
        assert counts["linked"] == 0
        assert (await service.get_for_user(str(members["match"].id), org.id)) is None

    async def test_a_roster_that_changed_since_the_preview_is_not_linked(
        self, db_session
    ):
        org, members, fake = await self._roster(db_session)
        service = DirectoryAccountService(db_session)
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            with pytest.raises(ProvisionRetryError, match="roster changed"):
                await service.link_existing_members(
                    org.id,
                    GOOGLE_WORKSPACE_PROVIDER,
                    apply=True,
                    actor_id=None,
                    expected=3,
                )
            assert (
                await service.get_for_user(str(members["match"].id), org.id)
            ) is None
            counts = await service.link_existing_members(
                org.id, GOOGLE_WORKSPACE_PROVIDER, apply=True, actor_id=None, expected=1
            )
        assert counts["linked"] == 1
        assert (
            await service.get_for_user(str(members["match"].id), org.id)
        ) is not None

    async def test_applying_reads_the_roster_with_a_lock(self, db_session):
        # A plain read answers from the transaction's snapshot, so a member
        # dropped meanwhile would be linked as current and never suspended.
        from sqlalchemy import event

        org, members, fake = await self._roster(db_session)
        statements: list[str] = []
        engine = db_session.bind.engine if hasattr(db_session.bind, "engine") else None
        target = engine.sync_engine if hasattr(engine, "sync_engine") else engine

        def record(conn, cursor, statement, params, context, executemany):
            statements.append(statement)

        event.listen(target, "before_cursor_execute", record)
        try:
            with patch(f"{SERVICE}.directory_for", return_value=fake):
                await DirectoryAccountService(db_session).link_existing_members(
                    org.id, GOOGLE_WORKSPACE_PROVIDER, apply=True, actor_id=None
                )
        finally:
            event.remove(target, "before_cursor_execute", record)
        roster_reads = [
            s
            for s in statements
            if s.lstrip().upper().startswith("SELECT") and "FROM users" in s
        ]
        assert roster_reads
        assert all("FOR UPDATE" in s for s in roster_reads)

    async def test_a_linked_member_who_leaves_is_suspended_by_id(self, db_session):
        org, members, fake = await self._roster(db_session)
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await DirectoryAccountService(db_session).link_existing_members(
                org.id, GOOGLE_WORKSPACE_PROVIDER, apply=True, actor_id=None
            )
            member = members["match"]
            member.status = UserStatus.DROPPED_INVOLUNTARY
            await db_session.commit()
            await _settle(db_session)
        assert fake.suspend_calls == [True]
        assert fake.keys[-1] == "g-match"

    async def test_another_departments_members_are_never_linked(self, db_session):
        org, members, fake = await self._roster(db_session)
        other = await _org(db_session)
        await _connect(db_session, other)
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            counts = await DirectoryAccountService(db_session).link_existing_members(
                other.id, GOOGLE_WORKSPACE_PROVIDER, apply=True, actor_id=None
            )
        assert counts["linked"] == 0
        assert (
            await DirectoryAccountService(db_session).get_for_user(
                str(members["match"].id), org.id
            )
        ) is None

    async def test_the_endpoint_previews_then_applies_and_audits(self, db_session):
        from app.api.v1.endpoints.google_workspace import link_existing_members

        org, members, fake = await self._roster(db_session)
        admin = await _member(db_session, org, f"admin-{_hex()}@example.org")
        caller = SimpleNamespace(id=admin.id, organization_id=org.id)
        with (
            patch(f"{SERVICE}.directory_for", return_value=fake),
            patch(
                "app.api.v1.endpoints.google_workspace.check_rate_limit", AsyncMock()
            ),
            patch(
                "app.api.v1.endpoints.google_workspace.log_audit_event", AsyncMock()
            ) as audit,
        ):
            preview = await link_existing_members(
                MagicMock(),
                apply=False,
                expected=None,
                db=db_session,
                current_user=caller,
            )
            audit.assert_not_called()
            applied = await link_existing_members(
                MagicMock(),
                apply=True,
                expected=preview.linked,
                db=db_session,
                current_user=caller,
            )
        assert preview.applied is False
        assert preview.linked == 1
        assert applied.applied is True
        assert audit.call_args.args[1] == "google_workspace.existing_members_linked"
        row = await _row(db_session, str(members["match"].id))
        assert row.created_by == admin.id

    async def test_without_the_integration_it_refuses(self, db_session):
        from app.api.v1.endpoints.google_workspace import link_existing_members

        org = await _org(db_session)
        with patch(
            "app.api.v1.endpoints.google_workspace.check_rate_limit", AsyncMock()
        ):
            with pytest.raises(HTTPException) as refused:
                await link_existing_members(
                    MagicMock(),
                    apply=False,
                    expected=None,
                    db=db_session,
                    current_user=SimpleNamespace(id=None, organization_id=org.id),
                )
        assert refused.value.status_code == 409

    def test_the_endpoint_needs_an_organization_administrator(self):
        from app.api.v1.endpoints.google_workspace import router

        route = next(r for r in router.routes if r.path == "/link-existing")
        checker = route.dependant.dependencies[-1].call
        assert set(checker.required_permissions) == {
            "integrations.manage",
            "admin.access",
        }


@pytest.mark.unit
class TestDuplicateKeyClassification:
    def test_only_a_duplicate_key_reads_as_a_race(self):
        from sqlalchemy.exc import IntegrityError

        from app.services.directory_account_service import (
            _is_duplicate_key,
        )

        def error(*args):
            return IntegrityError("INSERT", {}, Exception(*args))

        assert _is_duplicate_key(error(1062, "Duplicate entry")) is True
        assert _is_duplicate_key(error(1452, "foreign key fails")) is False
        assert _is_duplicate_key(error()) is False

"""Google Workspace accounts for members converted from applicants.

Covers the config schema, the Directory connector's error translation, the
conversion hook (the account is created only after the member commits, and
its password reaches the member's personal address) and the officer retry.
Google itself is never called: ``directory_for`` is replaced by a fake.
"""

import json
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.google_workspace import (
    GOOGLE_WORKSPACE_INTEGRATION,
    GoogleAccountProvision,
    GoogleAccountStatus,
)
from app.models.integration import Integration
from app.models.user import Organization
from app.schemas.integration import GoogleWorkspaceConfig
from app.services.email_service import append_to_email_html
from app.services.google_workspace_provisioning_service import (
    GoogleWorkspaceProvisioningService,
    ProvisionRetryError,
    ProvisionRetryTooSoon,
    google_credentials_html,
)
from app.services.integration_services.google_workspace_service import (
    GoogleAccountExistsError,
    GoogleWorkspaceDirectory,
    GoogleWorkspaceError,
    _translate,
    directory_for,
)
from app.services.membership_pipeline_service import MembershipPipelineService

SERVICE = "app.services.google_workspace_provisioning_service"
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

    async def create_user(self, email, given, family, password, org_unit):
        if self.create_error:
            raise self.create_error
        self.created.append((email, given, family, password, org_unit))
        return "google-id-1"

    async def add_to_group(self, group, email):
        if self.group_error:
            raise self.group_error
        self.groups.append((group, email))

    async def reset_password(self, email, password):
        if self.reset_error:
            raise self.reset_error
        self.resets.append(password)


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
        block = google_credentials_html("a@firedept.org", "<b>&pw")
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


async def _row(db: AsyncSession, user_id: str) -> GoogleAccountProvision:
    row = (
        await db.execute(
            select(GoogleAccountProvision).where(
                GoogleAccountProvision.user_id == str(user_id)
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
        assert "_provision_google" not in result
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
        assert fake.created[0][4] == "/Members"
        assert fake.groups == [(GROUP, dept)]
        kwargs = welcome.call_args.kwargs
        # The new mailbox cannot receive the password that opens it.
        assert kwargs["recipient_email"] == prospect.email
        assert kwargs["google_account"] == (dept, fake.created[0][3])
        assert kwargs["temp_password"] != fake.created[0][3]

        row = await _row(db_session, result["user_id"])
        assert row.status == GoogleAccountStatus.CREATED.value
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
            await result["_provision_google"]()

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
                GoogleWorkspaceProvisioningService,
                "provision",
                AsyncMock(side_effect=RuntimeError("boom")),
            ):
                assert await result["_send_welcome_email"]() is True

        assert welcome.call_args.kwargs["google_account"] is None
        assert welcome.call_args.kwargs["prospect"].first_name == "Jordan"

    async def test_an_existing_address_is_linked_and_left_alone(self, db_session):
        org = await _org(db_session)
        await _connect(db_session, org)
        svc, prospect = await _prospect(db_session, org)
        fake = FakeDirectory(create_error=GoogleAccountExistsError("exists"))

        result = await svc._do_transfer(prospect, None)
        await db_session.commit()
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await result["_provision_google"]()

        row = await _row(db_session, result["user_id"])
        assert row.status == GoogleAccountStatus.LINKED_EXISTING.value
        assert fake.groups == []
        assert row.credentials_sent is False

    async def test_a_google_failure_never_undoes_the_conversion(self, db_session):
        org = await _org(db_session)
        await _connect(db_session, org)
        svc, prospect = await _prospect(db_session, org)
        fake = FakeDirectory(create_error=GoogleWorkspaceError("No licenses left."))

        result = await svc._do_transfer(prospect, None)
        await db_session.commit()
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await result["_provision_google"]()

        row = await _row(db_session, result["user_id"])
        assert row.status == GoogleAccountStatus.FAILED.value
        assert row.last_error == "No licenses left."
        await db_session.refresh(prospect)
        assert str(prospect.transferred_user_id) == str(result["user_id"])

    async def test_an_address_off_the_domain_fails_without_calling_google(
        self, db_session
    ):
        org = await _org(db_session)
        await _connect(db_session, org, domain="other.org")
        svc, prospect = await _prospect(db_session, org)
        fake = FakeDirectory()

        result = await svc._do_transfer(prospect, None)
        await db_session.commit()
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await result["_provision_google"]()

        row = await _row(db_session, result["user_id"])
        assert row.status == GoogleAccountStatus.FAILED.value
        assert fake.created == []

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
            await result["_provision_google"]()

        row = await _row(db_session, result["user_id"])
        assert row.status == GoogleAccountStatus.CREATED.value
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
            db_session, status=GoogleAccountStatus.FAILED.value
        )
        fake = FakeDirectory()
        with (
            patch(f"{SERVICE}.directory_for", return_value=fake),
            patch(
                "app.services.email_service.EmailService.send_email",
                AsyncMock(return_value=(1, 0)),
            ),
        ):
            row = await GoogleWorkspaceProvisioningService(db_session).retry(
                user_id, org.id
            )
        assert row.status == GoogleAccountStatus.CREATED.value
        assert row.credentials_sent is True
        assert row.attempts == 1

    async def test_an_undelivered_password_is_reset_and_resent(self, db_session):
        org, user_id = await self._staged(
            db_session,
            status=GoogleAccountStatus.CREATED.value,
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
            row = await GoogleWorkspaceProvisioningService(db_session).retry(
                user_id, org.id
            )
        assert len(fake.resets) == 1
        assert fake.resets[0] in send.call_args.kwargs["text_body"]
        assert row.credentials_sent is True

    async def test_a_linked_account_is_never_touched(self, db_session):
        org, user_id = await self._staged(
            db_session, status=GoogleAccountStatus.LINKED_EXISTING.value
        )
        with pytest.raises(ProvisionRetryError):
            await GoogleWorkspaceProvisioningService(db_session).retry(user_id, org.id)

    async def test_a_second_retry_inside_a_minute_is_refused(self, db_session):
        org, user_id = await self._staged(
            db_session,
            status=GoogleAccountStatus.FAILED.value,
            last_attempt_at=datetime.now(timezone.utc) - timedelta(seconds=5),
        )
        with pytest.raises(ProvisionRetryTooSoon):
            await GoogleWorkspaceProvisioningService(db_session).retry(user_id, org.id)

    async def test_another_orgs_member_is_not_found(self, db_session):
        _, user_id = await self._staged(
            db_session, status=GoogleAccountStatus.FAILED.value
        )
        other = await _org(db_session)
        with pytest.raises(LookupError):
            await GoogleWorkspaceProvisioningService(db_session).retry(
                user_id, other.id
            )

    async def test_the_endpoint_maps_refusals_to_status_codes(self, db_session):
        from app.api.v1.endpoints.google_workspace import (
            get_member_google_account,
            retry_member_google_account,
        )

        org, user_id = await self._staged(
            db_session, status=GoogleAccountStatus.LINKED_EXISTING.value
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
                GoogleWorkspaceProvisioningService,
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
            "_provision_google": AsyncMock(side_effect=RuntimeError("boom")),
        }
        result, db_events = await self._run(transfer)

        assert db_events == ["commit", "rollback"]
        assert result["success"] is True
        assert "_provision_google" not in result

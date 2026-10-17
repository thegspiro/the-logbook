"""Google Workspace: the connection test's org-unit check, the "needs
attention" list, and the daily email about overdue accounts."""

import json
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select, text

from app.models.google_workspace import (
    GOOGLE_WORKSPACE_INTEGRATION,
    GoogleAccountProvision,
    GoogleAccountStatus,
)
from app.models.integration import Integration
from app.models.user import Organization, Position, User, UserStatus, user_roles
from app.services.email_service import EmailService
from app.services.google_workspace_attention_digest import (
    LAST_DIGEST_KEY,
    SETTINGS_KEY,
    send_google_workspace_attention_digest,
)
from app.services.google_workspace_provisioning_service import (
    AttentionIssue,
    GoogleWorkspaceProvisioningService,
)
from app.services.integration_services.google_workspace_service import (
    DIRECTORY_SCOPES,
    ORG_UNIT_SCOPE,
    GoogleWorkspaceDirectory,
    GoogleWorkspaceError,
)
from app.utils.org_timezone import org_today

DOMAIN = "firedept.org"
NOW = datetime.now(timezone.utc)
LONG_AGO = NOW - timedelta(days=2)
RECENTLY = NOW - timedelta(minutes=30)


def _hex() -> str:
    return uuid.uuid4().hex[:8]


def _http_error(status: int):
    from googleapiclient.errors import HttpError

    return HttpError(SimpleNamespace(status=status, reason="x"), b"{}")


@pytest.mark.unit
class TestOrgUnitCheck:
    def _directory(self, org_unit_error=None):
        directory = GoogleWorkspaceDirectory({}, "admin@firedept.org")
        service = MagicMock()
        service.users.return_value.list.return_value.execute.return_value = {}
        get = service.orgunits.return_value.get
        if org_unit_error is not None:
            get.return_value.execute.side_effect = org_unit_error
        else:
            get.return_value.execute.return_value = {"orgUnitPath": "/Members"}
        scopes_used: list[tuple[str, ...]] = []

        def make_service(scopes=DIRECTORY_SCOPES):
            scopes_used.append(scopes)
            return service

        return directory, service, scopes_used, make_service

    async def test_an_existing_org_unit_is_reported(self):
        directory, service, scopes_used, make = self._directory()
        with patch.object(directory, "_service", side_effect=make):
            message = await directory.test_connection(DOMAIN, [], "/Members")
        assert "org unit /Members" in message
        get = service.orgunits.return_value.get
        get.assert_called_once_with(customerId="my_customer", orgUnitPath="Members")
        # Only the org-unit read asks for the extra scope.
        assert scopes_used.count(DIRECTORY_SCOPES + (ORG_UNIT_SCOPE,)) == 1
        assert scopes_used[0] == DIRECTORY_SCOPES

    async def test_the_top_level_needs_no_check(self):
        directory, service, scopes_used, make = self._directory()
        with patch.object(directory, "_service", side_effect=make):
            message = await directory.test_connection(DOMAIN, [], "/")
        service.orgunits.assert_not_called()
        assert all(scopes == DIRECTORY_SCOPES for scopes in scopes_used)
        assert "the top level" in message

    async def test_a_missing_org_unit_is_named(self):
        directory, _, _, make = self._directory(_http_error(404))
        with patch.object(directory, "_service", side_effect=make):
            with pytest.raises(GoogleWorkspaceError, match="/Members does not exist"):
                await directory.test_connection(DOMAIN, [], "/Members")

    async def test_an_unauthorized_scope_passes_and_names_the_scope_to_add(self):
        # Creation and suspension work without the scope; a failed Test would
        # mark a working integration unhealthy, so it passes with a note.
        from google.auth.exceptions import RefreshError

        directory, _, _, make = self._directory(RefreshError("unauthorized_client"))
        with patch.object(directory, "_service", side_effect=make):
            message = await directory.test_connection(DOMAIN, [], "/Members")
        assert message.startswith(f"Connected to Google Workspace for {DOMAIN}")
        assert ORG_UNIT_SCOPE in message
        assert "not checked" in message

    def test_operating_calls_never_ask_for_the_extra_scope(self):
        # Google refuses a delegated token outright when any requested scope
        # is not authorized; creation and suspension must not depend on it.
        assert ORG_UNIT_SCOPE not in DIRECTORY_SCOPES
        directory = GoogleWorkspaceDirectory({"type": "service_account"}, "a@b.org")
        with (
            patch(
                "google.oauth2.service_account.Credentials.from_service_account_info"
            ) as make_credentials,
            patch("googleapiclient.discovery.build"),
            patch("google_auth_httplib2.AuthorizedHttp"),
        ):
            directory._service()
            directory._service(DIRECTORY_SCOPES + (ORG_UNIT_SCOPE,))
            directory._service()
        scopes = [c.kwargs["scopes"] for c in make_credentials.call_args_list]
        assert scopes == [list(DIRECTORY_SCOPES), [*DIRECTORY_SCOPES, ORG_UNIT_SCOPE]]


async def _org(db_session) -> Organization:
    org = Organization(
        name="Attention VFD",
        slug=f"att-{_hex()}",
        settings={"department_email": {"enabled": True, "domain": DOMAIN}},
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _connect(db_session, org) -> None:
    integration = Integration(
        organization_id=org.id,
        integration_type=GOOGLE_WORKSPACE_INTEGRATION,
        name="Google Workspace",
        category="Access Control",
        status="connected",
        enabled=True,
        config={"admin_email": "admin@firedept.org", "domain": DOMAIN},
    )
    integration.set_secret("service_account_key", json.dumps({"type": "x"}))
    db_session.add(integration)
    await db_session.flush()


async def _member(db_session, org, name, *, status=UserStatus.ACTIVE) -> User:
    member = User(
        organization_id=org.id,
        username=f"m-{_hex()}",
        email=f"{name.lower()}-{_hex()}@{DOMAIN}",
        first_name=name,
        last_name="Member",
        status=status,
    )
    db_session.add(member)
    await db_session.flush()
    return member


async def _record(db_session, org, member, **fields) -> GoogleAccountProvision:
    row = GoogleAccountProvision(
        organization_id=org.id,
        user_id=member.id,
        primary_email=member.email,
        status=fields.pop("status", GoogleAccountStatus.CREATED.value),
        credentials_sent=fields.pop("credentials_sent", True),
        **fields,
    )
    db_session.add(row)
    await db_session.flush()
    return row


async def _department(db_session):
    """One member in each state the list reports, and two it must not."""
    org = await _org(db_session)
    await _connect(db_session, org)
    m = {}
    m["gone"] = await _member(
        db_session, org, "Gone", status=UserStatus.DROPPED_VOLUNTARY
    )
    await _record(
        db_session,
        org,
        m["gone"],
        suspension_wanted=True,
        suspension_settled=False,
        suspension_error="Google Workspace is busy or unavailable.",
        suspension_requested_at=LONG_AGO,
    )
    m["back"] = await _member(db_session, org, "Back")
    await _record(
        db_session,
        org,
        m["back"],
        suspension_wanted=False,
        suspension_settled=False,
        suspension_requested_at=RECENTLY,
    )
    m["failed"] = await _member(db_session, org, "Failed")
    await _record(
        db_session,
        org,
        m["failed"],
        status=GoogleAccountStatus.FAILED.value,
        last_error="No licenses left.",
        last_attempt_at=LONG_AGO,
        created_at=LONG_AGO,
    )
    m["unsent"] = await _member(db_session, org, "Unsent")
    await _record(
        db_session,
        org,
        m["unsent"],
        credentials_sent=False,
        last_attempt_at=LONG_AGO,
        created_at=LONG_AGO,
    )
    # Fine: a settled, finished account.
    m["fine"] = await _member(db_session, org, "Fine")
    await _record(db_session, org, m["fine"])
    # Not wanted: a member who left before their account was ever created.
    m["left_failed"] = await _member(
        db_session, org, "Leftfailed", status=UserStatus.DROPPED_INVOLUNTARY
    )
    await _record(
        db_session,
        org,
        m["left_failed"],
        status=GoogleAccountStatus.FAILED.value,
        last_error="No licenses left.",
        last_attempt_at=LONG_AGO,
        created_at=LONG_AGO,
    )
    # Still being created, but only for a few minutes.
    m["fresh"] = await _member(db_session, org, "Fresh")
    await _record(db_session, org, m["fresh"], status=GoogleAccountStatus.PENDING.value)
    await db_session.commit()
    return org, m


@pytest.mark.integration
class TestAttentionList:
    async def test_lists_what_needs_a_person_departures_first(self, db_session):
        org, m = await _department(db_session)
        items = await GoogleWorkspaceProvisioningService(db_session).attention_items(
            org.id
        )
        by_member = {i.user_id: i for i in items}
        assert [i.issue for i in items] == [
            AttentionIssue.NOT_SUSPENDED,
            AttentionIssue.NOT_UNSUSPENDED,
            AttentionIssue.NOT_CREATED,
            AttentionIssue.SETUP_UNFINISHED,
        ]
        gone = by_member[m["gone"].id]
        assert gone.overdue is True
        assert gone.detail == "Google Workspace is busy or unavailable."
        assert by_member[m["back"].id].overdue is False
        assert by_member[m["failed"].id].detail == "No licenses left."
        assert "password" in (by_member[m["unsent"].id].detail or "")
        for quiet in ("fine", "left_failed", "fresh"):
            assert m[quiet].id not in by_member

    async def test_a_member_who_left_mid_creation_is_listed_for_suspension(
        self, db_session
    ):
        # The create call may have reached Google with its answer lost; the
        # departure hook has no account to suspend, so a person must look.
        org = await _org(db_session)
        member = await _member(
            db_session, org, "Midway", status=UserStatus.DROPPED_VOLUNTARY
        )
        await _record(
            db_session,
            org,
            member,
            status=GoogleAccountStatus.PENDING.value,
            last_attempt_at=NOW - timedelta(hours=2),
        )
        await db_session.commit()
        items = await GoogleWorkspaceProvisioningService(db_session).attention_items(
            org.id
        )
        assert [i.issue for i in items] == [AttentionIssue.NOT_SUSPENDED]
        assert items[0].label == "Left, but the account is not suspended"
        assert "check the Google Admin console" in (items[0].detail or "")

    async def test_a_retry_that_fails_again_does_not_restart_the_clock(
        self, db_session
    ):
        org = await _org(db_session)
        member = await _member(db_session, org, "Retried")
        row = await _record(
            db_session,
            org,
            member,
            status=GoogleAccountStatus.FAILED.value,
            last_attempt_at=NOW - timedelta(minutes=5),
        )
        await db_session.execute(
            text(
                "UPDATE google_account_provisions SET created_at = :at WHERE id = :id"
            ),
            {"at": LONG_AGO.replace(tzinfo=None), "id": row.id},
        )
        await db_session.commit()
        await db_session.refresh(row)
        items = await GoogleWorkspaceProvisioningService(db_session).attention_items(
            org.id
        )
        assert [i.overdue for i in items] == [True]

    async def test_a_suspension_waiting_at_upgrade_gets_a_start_time(self, db_session):
        # Measured from updated_at, which every 15-minute retry moves, it
        # would never become overdue; the migration stamps it instead.
        import importlib.util
        from pathlib import Path

        path = (
            Path(__file__).parent.parent
            / "alembic"
            / "versions"
            / "20261016_1754_64bf75298e89_google_account_suspension_requested_at.py"
        )
        spec = importlib.util.spec_from_file_location("revision_64bf75298e89", path)
        assert spec is not None
        assert spec.loader is not None
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        org = await _org(db_session)
        waiting = await _member(
            db_session, org, "Waiting", status=UserStatus.DROPPED_VOLUNTARY
        )
        settled = await _member(db_session, org, "Settled")
        await _record(
            db_session, org, waiting, suspension_wanted=True, suspension_settled=False
        )
        await _record(db_session, org, settled)
        await db_session.commit()

        await db_session.run_sync(lambda s: migration._backfill(s.connection()))

        stamped = dict(
            (
                await db_session.execute(
                    text(
                        "SELECT user_id, suspension_requested_at "
                        "FROM google_account_provisions WHERE organization_id = :org"
                    ),
                    {"org": org.id},
                )
            ).all()
        )
        assert stamped[waiting.id] is not None
        assert stamped[settled.id] is None

    async def test_a_creation_that_never_answered_is_listed_after_an_hour(
        self, db_session
    ):
        org = await _org(db_session)
        member = await _member(db_session, org, "Stuck")
        await _record(
            db_session,
            org,
            member,
            status=GoogleAccountStatus.PENDING.value,
            last_attempt_at=NOW - timedelta(hours=2),
        )
        await db_session.commit()
        (item,) = await GoogleWorkspaceProvisioningService(db_session).attention_items(
            org.id
        )
        assert item.issue == AttentionIssue.NOT_CREATED
        assert item.overdue is False

    async def test_another_departments_accounts_are_not_listed(self, db_session):
        org, _ = await _department(db_session)
        other = await _org(db_session)
        await db_session.commit()
        assert (
            await GoogleWorkspaceProvisioningService(db_session).attention_items(
                other.id
            )
            == []
        )
        assert org.id != other.id

    async def test_a_departure_records_when_it_was_asked_for(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org, "Leaving")
        await _record(db_session, org, member)
        await db_session.commit()
        before = datetime.now(timezone.utc) - timedelta(seconds=5)

        member.status = UserStatus.DROPPED_VOLUNTARY
        await db_session.commit()

        row = (
            await db_session.execute(
                select(GoogleAccountProvision).where(
                    GoogleAccountProvision.user_id == member.id
                )
            )
        ).scalar_one()
        await db_session.refresh(row)
        requested = row.suspension_requested_at
        assert requested is not None
        if requested.tzinfo is None:
            requested = requested.replace(tzinfo=timezone.utc)
        assert requested >= before

    async def test_the_endpoint_returns_the_list(self, db_session):
        from app.api.v1.endpoints.google_workspace import list_attention

        org, m = await _department(db_session)
        response = await list_attention(
            db=db_session, current_user=SimpleNamespace(organization_id=org.id)
        )
        assert [i.user_id for i in response.items][0] == m["gone"].id
        assert response.items[0].member_name == "Gone Member"
        assert response.items[0].label == "Left, but the account is not suspended"

    def test_the_endpoint_needs_integrations_manage(self):
        from app.api.v1.endpoints.google_workspace import router

        route = next(r for r in router.routes if r.path == "/attention")
        checker = route.dependant.dependencies[-1].call
        assert list(checker.required_permissions) == ["integrations.manage"]


async def _with_permissions(db_session, org, *permissions, preferences=None):
    position = Position(
        organization_id=org.id,
        name=f"Holder {_hex()}",
        slug=f"holder-{_hex()}",
        permissions=list(permissions),
    )
    db_session.add(position)
    await db_session.flush()
    user_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status, notification_preferences) "
            "VALUES (:id, :org, :un, 'Pat', 'Admin', :em, 'hashed', 'active', "
            ":prefs)"
        ),
        {
            "id": user_id,
            "org": str(org.id),
            "un": f"a-{user_id[:8]}",
            "em": f"a-{user_id[:8]}@example.org",
            "prefs": preferences,
        },
    )
    await db_session.execute(
        user_roles.insert().values(user_id=user_id, position_id=position.id)
    )
    await db_session.flush()
    return f"a-{user_id[:8]}@example.org"


@pytest.fixture
def send_email():
    mock = AsyncMock(return_value=(1, 0))
    # One patch, entered once, outside any concurrent section (pitfall #22).
    with patch.object(EmailService, "send_email", mock):
        yield mock


@pytest.mark.integration
class TestAttentionDigest:
    async def test_admin_access_holders_get_the_overdue_items(
        self, db_session, send_email
    ):
        org, m = await _department(db_session)
        admin = await _with_permissions(db_session, org, "admin.access")
        await _with_permissions(db_session, org, "members.manage")
        await db_session.commit()

        assert await send_google_workspace_attention_digest(db_session, org) == 1

        assert send_email.await_args.kwargs["to_emails"] == [admin]
        body = send_email.await_args.kwargs["html_body"]
        assert "Gone Member" in body
        assert "Failed Member" in body
        assert "Unsent Member" in body
        # Not overdue yet: on screen, not in the email.
        assert "Back Member" not in body
        assert "still have a working" in body
        assert f"/members/{m['gone'].id}" in body
        assert send_email.await_args.kwargs["subject"].startswith("3 Google")

    async def test_it_is_sent_at_most_once_a_day(self, db_session, send_email):
        org, _ = await _department(db_session)
        await _with_permissions(db_session, org, "admin.access")
        await db_session.commit()

        assert await send_google_workspace_attention_digest(db_session, org) == 1
        assert await send_google_workspace_attention_digest(db_session, org) == 0
        assert send_email.await_count == 1
        assert org.settings[SETTINGS_KEY][LAST_DIGEST_KEY] == (
            org_today(org).isoformat()
        )
        # The department-email settings beside it are untouched.
        assert org.settings["department_email"]["domain"] == DOMAIN

    async def test_nothing_is_sent_while_nothing_is_overdue(
        self, db_session, send_email
    ):
        org = await _org(db_session)
        await _connect(db_session, org)
        member = await _member(db_session, org, "Recent")
        await _record(
            db_session,
            org,
            member,
            status=GoogleAccountStatus.FAILED.value,
            last_attempt_at=RECENTLY,
        )
        await _with_permissions(db_session, org, "admin.access")
        await db_session.commit()

        assert await send_google_workspace_attention_digest(db_session, org) == 0
        send_email.assert_not_awaited()

    async def test_nothing_is_sent_without_the_integration(
        self, db_session, send_email
    ):
        org, _ = await _department(db_session)
        await _with_permissions(db_session, org, "admin.access")
        await db_session.execute(
            text("UPDATE integrations SET enabled = 0 WHERE organization_id = :org"),
            {"org": str(org.id)},
        )
        await db_session.commit()

        assert await send_google_workspace_attention_digest(db_session, org) == 0
        send_email.assert_not_awaited()

    async def test_an_administrator_who_opted_out_is_not_emailed(
        self, db_session, send_email
    ):
        org, _ = await _department(db_session)
        await _with_permissions(
            db_session,
            org,
            "admin.access",
            preferences='{"email_kinds": {"membership_admin": false}}',
        )
        await db_session.commit()

        assert await send_google_workspace_attention_digest(db_session, org) == 0
        send_email.assert_not_awaited()
        assert SETTINGS_KEY not in (org.settings or {})

    async def test_a_failed_send_is_tried_again(self, db_session, send_email):
        org, _ = await _department(db_session)
        await _with_permissions(db_session, org, "admin.access")
        await db_session.commit()
        send_email.return_value = (0, 1)

        assert await send_google_workspace_attention_digest(db_session, org) == 0
        assert SETTINGS_KEY not in (org.settings or {})

    async def test_a_member_name_cannot_inject_markup(self, db_session, send_email):
        org = await _org(db_session)
        await _connect(db_session, org)
        member = await _member(db_session, org, "<b>Evil</b>")
        await _record(
            db_session,
            org,
            member,
            status=GoogleAccountStatus.FAILED.value,
            last_error="<script>x</script>",
            last_attempt_at=LONG_AGO,
            created_at=LONG_AGO,
        )
        await _with_permissions(db_session, org, "admin.access")
        await db_session.commit()

        assert await send_google_workspace_attention_digest(db_session, org) == 1
        body = send_email.await_args.kwargs["html_body"]
        assert "<b>Evil</b>" not in body
        assert "&lt;b&gt;Evil&lt;/b&gt;" in body
        assert "<script>x</script>" not in body

    async def test_it_sends_with_the_departments_own_mail_settings(
        self, db_session, send_email
    ):
        org, _ = await _department(db_session)
        await _with_permissions(db_session, org, "admin.access")
        await db_session.commit()
        built_for = []
        real_init = EmailService.__init__

        def remember(self, organization=None):
            built_for.append(organization)
            real_init(self, organization)

        with patch.object(EmailService, "__init__", remember):
            assert await send_google_workspace_attention_digest(db_session, org) == 1
        assert built_for
        assert all(o is org for o in built_for)

    async def test_the_scheduled_task_runs_it_for_each_department(
        self, db_session, send_email
    ):
        from app.services.scheduled_tasks import (
            TASK_INTERVALS_SECONDS,
            TASK_RUNNERS,
            run_google_workspace_attention_digest,
        )

        org, _ = await _department(db_session)
        await _with_permissions(db_session, org, "admin.access")
        await db_session.commit()

        result = await run_google_workspace_attention_digest(db_session)

        assert result["task"] == "google_workspace_attention_digest"
        assert send_email.await_count >= 1
        assert (
            TASK_RUNNERS["google_workspace_attention_digest"]
            is run_google_workspace_attention_digest
        )
        assert TASK_INTERVALS_SECONDS["google_workspace_attention_digest"] == 86400

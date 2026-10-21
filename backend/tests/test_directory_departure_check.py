"""The daily check for departed members' accounts turned back on.

A suspension The Logbook settled can be lifted in the directory's own admin
console. The check lists the domain once, suspends any departed member's
account found active again, audit-logs it, and the morning email names it.
The directory itself is never called: ``directory_for`` is replaced by a fake.
"""

from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from app.models.audit import AuditLog
from app.models.directory_account import (
    DirectoryAccountProvision,
    DirectoryAccountStatus,
)
from app.models.user import User, UserStatus
from app.services import scheduled_tasks
from app.services.directory_account_service import (
    ACTIVE_AFTER_DEPARTURE_EVENT,
    DirectoryAccountService,
)
from app.services.email_service import EmailService
from app.services.google_workspace_attention_digest import (
    send_google_workspace_attention_digest,
)
from app.services.integration_services.google_workspace_service import (
    GoogleWorkspaceError,
)
from tests.test_google_workspace_attention import _with_permissions
from tests.test_google_workspace_provisioning import (
    DOMAIN,
    SERVICE,
    FakeDirectory,
    _connect,
    _hex,
    _org,
)

EVENT = f"google_workspace.{ACTIVE_AFTER_DEPARTURE_EVENT}"


@pytest.fixture
def send_email():
    mock = AsyncMock(return_value=(1, 0))
    with patch.object(EmailService, "send_email", mock):
        yield mock


async def _member(db_session, org, name, *, status=UserStatus.DROPPED_VOLUNTARY):
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


async def _settled(db_session, org, member, account_id, **fields):
    """A suspension already applied: what a completed departure leaves."""
    values = {
        "status": DirectoryAccountStatus.CREATED.value,
        "credentials_sent": True,
        "suspension_wanted": True,
        "suspension_settled": True,
        "suspended_by_logbook": True,
        **fields,
    }
    row = DirectoryAccountProvision(
        organization_id=org.id,
        user_id=member.id,
        provider="google",
        primary_email=member.email,
        external_user_id=account_id,
        **values,
    )
    db_session.add(row)
    await db_session.flush()
    return row


async def _department(db_session):
    org = await _org(db_session)
    await _connect(db_session, org)
    return org


def _account(member, account_id, *, suspended):
    return {"id": account_id, "primaryEmail": member.email, "suspended": suspended}


async def _check(db_session, org, fake):
    with patch(f"{SERVICE}.directory_for", return_value=fake):
        return await DirectoryAccountService(db_session).check_departed_suspensions(
            str(org.id)
        )


async def _events(db_session, org):
    return (
        (
            await db_session.execute(
                select(AuditLog.event_data).where(
                    AuditLog.organization_id == str(org.id),
                    AuditLog.event_type == EVENT,
                )
            )
        )
        .scalars()
        .all()
    )


@pytest.mark.integration
class TestDepartureCheck:
    async def test_an_account_turned_back_on_is_suspended_again_and_logged(
        self, db_session
    ):
        org = await _department(db_session)
        gone = await _member(db_session, org, "Gone")
        row = await _settled(db_session, org, gone, "g-gone")
        await db_session.commit()
        fake = FakeDirectory()
        fake.domain_users = [_account(gone, "g-gone", suspended=False)]

        assert await _check(db_session, org, fake) == [str(gone.id)]

        assert fake.suspend_calls == [True]
        assert fake.keys[-1] == "g-gone"
        await db_session.refresh(row)
        assert row.suspended_by_logbook is True
        assert row.suspension_settled is True
        assert row.suspension_error is None
        assert await _events(db_session, org) == [{"target_user_id": str(gone.id)}]

    async def test_a_failed_suspension_is_left_for_the_sweep_with_a_reason(
        self, db_session
    ):
        org = await _department(db_session)
        gone = await _member(db_session, org, "Gone")
        row = await _settled(db_session, org, gone, "g-gone")
        await db_session.commit()
        fake = FakeDirectory()
        fake.domain_users = [_account(gone, "g-gone", suspended=False)]
        fake.suspend_error = GoogleWorkspaceError("Google is busy.")

        assert await _check(db_session, org, fake) == [str(gone.id)]

        await db_session.refresh(row)
        assert row.suspension_settled is False
        assert row.suspended_by_logbook is False
        assert row.suspension_error == "Google is busy."
        assert row.suspension_requested_at is not None

    async def test_a_still_suspended_account_is_left_alone(self, db_session):
        org = await _department(db_session)
        gone = await _member(db_session, org, "Gone")
        await _settled(db_session, org, gone, "g-gone")
        await db_session.commit()
        fake = FakeDirectory()
        fake.domain_users = [_account(gone, "g-gone", suspended=True)]

        assert await _check(db_session, org, fake) == []
        assert fake.suspend_calls == []
        assert await _events(db_session, org) == []

    async def test_current_members_are_not_checked(self, db_session):
        # A member who rejoined has suspension_wanted False; one recorded as
        # active with a stale wanted flag is still not a departure.
        org = await _department(db_session)
        back = await _member(db_session, org, "Back", status=UserStatus.ACTIVE)
        await _settled(db_session, org, back, "g-back")
        await db_session.commit()
        fake = FakeDirectory()
        fake.domain_users = [_account(back, "g-back", suspended=False)]
        listed = []

        async def _list(domain):
            listed.append(domain)
            return []

        fake.list_users = _list

        assert await _check(db_session, org, fake) == []
        assert listed == []
        assert fake.suspend_calls == []

    async def test_an_account_the_api_cannot_change_is_skipped(self, db_session):
        org = await _department(db_session)
        gone = await _member(db_session, org, "Gone")
        await _settled(db_session, org, gone, "g-gone", managed_on_premises=True)
        await db_session.commit()
        fake = FakeDirectory()
        fake.domain_users = [_account(gone, "g-gone", suspended=False)]

        assert await _check(db_session, org, fake) == []
        assert fake.suspend_calls == []

    async def test_an_unsettled_suspension_is_the_sweeps_not_this_checks(
        self, db_session
    ):
        org = await _department(db_session)
        gone = await _member(db_session, org, "Gone")
        await _settled(
            db_session,
            org,
            gone,
            "g-gone",
            suspension_settled=False,
            suspended_by_logbook=False,
        )
        await db_session.commit()
        fake = FakeDirectory()
        fake.domain_users = [_account(gone, "g-gone", suspended=False)]

        assert await _check(db_session, org, fake) == []
        assert fake.suspend_calls == []

    async def test_a_listing_failure_changes_nothing(self, db_session):
        org = await _department(db_session)
        gone = await _member(db_session, org, "Gone")
        row = await _settled(db_session, org, gone, "g-gone")
        await db_session.commit()
        fake = FakeDirectory()

        async def _fail(domain):
            raise GoogleWorkspaceError("Google is busy.")

        fake.list_users = _fail

        assert await _check(db_session, org, fake) == []
        await db_session.refresh(row)
        assert row.suspension_settled is True
        assert row.suspension_error is None
        assert await _events(db_session, org) == []

    async def test_an_account_gone_from_the_directory_is_skipped(self, db_session):
        org = await _department(db_session)
        gone = await _member(db_session, org, "Gone")
        await _settled(db_session, org, gone, "g-gone")
        await db_session.commit()
        fake = FakeDirectory()

        assert await _check(db_session, org, fake) == []
        assert fake.suspend_calls == []

    async def test_a_newer_account_at_the_same_address_is_not_mistaken_for_it(
        self, db_session
    ):
        org = await _department(db_session)
        gone = await _member(db_session, org, "Gone")
        await _settled(db_session, org, gone, "g-gone")
        await db_session.commit()
        fake = FakeDirectory()
        fake.domain_users = [_account(gone, "g-someone-new", suspended=False)]

        assert await _check(db_session, org, fake) == []
        assert fake.suspend_calls == []

    async def test_a_record_without_an_id_is_matched_by_address(self, db_session):
        org = await _department(db_session)
        gone = await _member(db_session, org, "Gone")
        await _settled(db_session, org, gone, None)
        await db_session.commit()
        fake = FakeDirectory()
        fake.domain_users = [
            {
                "id": "g-gone",
                "primaryEmail": gone.email.upper(),
                "suspended": False,
            }
        ]

        assert await _check(db_session, org, fake) == [str(gone.id)]
        assert fake.suspend_calls == [True]

    async def test_another_departments_records_are_not_touched(self, db_session):
        org = await _department(db_session)
        other = await _department(db_session)
        theirs = await _member(db_session, other, "Theirs")
        await _settled(db_session, other, theirs, "g-theirs")
        await db_session.commit()
        fake = FakeDirectory()
        fake.domain_users = [_account(theirs, "g-theirs", suspended=False)]

        assert await _check(db_session, org, fake) == []
        assert fake.suspend_calls == []
        assert await _events(db_session, other) == []

    async def test_nothing_runs_without_the_integration(self, db_session):
        org = await _org(db_session)
        gone = await _member(db_session, org, "Gone")
        await _settled(db_session, org, gone, "g-gone")
        await db_session.commit()
        fake = FakeDirectory()
        fake.domain_users = [_account(gone, "g-gone", suspended=False)]

        assert await _check(db_session, org, fake) == []
        assert fake.suspend_calls == []


@pytest.mark.integration
class TestMorningEmail:
    async def test_the_email_names_it_even_when_nothing_is_overdue(
        self, db_session, send_email
    ):
        org = await _department(db_session)
        gone = await _member(db_session, org, "Gone")
        await _settled(db_session, org, gone, "g-gone")
        admin = await _with_permissions(db_session, org, "admin.access")
        await db_session.commit()
        fake = FakeDirectory()
        fake.domain_users = [_account(gone, "g-gone", suspended=False)]
        await _check(db_session, org, fake)

        assert await send_google_workspace_attention_digest(db_session, org) == 1

        kwargs = send_email.await_args.kwargs
        assert kwargs["to_emails"] == [admin]
        assert "turned back on" in kwargs["html_body"]
        assert "Gone Member" in kwargs["html_body"]
        assert f"/members/{gone.id}" in kwargs["html_body"]
        assert kwargs["subject"].startswith("1 Google")

    async def test_another_departments_event_is_not_reported(
        self, db_session, send_email
    ):
        org = await _department(db_session)
        await _with_permissions(db_session, org, "admin.access")
        other = await _department(db_session)
        theirs = await _member(db_session, other, "Theirs")
        await _settled(db_session, other, theirs, "g-theirs")
        await db_session.commit()
        fake = FakeDirectory()
        fake.domain_users = [_account(theirs, "g-theirs", suspended=False)]
        await _check(db_session, other, fake)

        assert await send_google_workspace_attention_digest(db_session, org) == 0
        send_email.assert_not_awaited()


@pytest.mark.unit
class TestRegistration:
    def test_the_check_runs_daily_before_the_email(self):
        name = "directory_account_departure_check"
        assert name in scheduled_tasks.TASK_RUNNERS
        assert scheduled_tasks.TASK_INTERVALS_SECONDS[name] == 86400
        check = scheduled_tasks.SCHEDULE[name]["cron"].split()
        digest = scheduled_tasks.SCHEDULE["google_workspace_attention_digest"][
            "cron"
        ].split()
        assert (int(check[1]), int(check[0])) < (int(digest[1]), int(digest[0]))

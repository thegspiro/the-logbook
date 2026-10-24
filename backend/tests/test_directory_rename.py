"""A member's name change reaches the account The Logbook created for them.

The change is recorded with the rename and sent after the commit; a failure
waits for the 15-minute sweep. The address never changes, a linked existing
account is never renamed, and a departed member's account keeps its name
until they return.
"""

import json
from unittest.mock import MagicMock, patch

import httpx
import pytest
from sqlalchemy import select

from app.models.audit import AuditLog
from app.models.directory_account import DirectoryAccountStatus
from app.models.user import User
from app.services.directory_account_service import DirectoryAccountService
from app.services.integration_services.google_workspace_service import (
    GoogleAccountNotFoundError,
    GoogleWorkspaceDirectory,
    GoogleWorkspaceError,
)
from tests.test_google_workspace_provisioning import (
    SERVICE,
    FakeDirectory,
    _change_status,
    _member_with_account,
    _row,
    _settle,
)
from tests.test_microsoft_365_provisioning import CONNECTOR, Graph


@pytest.mark.unit
class TestGoogleConnector:
    async def test_the_name_is_patched_and_nothing_else(self):
        directory = GoogleWorkspaceDirectory({}, "admin@firedept.org")
        service = MagicMock()
        with patch.object(directory, "_service", return_value=service):
            await directory.update_name("g-1", "Jordan", "Hale-Ruiz")
        service.users.return_value.patch.assert_called_once_with(
            userKey="g-1",
            body={"name": {"givenName": "Jordan", "familyName": "Hale-Ruiz"}},
        )


@pytest.mark.unit
class TestMicrosoftConnector:
    @pytest.fixture(autouse=True)
    def _token(self):
        with patch(f"{CONNECTOR}.acquire_access_token", return_value="tok"):
            yield

    async def test_the_names_and_display_name_are_patched(self):
        seen: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return httpx.Response(204)

        await Graph(handler).client().update_name("ms-1", "Jordan", "Hale")
        assert seen[0].method == "PATCH"
        assert seen[0].url.path == "/v1.0/users/ms-1"
        assert json.loads(seen[0].content) == {
            "displayName": "Jordan Hale",
            "givenName": "Jordan",
            "surname": "Hale",
        }


async def _rename(db_session, user_id: str, first: str, last: str) -> None:
    member = await db_session.get(User, user_id)
    member.first_name = first
    member.last_name = last
    await db_session.commit()
    await _settle(db_session)


@pytest.mark.integration
class TestRenaming:
    async def test_a_name_change_reaches_the_account(self, db_session):
        org, user_id, _ = await _member_with_account(db_session)
        fake = FakeDirectory()
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _rename(db_session, user_id, "Jordan", "Hale-Ruiz")
        row = await _row(db_session, user_id)

        assert fake.renamed == [
            (row.external_user_id or row.primary_email, "Jordan", "Hale-Ruiz")
        ]
        assert row.name_pending is False
        events = (
            (
                await db_session.execute(
                    select(AuditLog.event_data).where(
                        AuditLog.organization_id == str(org.id),
                        AuditLog.event_type == "google_workspace.account_rename",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert events == [{"target_user_id": user_id, "outcome": "renamed"}]

    async def test_other_edits_do_not_rename(self, db_session):
        _, user_id, _ = await _member_with_account(db_session)
        fake = FakeDirectory()
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            member = await db_session.get(User, user_id)
            member.phone = "555-0100"
            await db_session.commit()
            await _settle(db_session)
        assert fake.renamed == []

    async def test_a_linked_existing_account_is_not_renamed(self, db_session):
        _, user_id, _ = await _member_with_account(
            db_session, status=DirectoryAccountStatus.LINKED_EXISTING.value
        )
        fake = FakeDirectory()
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _rename(db_session, user_id, "Jordan", "Hale")
        row = await _row(db_session, user_id)
        assert fake.renamed == []
        assert row.name_pending is False

    async def test_a_failure_waits_for_the_sweep(self, db_session):
        _, user_id, _ = await _member_with_account(db_session)
        fake = FakeDirectory()
        fake.rename_error = GoogleWorkspaceError("Google is busy.")
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _rename(db_session, user_id, "Jordan", "Hale")
        row = await _row(db_session, user_id)
        assert row.name_pending is True

        fake.rename_error = None
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            assert await DirectoryAccountService(db_session).sync_pending_names() >= 1
        row = await _row(db_session, user_id)
        assert row.name_pending is False
        assert fake.renamed[-1][1:] == ("Jordan", "Hale")

    async def test_an_account_gone_from_the_directory_is_let_go(self, db_session):
        _, user_id, _ = await _member_with_account(db_session)
        fake = FakeDirectory()
        fake.rename_error = GoogleAccountNotFoundError("gone")
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _rename(db_session, user_id, "Jordan", "Hale")
        row = await _row(db_session, user_id)
        assert row.name_pending is False

    async def test_a_departed_members_account_keeps_its_name_until_they_return(
        self, db_session
    ):
        _, user_id, caller = await _member_with_account(db_session)
        fake = FakeDirectory()
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _change_status(db_session, user_id, caller, "dropped_voluntary")
            await _rename(db_session, user_id, "Anonymized", "Member")
            row = await _row(db_session, user_id)
            assert fake.renamed == []
            assert row.name_pending is True
            assert await DirectoryAccountService(db_session).sync_pending_names() == 0

            await _change_status(db_session, user_id, caller, "active")
        row = await _row(db_session, user_id)
        assert fake.renamed[-1][1:] == ("Anonymized", "Member")
        assert row.name_pending is False

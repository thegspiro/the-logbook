"""A departed member's account leaves the department's groups.

When a departure suspends an account The Logbook created, the account is
also taken out of the integration's configured groups, so a suspended
mailbox stops receiving the department's mail. A Microsoft 365 group that
assigns licenses is never touched. A removal that fails waits on the record
for the 15-minute sweep and shows on the attention list; a return puts the
account back in the groups.
"""

from typing import Any
from unittest.mock import MagicMock, patch

import httpx
import pytest

from app.models.directory_account import DirectoryAccountStatus
from app.services.directory_account_service import (
    AttentionIssue,
    DirectoryAccountService,
)
from app.services.integration_services.google_workspace_service import (
    GoogleWorkspaceDirectory,
    GoogleWorkspaceError,
)
from tests.test_google_workspace_provisioning import (
    GROUP,
    SERVICE,
    FakeDirectory,
    _change_status,
    _http_error,
    _member_with_account,
    _row,
)
from tests.test_microsoft_365_provisioning import (
    CONNECTOR,
    GROUP_ID,
    Graph,
    _error,
    _user,
)


@pytest.mark.unit
class TestGoogleConnector:
    async def test_a_removal_deletes_the_membership(self):
        directory = GoogleWorkspaceDirectory({}, "admin@firedept.org")
        service = MagicMock()
        with patch.object(directory, "_service", return_value=service):
            assert await directory.remove_from_group(GROUP, "g-1") is True
        service.members.return_value.delete.assert_called_once_with(
            groupKey=GROUP, memberKey="g-1"
        )

    async def test_not_being_in_the_group_counts_as_done(self):
        directory = GoogleWorkspaceDirectory({}, "admin@firedept.org")
        service = MagicMock()
        service.members.return_value.delete.return_value.execute.side_effect = (
            _http_error(404)
        )
        with patch.object(directory, "_service", return_value=service):
            assert await directory.remove_from_group(GROUP, "g-1") is True

    async def test_a_refusal_is_raised_for_a_retry(self):
        directory = GoogleWorkspaceDirectory({}, "admin@firedept.org")
        service = MagicMock()
        service.members.return_value.delete.return_value.execute.side_effect = (
            _http_error(403)
        )
        with (
            patch.object(directory, "_service", return_value=service),
            pytest.raises(GoogleWorkspaceError),
        ):
            await directory.remove_from_group(GROUP, "g-1")


def _graph(group: dict[str, Any], membership: httpx.Response) -> Graph:
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if request.method == "GET" and path.endswith(f"/groups/{GROUP_ID}"):
            return httpx.Response(200, json=group)
        if request.method == "GET" and "/users/" in path:
            return httpx.Response(200, json=_user())
        if request.method == "DELETE":
            return membership
        return httpx.Response(404, json={})

    return Graph(handler)


@pytest.mark.unit
class TestMicrosoftConnector:
    @pytest.fixture(autouse=True)
    def _token(self):
        # A fixed token, as in the Microsoft connector tests: msal never runs.
        with patch(f"{CONNECTOR}.acquire_access_token", return_value="tok"):
            yield

    async def test_a_removal_deletes_the_membership(self):
        graph = _graph({"id": GROUP_ID, "assignedLicenses": []}, httpx.Response(204))
        assert await graph.client().remove_from_group(GROUP_ID, "ms-1") is True
        assert (
            "DELETE",
            f"/v1.0/groups/{GROUP_ID}/members/ms-1/$ref",
        ) in graph.calls()

    async def test_a_group_that_assigns_licenses_is_left_alone(self):
        graph = _graph(
            {"id": GROUP_ID, "assignedLicenses": [{"skuId": "x"}]},
            httpx.Response(204),
        )
        assert await graph.client().remove_from_group(GROUP_ID, "ms-1") is False
        assert not [c for c in graph.calls() if c[0] == "DELETE"]

    async def test_a_group_whose_licenses_are_not_reported_is_left_alone(self):
        graph = _graph({"id": GROUP_ID}, httpx.Response(204))
        assert await graph.client().remove_from_group(GROUP_ID, "ms-1") is False
        assert not [c for c in graph.calls() if c[0] == "DELETE"]

    async def test_not_being_in_the_group_counts_as_done(self):
        graph = _graph(
            {"id": GROUP_ID, "assignedLicenses": []},
            _error(404, "Resource does not exist", "Request_ResourceNotFound"),
        )
        assert await graph.client().remove_from_group(GROUP_ID, "ms-1") is True


async def _departed(db_session, fake, **row_fields):
    org, user_id, caller = await _member_with_account(db_session)
    if row_fields:
        row = await _row(db_session, user_id)
        for name, value in row_fields.items():
            setattr(row, name, value)
        await db_session.commit()
    with patch(f"{SERVICE}.directory_for", return_value=fake):
        await _change_status(db_session, user_id, caller, "dropped_voluntary")
    return org, user_id, caller


@pytest.mark.integration
class TestLeavingTheGroups:
    async def test_a_departure_takes_the_account_out_of_the_groups(self, db_session):
        fake = FakeDirectory()
        _, user_id, _ = await _departed(db_session, fake)
        row = await _row(db_session, user_id)

        assert fake.suspend_calls == [True]
        assert fake.left == [(GROUP, row.external_user_id or row.primary_email)]
        assert not row.pending_group_removals

    async def test_a_failed_removal_waits_without_unsettling_the_suspension(
        self, db_session
    ):
        fake = FakeDirectory()
        fake.remove_error = GoogleWorkspaceError("Google is busy.")
        org, user_id, _ = await _departed(db_session, fake)
        row = await _row(db_session, user_id)

        assert row.suspension_settled is True
        assert row.suspended_by_logbook is True
        assert row.pending_group_removals == [GROUP]

        service = DirectoryAccountService(db_session)
        items = await service.attention_items(str(org.id))
        assert [i.issue for i in items] == [AttentionIssue.GROUPS_NOT_LEFT]
        assert GROUP in (items[0].detail or "")

        fake.remove_error = None
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            assert await service.retry_group_removals() >= 1
        row = await _row(db_session, user_id)
        assert not row.pending_group_removals
        assert fake.left

    async def test_retry_on_the_profile_retries_the_removal(self, db_session):
        fake = FakeDirectory()
        fake.remove_error = GoogleWorkspaceError("Google is busy.")
        org, user_id, _ = await _departed(db_session, fake)
        row = await _row(db_session, user_id)
        row.last_attempt_at = None
        await db_session.commit()

        fake.remove_error = None
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await DirectoryAccountService(db_session).retry(user_id, str(org.id))
        row = await _row(db_session, user_id)
        assert not row.pending_group_removals

    async def test_a_return_puts_the_account_back_in_the_groups(self, db_session):
        fake = FakeDirectory()
        _, user_id, caller = await _departed(db_session, fake)
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _change_status(db_session, user_id, caller, "active")
        row = await _row(db_session, user_id)

        assert fake.suspend_calls == [True, False]
        assert (GROUP, row.primary_email) in fake.groups
        assert not row.pending_group_removals
        assert not row.pending_groups

    async def test_a_return_clears_a_removal_still_waiting(self, db_session):
        fake = FakeDirectory()
        fake.remove_error = GoogleWorkspaceError("Google is busy.")
        _, user_id, caller = await _departed(db_session, fake)
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _change_status(db_session, user_id, caller, "active")
        row = await _row(db_session, user_id)
        assert not row.pending_group_removals

    async def test_a_linked_existing_account_keeps_its_groups(self, db_session):
        fake = FakeDirectory()
        _, user_id, caller = await _departed(
            db_session, fake, status=DirectoryAccountStatus.LINKED_EXISTING.value
        )
        assert fake.suspend_calls == [True]
        assert fake.left == []
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _change_status(db_session, user_id, caller, "active")
        assert fake.groups == []

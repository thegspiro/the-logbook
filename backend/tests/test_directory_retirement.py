"""Retirement and the directory account: a department's choice.

Off (the default), a retired member keeps their account, as before. On,
retiring suspends it as a drop does, and returning lifts it. The switch
applies to members who retire while it is on; a member who retired under one
setting and returns under the other still gets back what they had.
"""

from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from sqlalchemy import select

from app.models.directory_account import GOOGLE_WORKSPACE_INTEGRATION
from app.models.directory_account_departure import has_departed, suspends_retired
from app.models.integration import Integration
from app.models.user import User, UserStatus
from app.services.directory_account_service import DirectoryAccountService
from app.services.integration_services.google_workspace_service import (
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


@pytest.mark.unit
class TestTheRule:
    def test_retirement_counts_only_when_switched_on(self):
        assert has_departed(UserStatus.RETIRED, None, suspend_retired=False) is False
        assert has_departed(UserStatus.RETIRED, None, suspend_retired=True) is True

    @pytest.mark.parametrize("on", [False, True])
    def test_the_switch_changes_nothing_else(self, on):
        assert has_departed(UserStatus.DROPPED_VOLUNTARY, None, on) is True
        assert has_departed(UserStatus.ARCHIVED, None, on) is True
        assert has_departed(UserStatus.LEAVE, None, on) is False
        assert has_departed(UserStatus.INACTIVE, None, on) is False
        assert has_departed(UserStatus.ACTIVE, None, on) is False

    def test_only_a_true_value_turns_it_on(self):
        assert suspends_retired({"suspend_on_retirement": True}) is True
        for config in ({}, None, {"suspend_on_retirement": "yes"}, "x"):
            assert suspends_retired(config) is False


async def _switch(db_session, org, on: bool) -> None:
    integration = (
        await db_session.execute(
            select(Integration).where(
                Integration.organization_id == org.id,
                Integration.integration_type == GOOGLE_WORKSPACE_INTEGRATION,
            )
        )
    ).scalar_one()
    integration.config = {**integration.config, "suspend_on_retirement": on}
    await db_session.commit()


async def _delete(db_session, user_id: str) -> None:
    """A soft delete, as the member delete endpoint makes one."""
    member = await db_session.get(User, user_id)
    member.deleted_at = datetime.now(timezone.utc)
    await db_session.commit()
    await _settle(db_session)


async def _active_member(db_session, *, switch_on: bool):
    org, user_id, caller = await _member_with_account(db_session)
    await _switch(db_session, org, switch_on)
    fake = FakeDirectory()
    with patch(f"{SERVICE}.directory_for", return_value=fake):
        # A converted applicant starts on probation, which cannot go straight
        # to retired.
        await _change_status(db_session, user_id, caller, "active")
    return org, user_id, caller, fake


@pytest.mark.integration
class TestRetiring:
    async def test_off_a_retired_member_keeps_their_account(self, db_session):
        _, user_id, caller, fake = await _active_member(db_session, switch_on=False)
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _change_status(db_session, user_id, caller, "retired")
        row = await _row(db_session, user_id)
        assert fake.suspend_calls == []
        assert row.suspension_wanted is False

    async def test_on_retiring_suspends_and_returning_lifts_it(self, db_session):
        _, user_id, caller, fake = await _active_member(db_session, switch_on=True)
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _change_status(db_session, user_id, caller, "retired")
            row = await _row(db_session, user_id)
            assert fake.suspend_calls == [True]
            assert row.suspended_by_logbook is True

            await _change_status(db_session, user_id, caller, "active")
        row = await _row(db_session, user_id)
        assert fake.suspend_calls == [True, False]
        assert row.suspension_wanted is False

    async def test_a_return_lifts_it_even_after_the_switch_is_turned_off(
        self, db_session
    ):
        org, user_id, caller, fake = await _active_member(db_session, switch_on=True)
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _change_status(db_session, user_id, caller, "retired")
            await _switch(db_session, org, False)
            await _change_status(db_session, user_id, caller, "active")
        assert fake.suspend_calls == [True, False]

    async def test_turning_it_on_does_not_reach_back(self, db_session):
        org, user_id, caller, fake = await _active_member(db_session, switch_on=False)
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _change_status(db_session, user_id, caller, "retired")
            await _switch(db_session, org, True)
        row = await _row(db_session, user_id)
        assert fake.suspend_calls == []
        assert row.suspension_wanted is False

    async def test_inactive_after_retiring_on_lifts_it(self, db_session):
        _, user_id, caller, fake = await _active_member(db_session, switch_on=True)
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _change_status(db_session, user_id, caller, "retired")
            await _change_status(db_session, user_id, caller, "inactive")
        assert fake.suspend_calls == [True, False]

    async def test_a_deletion_after_retiring_off_still_suspends(self, db_session):
        _, user_id, caller, fake = await _active_member(db_session, switch_on=False)
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _change_status(db_session, user_id, caller, "retired")
            await _delete(db_session, user_id)
        assert fake.suspend_calls == [True]

    async def test_a_deletion_after_retiring_on_is_not_a_second_suspension(
        self, db_session
    ):
        _, user_id, caller, fake = await _active_member(db_session, switch_on=True)
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _change_status(db_session, user_id, caller, "retired")
            row = await _row(db_session, user_id)
            requested = row.suspension_requested_at
            await _delete(db_session, user_id)
        row = await _row(db_session, user_id)
        assert fake.suspend_calls == [True]
        assert row.suspension_requested_at == requested

    async def test_a_failed_suspension_keeps_its_waiting_time_through_a_deletion(
        self, db_session
    ):
        # The attention list measures how long a suspension has waited from
        # suspension_requested_at; a later status change that wants the same
        # thing must not restart that clock.
        _, user_id, caller, fake = await _active_member(db_session, switch_on=True)
        fake.suspend_error = GoogleWorkspaceError("Google is busy.")
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _change_status(db_session, user_id, caller, "retired")
            row = await _row(db_session, user_id)
            assert row.suspension_settled is False
            requested = row.suspension_requested_at
            asked = len(fake.keys)
            await _delete(db_session, user_id)
        row = await _row(db_session, user_id)
        assert row.suspension_requested_at == requested
        # Nothing was re-staged, so the directory was not asked again (the
        # sweep retries it); a timestamp alone cannot show this, being stored
        # to the second.
        assert len(fake.keys) == asked


@pytest.mark.integration
class TestTheDailyCheck:
    async def test_on_a_retired_members_reenabled_account_is_suspended_again(
        self, db_session
    ):
        org, user_id, caller, fake = await _active_member(db_session, switch_on=True)
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _change_status(db_session, user_id, caller, "retired")
        row = await _row(db_session, user_id)
        fake.domain_users = [
            {
                "id": row.external_user_id or "google-id-1",
                "primaryEmail": row.primary_email,
                "suspended": False,
            }
        ]
        fake.suspended = False
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            found = await DirectoryAccountService(
                db_session
            ).check_departed_suspensions(str(org.id))
        assert found == [user_id]

    async def test_off_a_retired_member_is_not_checked(self, db_session):
        org, user_id, caller, fake = await _active_member(db_session, switch_on=True)
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            await _change_status(db_session, user_id, caller, "retired")
        await _switch(db_session, org, False)
        row = await _row(db_session, user_id)
        fake.domain_users = [
            {
                "id": row.external_user_id or "google-id-1",
                "primaryEmail": row.primary_email,
                "suspended": False,
            }
        ]
        with patch(f"{SERVICE}.directory_for", return_value=fake):
            found = await DirectoryAccountService(
                db_session
            ).check_departed_suspensions(str(org.id))
        assert found == []

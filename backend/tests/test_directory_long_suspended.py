"""Departed members' accounts still in the directory 90 days on.

A suspended account keeps its license until it is deleted or unlicensed. The
daily departure check, which lists the directory, marks each one it still
finds 90 days after its suspension; the attention list shows them (never as
overdue), the morning email names each once, and nothing is removed.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest

from app.services.directory_account_service import (
    AttentionIssue,
    DirectoryAccountService,
)
from app.services.email_service import EmailService
from app.services.google_workspace_attention_digest import (
    LAST_DIGEST_KEY,
    SETTINGS_KEY,
    send_google_workspace_attention_digest,
)
from tests.test_directory_departure_check import (
    _account,
    _check,
    _department,
    _member,
    _settled,
)
from tests.test_google_workspace_attention import _with_permissions
from tests.test_google_workspace_provisioning import FakeDirectory

NOW = datetime.now(timezone.utc)


async def _long_gone(db_session, *, days: int, account_id="g-gone"):
    org = await _department(db_session)
    gone = await _member(db_session, org, "Gone")
    row = await _settled(
        db_session, org, gone, account_id, suspended_at=NOW - timedelta(days=days)
    )
    await db_session.commit()
    return org, gone, row


def _directory_with(member, account_id="g-gone", *, suspended=True) -> FakeDirectory:
    fake = FakeDirectory()
    fake.domain_users = [_account(member, account_id, suspended=suspended)]
    return fake


@pytest.fixture
def send_email():
    mock = AsyncMock(return_value=(1, 0))
    with patch.object(EmailService, "send_email", mock):
        yield mock


@pytest.mark.integration
class TestTheDailyCheckMarksThem:
    async def test_an_account_still_there_after_90_days_is_marked(self, db_session):
        org, gone, row = await _long_gone(db_session, days=95)

        assert await _check(db_session, org, _directory_with(gone)) == []
        await db_session.refresh(row)
        assert row.long_suspended_since is not None

    async def test_one_suspended_more_recently_is_not(self, db_session):
        org, gone, row = await _long_gone(db_session, days=60)

        await _check(db_session, org, _directory_with(gone))
        await db_session.refresh(row)
        assert row.long_suspended_since is None

    async def test_it_is_marked_once(self, db_session):
        org, gone, row = await _long_gone(db_session, days=95)
        await _check(db_session, org, _directory_with(gone))
        await db_session.refresh(row)
        first = row.long_suspended_since

        await _check(db_session, org, _directory_with(gone))
        await db_session.refresh(row)
        assert row.long_suspended_since == first

    async def test_a_deleted_account_is_unmarked(self, db_session):
        org, gone, row = await _long_gone(db_session, days=95)
        await _check(db_session, org, _directory_with(gone))

        await _check(db_session, org, FakeDirectory())
        await db_session.refresh(row)
        assert row.long_suspended_since is None

    async def test_without_an_id_a_missing_address_is_not_taken_as_deleted(
        self, db_session
    ):
        org, gone, row = await _long_gone(db_session, days=95, account_id=None)
        await _check(db_session, org, _directory_with(gone, account_id="g-x"))
        await db_session.refresh(row)
        assert row.long_suspended_since is not None

        await _check(db_session, org, FakeDirectory())
        await db_session.refresh(row)
        assert row.long_suspended_since is not None

    async def test_an_account_turned_back_on_is_unmarked_and_suspended_again(
        self, db_session
    ):
        org, gone, row = await _long_gone(db_session, days=95)
        await _check(db_session, org, _directory_with(gone))

        await _check(db_session, org, _directory_with(gone, suspended=False))
        await db_session.refresh(row)
        assert row.long_suspended_since is None
        assert row.suspended_by_logbook is True


@pytest.mark.integration
class TestTheAttentionList:
    async def test_it_is_listed_but_never_overdue(self, db_session):
        org, gone, _ = await _long_gone(db_session, days=95)
        await _check(db_session, org, _directory_with(gone))

        items = await DirectoryAccountService(db_session).attention_items(str(org.id))
        assert [i.issue for i in items] == [AttentionIssue.LONG_SUSPENDED]
        assert items[0].overdue is False
        assert "Suspended 95 days ago" in (items[0].detail or "")
        assert "keeps its license" in (items[0].detail or "")


@pytest.mark.integration
class TestTheMorningEmail:
    async def test_each_is_named_once(self, db_session, send_email):
        org, gone, _ = await _long_gone(db_session, days=95)
        admin = await _with_permissions(db_session, org, "admin.access")
        await db_session.commit()
        await _check(db_session, org, _directory_with(gone))

        assert await send_google_workspace_attention_digest(db_session, org) == 1
        kwargs = send_email.await_args.kwargs
        assert kwargs["to_emails"] == [admin]
        assert "suspended for over 90 days" in kwargs["html_body"]
        assert f"/members/{gone.id}" in kwargs["html_body"]
        assert kwargs["subject"].startswith("1 Google")

    async def test_one_found_on_an_earlier_day_is_not_named_again(
        self, db_session, send_email
    ):
        org, gone, row = await _long_gone(db_session, days=95)
        await _with_permissions(db_session, org, "admin.access")
        row.long_suspended_since = NOW - timedelta(days=3)
        await db_session.commit()

        assert await send_google_workspace_attention_digest(db_session, org) == 0
        send_email.assert_not_awaited()
        assert LAST_DIGEST_KEY not in (org.settings or {}).get(SETTINGS_KEY, {})

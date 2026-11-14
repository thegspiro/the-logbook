"""A member with overdue gear is emailed once a day, however often the task runs.

`run_inventory_overdue_alerts` emailed every member holding an overdue checkout
on every run and recorded nothing. The scheduler decides a task is due from a
`last_run` held only in memory and seeded to zero, so every process start --
a deploy, a container restart, a worker taking over -- runs every task at once.
A routine deploy therefore re-sent the "Overdue Equipment" email to every member
holding overdue gear, at whatever hour it happened. The repository's other
reminder services already say so ("the scheduler runs this daily and again
whenever it restarts") and answer it with a sent-log in `NotificationLog`; this
was the member-facing sender that did not.

Fixed the same way: a successful send is recorded as an email-channel
`NotificationLog` row, and a member recorded for the organization's current
local day is not sent it again. The email goes out first and the row is written
after (CLAUDE.md pitfall #36): a crash between the two sends the reminder again,
which is a nuisance, where the other order could drop a member's only reminder.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import text

from app.services.scheduled_tasks import run_inventory_overdue_alerts

pytestmark = [pytest.mark.integration]


async def _org_and_member(db_session):
    org_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone, active) "
            "VALUES (:id, :name, 'fire_department', :slug, 'America/New_York', 1)"
        ),
        {"id": org_id, "name": "Overdue Once Dept", "slug": f"oo-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, email, "
            "password_hash, status) "
            "VALUES (:id, :org, :un, 'Pat', 'Holder', :em, 'x', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"holder-{user_id[:8]}",
            "em": f"holder-{user_id[:8]}@test.com",
        },
    )
    await db_session.flush()
    return org_id, user_id


def _checkout(user_id: str):
    return SimpleNamespace(
        user_id=user_id,
        user=SimpleNamespace(
            email=f"holder-{user_id[:8]}@test.com",
            preferred_name=None,
            first_name="Pat",
        ),
        item=SimpleNamespace(name="Radio"),
        expected_return_at=None,
    )


def _patches(org_id: str, user_id: str, send):
    async def overdue_for(org):
        return [_checkout(user_id)] if str(org) == org_id else []

    service = patch("app.services.inventory_service.InventoryService")
    email = patch("app.services.email_service.EmailService")
    return service, email, overdue_for, send


async def _run(db_session, org_id, user_id, send):
    service, email, overdue_for, _ = _patches(org_id, user_id, send)
    with service as MockSvc, email as MockEmail:
        instance = MockSvc.return_value
        instance.mark_overdue_checkouts = AsyncMock(return_value=0)
        instance.get_overdue_checkouts_for_alerts = AsyncMock(side_effect=overdue_for)
        MockEmail.return_value.send_email = send
        return await run_inventory_overdue_alerts(db_session)


@pytest.mark.asyncio
class TestOverdueAlertsOncePerDay:
    async def test_a_second_run_the_same_day_emails_nobody_again(self, db_session):
        org_id, user_id = await _org_and_member(db_session)
        send = AsyncMock(return_value=(1, 0))

        await _run(db_session, org_id, user_id, send)
        await _run(db_session, org_id, user_id, send)

        assert send.await_count == 1, (
            f"the member was emailed {send.await_count} times by two runs on one "
            "day; a restart re-runs every task, so a deploy re-sent the reminder"
        )

    async def test_the_reminder_returns_the_next_day(self, db_session):
        org_id, user_id = await _org_and_member(db_session)
        send = AsyncMock(return_value=(1, 0))
        await _run(db_session, org_id, user_id, send)

        await db_session.execute(
            text(
                "UPDATE notification_logs SET sent_at = sent_at - INTERVAL 1 DAY "
                "WHERE organization_id = :o"
            ),
            {"o": org_id},
        )
        await db_session.flush()
        await _run(db_session, org_id, user_id, send)

        assert send.await_count == 2, (
            "an overdue item is a daily reminder; recording yesterday's send "
            "must not silence today's"
        )

    async def test_a_failed_send_is_not_recorded_so_the_next_run_retries(
        self, db_session
    ):
        org_id, user_id = await _org_and_member(db_session)
        send = AsyncMock(return_value=(0, 1))
        await _run(db_session, org_id, user_id, send)

        logged = (
            await db_session.execute(
                text("SELECT COUNT(*) FROM notification_logs WHERE organization_id=:o"),
                {"o": org_id},
            )
        ).scalar()
        assert logged == 0, "a send that reached nobody must not count as sent"

        send.return_value = (1, 0)
        await _run(db_session, org_id, user_id, send)
        assert send.await_count == 2

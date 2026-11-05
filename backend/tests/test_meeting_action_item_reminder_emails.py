"""Due-date reminders for meeting-record action items go by email as well.

Owner decision 2026-11-01: ``run_action_item_reminders`` put these on the bell
only. They are now emailed too, under the "Action items from meetings and
minutes" kind a member can switch off, and a second run of the task on the
same day sends nothing (CLAUDE.md pitfall #36).

The mail itself is replaced with a recorder, so what is asserted is the
decision: who is emailed, about which item, and whether the item is marked.
"""

import uuid
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import func, select

from app.models.meeting import ActionItemStatus, Meeting, MeetingActionItem
from app.models.notification import NotificationLog
from app.models.user import Organization, User
from app.services.scheduled_tasks import run_action_item_reminders
from app.utils.org_timezone import org_today

pytestmark = pytest.mark.integration


@pytest.fixture
def mail():
    """Record every email sent, wherever the sender builds its EmailService."""
    send = AsyncMock(return_value=(1, []))
    with patch("app.services.email_service.EmailService.send_email", send):
        yield send


async def _world(db, *, days_until: int, preferences=None):
    org = Organization(name="Reminder FD", slug=f"rem-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    assignee = User(
        organization_id=org.id,
        username=f"member-{uuid.uuid4().hex[:8]}",
        email=f"member-{uuid.uuid4().hex[:8]}@example.org",
        first_name="Pat",
        last_name="Member",
        notification_preferences=preferences,
    )
    db.add(assignee)
    await db.flush()
    meeting = Meeting(
        organization_id=org.id,
        title="Monthly Business Meeting",
        meeting_date=org_today(org),
    )
    db.add(meeting)
    await db.flush()
    item = MeetingActionItem(
        meeting_id=meeting.id,
        organization_id=org.id,
        description="Inspect ladder truck",
        assigned_to=assignee.id,
        due_date=org_today(org) + timedelta(days=days_until),
        status=ActionItemStatus.OPEN.value,
    )
    db.add(item)
    await db.flush()
    # Plain values: the task commits and the test expires the session, after
    # which reading an attribute off these rows would be a lazy load.
    return SimpleNamespace(
        today=org_today(org),
        user_id=str(assignee.id),
        email=assignee.email,
        item_id=str(item.id),
    )


def _emails_to(mail, address: str) -> list:
    return [c for c in mail.await_args_list if c.kwargs.get("to_emails") == [address]]


async def _bells(db, user_id: str) -> int:
    return (
        await db.execute(
            select(func.count())
            .select_from(NotificationLog)
            .where(NotificationLog.recipient_id == user_id)
        )
    ).scalar()


async def _stamp(db, item_id: str):
    db.expire_all()
    return (
        await db.execute(
            select(MeetingActionItem.reminder_emailed_on).where(
                MeetingActionItem.id == item_id
            )
        )
    ).scalar_one()


class TestReminderEmail:
    async def test_item_due_tomorrow_is_emailed_and_marked(self, db_session, mail):
        w = await _world(db_session, days_until=1)

        await run_action_item_reminders(db_session)

        sent = _emails_to(mail, w.email)
        assert len(sent) == 1
        assert "Inspect ladder truck" in sent[0].kwargs["html_body"]
        assert "due tomorrow" in sent[0].kwargs["subject"]
        assert await _bells(db_session, w.user_id) == 1
        assert await _stamp(db_session, w.item_id) == w.today

    async def test_overdue_item_says_so(self, db_session, mail):
        w = await _world(db_session, days_until=-1)

        await run_action_item_reminders(db_session)

        sent = _emails_to(mail, w.email)
        assert len(sent) == 1
        assert "overdue" in sent[0].kwargs["subject"]

    async def test_a_day_that_is_not_a_reminder_day_sends_nothing(
        self, db_session, mail
    ):
        w = await _world(db_session, days_until=2)

        await run_action_item_reminders(db_session)

        assert _emails_to(mail, w.email) == []
        assert await _stamp(db_session, w.item_id) is None


class TestSafeToRunTwice:
    async def test_a_second_run_the_same_day_sends_no_second_email(
        self, db_session, mail
    ):
        w = await _world(db_session, days_until=3)

        await run_action_item_reminders(db_session)
        await run_action_item_reminders(db_session)

        assert len(_emails_to(mail, w.email)) == 1

    async def test_a_failed_send_is_left_unmarked_and_tried_again(
        self, db_session, mail
    ):
        w = await _world(db_session, days_until=0)
        mail.return_value = (0, [w.email])

        await run_action_item_reminders(db_session)
        assert await _stamp(db_session, w.item_id) is None

        mail.return_value = (1, [])
        await run_action_item_reminders(db_session)

        assert len(_emails_to(mail, w.email)) == 2
        assert await _stamp(db_session, w.item_id) is not None


class TestOptOut:
    async def test_a_member_who_switched_the_kind_off_gets_only_the_bell(
        self, db_session, mail
    ):
        w = await _world(
            db_session,
            days_until=1,
            preferences={"email_kinds": {"minutes_action_items": False}},
        )

        await run_action_item_reminders(db_session)

        assert _emails_to(mail, w.email) == []
        assert await _bells(db_session, w.user_id) == 1

    async def test_the_email_master_switch_also_stops_it(self, db_session, mail):
        w = await _world(
            db_session, days_until=1, preferences={"email_notifications": False}
        )

        await run_action_item_reminders(db_session)

        assert _emails_to(mail, w.email) == []

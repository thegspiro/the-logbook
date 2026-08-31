"""Tests for run_action_item_reminders
(app/services/scheduled_tasks.py::run_action_item_reminders).

``minutes_action_items`` carries no ``organization_id`` column of its own —
the task resolves it through ``item.minutes``, an unloaded relationship. An
AsyncSession does not support an implicit lazy load outside the greenlet
bridge: accessing it without eager-loading first raises
``sqlalchemy.exc.MissingGreenlet``, verified against a real
``async_session_factory()`` session before this was fixed (the failure was
otherwise invisible — it landed inside the function's own per-item
try/except, which logged it and moved on, so the task always reported
success while silently never sending a single minutes-action-item reminder).

``meeting_action_items`` carries its own ``organization_id`` and was never
affected — kept here as a control case so a regression in one path can't
hide behind the other still working.
"""

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.models.meeting import ActionItemStatus, Meeting, MeetingActionItem
from app.models.minute import ActionItem, MeetingMinutes, MinutesActionItemStatus
from app.models.notification import NotificationLog
from app.models.user import Organization, User
from app.services.scheduled_tasks import run_action_item_reminders

pytestmark = pytest.mark.integration


async def _make_org(db):
    org = Organization(name="AI Reminders FD", slug=f"air-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _make_user(db, org):
    user = User(
        organization_id=org.id,
        username=f"member-{uuid.uuid4().hex[:8]}",
        email=f"member-{uuid.uuid4().hex[:8]}@example.org",
        first_name="Member",
        last_name="One",
    )
    db.add(user)
    await db.flush()
    return user


async def _notification_count(db, recipient_id: str) -> int:
    return (
        await db.execute(
            select(func.count())
            .select_from(NotificationLog)
            .where(NotificationLog.recipient_id == recipient_id)
        )
    ).scalar()


class TestMinutesActionItemReminder:
    async def test_due_minutes_action_item_sends_a_reminder(self, db_session):
        org = await _make_org(db_session)
        assignee = await _make_user(db_session, org)
        minutes = MeetingMinutes(
            organization_id=org.id,
            title="Monthly Business Meeting",
            meeting_date=datetime.now(timezone.utc),
        )
        db_session.add(minutes)
        await db_session.flush()

        due_date = datetime.combine(
            date.today() + timedelta(days=1),
            datetime.min.time(),
            tzinfo=timezone.utc,
        )
        item = ActionItem(
            minutes_id=minutes.id,
            description="Order new hose",
            assignee_id=assignee.id,
            due_date=due_date,
            status=MinutesActionItemStatus.PENDING.value,
        )
        db_session.add(item)
        await db_session.flush()

        # A many-to-one lazy load resolves straight from the identity map
        # with no IO at all when the related row is already resident in the
        # *same* session — which it would be here, since this test just
        # inserted it. That masks the real bug: production calls this task
        # with a session that has never touched MeetingMinutes before, so
        # item.minutes there requires a genuine query. Expunge both objects
        # so this test exercises that same code path instead of silently
        # skipping it — reverting the fix's selectinload() and running
        # without this expunge() still passes; with it, it reproduces
        # MissingGreenlet exactly as production would.
        db_session.expunge(minutes)
        db_session.expunge(item)

        result = await run_action_item_reminders(db_session)

        assert result["total_reminders"] >= 1
        assert await _notification_count(db_session, assignee.id) == 1


class TestMeetingActionItemReminder:
    """Control case: this path carries its own organization_id and never
    needed a relationship traversal to resolve it."""

    async def test_due_meeting_action_item_sends_a_reminder(self, db_session):
        org = await _make_org(db_session)
        assignee = await _make_user(db_session, org)
        meeting = Meeting(
            organization_id=org.id,
            title="Monthly Business Meeting",
            meeting_date=date.today(),
        )
        db_session.add(meeting)
        await db_session.flush()

        item = MeetingActionItem(
            meeting_id=meeting.id,
            organization_id=org.id,
            description="Inspect ladder truck",
            assigned_to=assignee.id,
            due_date=date.today() + timedelta(days=1),
            status=ActionItemStatus.OPEN.value,
        )
        db_session.add(item)
        await db_session.flush()

        result = await run_action_item_reminders(db_session)

        assert result["total_reminders"] >= 1
        assert await _notification_count(db_session, assignee.id) == 1

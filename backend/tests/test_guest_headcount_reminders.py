"""The morning-after reminder to record an outreach event's guest headcount.

An outreach event that ended with no headcount leaves the Community Engagement
report on the requester's estimate, or on nothing. These tests pin who is
reminded, that it happens once, and every event that must be left alone,
against real rows.
"""

import json
from datetime import datetime, time, timedelta, timezone
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from sqlalchemy import select, text

from app.models.email_template import EmailTemplate, EmailTemplateType
from app.models.event import Event, EventType
from app.models.notification import NotificationLog
from app.models.user import Organization, Position, user_roles
from app.services.email_service import EmailService
from app.services.event_service import EventService
from app.services.guest_headcount_reminder_service import (
    LOOKBACK_DAYS,
    NOTIFICATION_CATEGORY,
    REMINDER_MARKER,
    GuestHeadcountReminderService,
)
from app.utils.org_timezone import org_today, scheduling_timezone

pytestmark = pytest.mark.integration

TZ = "America/New_York"
OFF = {"email_kinds": {"event_duties": False}}


async def _member_by_rank(db_session, org, rank):
    """A member who holds *rank* and no position of their own — their only
    source of ``events.manage`` is the rank's default permissions
    (``OPERATIONAL_RANKS``), not a position row."""
    user_id = str(uuid4())
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status, `rank`) "
            "VALUES (:id, :org, :un, 'Pat', 'Chief', :em, 'hashed', 'active', :rank)"
        ),
        {
            "id": user_id,
            "org": str(org.id),
            "un": f"m-{user_id[:8]}",
            "em": f"m-{user_id[:8]}@example.org",
            "rank": rank,
        },
    )
    await db_session.flush()
    return user_id


async def _member(db_session, org, *permissions, preferences=None):
    position = Position(
        organization_id=org.id,
        name=f"Holder {uuid4().hex[:6]}",
        slug=f"holder-{uuid4().hex[:8]}",
        permissions=list(permissions),
    )
    db_session.add(position)
    await db_session.flush()
    user_id = str(uuid4())
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status, notification_preferences) "
            "VALUES (:id, :org, :un, 'Pat', 'Member', :em, 'hashed', 'active', "
            ":prefs)"
        ),
        {
            "id": user_id,
            "org": str(org.id),
            "un": f"m-{user_id[:8]}",
            "em": f"m-{user_id[:8]}@example.org",
            "prefs": json.dumps(preferences) if preferences else None,
        },
    )
    await db_session.execute(
        user_roles.insert().values(user_id=user_id, position_id=position.id)
    )
    await db_session.flush()
    return user_id


async def _org(db_session, label="Reach"):
    org = Organization(
        name=f"{label} FD", slug=f"{label.lower()}-{uuid4().hex[:8]}", timezone=TZ
    )
    db_session.add(org)
    await db_session.flush()
    return org


@pytest.fixture
async def org(db_session):
    return await _org(db_session)


@pytest.fixture
def send_email():
    mock = AsyncMock(return_value=(1, 0))
    # One patch, entered once, outside any concurrent section (pitfall #22).
    with patch.object(EmailService, "send_email", mock):
        yield mock


def _start_of_today(org) -> datetime:
    return datetime.combine(
        org_today(org), time.min, tzinfo=scheduling_timezone(org)
    ).astimezone(timezone.utc)


async def _event(db_session, org, *, ended_before_today=timedelta(hours=3), **kw):
    """An outreach event that ended *ended_before_today* before local midnight."""
    end = _start_of_today(org) - ended_before_today
    event = Event(
        organization_id=org.id,
        title=kw.pop("title", "Station 2 Open House"),
        event_type=kw.pop("event_type", EventType.PUBLIC_EDUCATION),
        start_datetime=end - timedelta(hours=2),
        end_datetime=end,
        **kw,
    )
    db_session.add(event)
    await db_session.flush()
    return event


async def _run(db_session, org):
    return await GuestHeadcountReminderService(db_session).send_reminders(org)


async def _bells(db_session, event):
    rows = (
        (
            await db_session.execute(
                select(NotificationLog).where(
                    NotificationLog.category == NOTIFICATION_CATEGORY,
                    NotificationLog.action_url == f"/events/{event.id}",
                )
            )
        )
        .scalars()
        .all()
    )
    return {str(r.recipient_id) for r in rows}


def _emailed(send_email):
    return [c.kwargs["to_emails"][0] for c in send_email.await_args_list]


class TestWhoIsReminded:
    async def test_the_organizer_who_can_record_it_is_emailed_and_notified(
        self, db_session, org, send_email
    ):
        organizer = await _member(db_session, org, "events.manage")
        event = await _event(db_session, org, organizer_id=organizer)

        counts = await _run(db_session, org)

        assert (counts.events, counts.emails, counts.notifications) == (1, 1, 1)
        call = send_email.await_args.kwargs
        assert call["to_emails"] == [f"m-{organizer[:8]}@example.org"]
        assert call["template_type"] == "guest_headcount_reminder"
        assert call["subject"] == "How many people came to Station 2 Open House?"
        assert f"/events/{event.id}" in call["html_body"]
        assert await _bells(db_session, event) == {organizer}
        assert event.custom_fields[REMINDER_MARKER] is True

    async def test_an_organizer_whose_events_manage_comes_only_from_rank_is_reminded(
        self, db_session, org, send_email
    ):
        """Eligibility must resolve the same way ``require_permission`` does
        (CLAUDE.md #29). A fire chief holds ``events.manage`` through the
        rank's own defaults, with no position of their own granting it —
        exactly the gap ``_collect_user_permissions`` checks a user's rank for
        in addition to their positions."""
        organizer = await _member_by_rank(db_session, org, "fire_chief")
        event = await _event(db_session, org, organizer_id=organizer)

        counts = await _run(db_session, org)

        assert (counts.events, counts.emails, counts.notifications) == (1, 1, 1)
        assert await _bells(db_session, event) == {organizer}

    async def test_organizer_and_alternate_are_both_reminded(
        self, db_session, org, send_email
    ):
        organizer = await _member(db_session, org, "events.manage")
        alternate = await _member(db_session, org, "events.*")
        event = await _event(
            db_session, org, organizer_id=organizer, alternate_organizer_id=alternate
        )

        await _run(db_session, org)

        assert await _bells(db_session, event) == {organizer, alternate}
        assert send_email.await_count == 2

    async def test_an_organizer_who_cannot_record_it_hands_it_to_the_creator(
        self, db_session, org, send_email
    ):
        organizer = await _member(db_session, org, "events.view")
        creator = await _member(db_session, org, "events.manage")
        event = await _event(
            db_session, org, organizer_id=organizer, created_by=creator
        )

        await _run(db_session, org)

        assert await _bells(db_session, event) == {creator}
        assert _emailed(send_email) == [f"m-{creator[:8]}@example.org"]

    async def test_the_creator_is_not_asked_when_an_organizer_can_record_it(
        self, db_session, org, send_email
    ):
        organizer = await _member(db_session, org, "events.manage")
        creator = await _member(db_session, org, "events.manage")
        event = await _event(
            db_session, org, organizer_id=organizer, created_by=creator
        )

        await _run(db_session, org)

        assert await _bells(db_session, event) == {organizer}

    async def test_nobody_who_can_record_it_means_nobody_is_reminded(
        self, db_session, org, send_email
    ):
        organizer = await _member(db_session, org, "events.view")
        creator = await _member(db_session, org)
        event = await _event(
            db_session, org, organizer_id=organizer, created_by=creator
        )

        counts = await _run(db_session, org)

        assert (counts.events, counts.emails, counts.notifications) == (0, 0, 0)
        send_email.assert_not_awaited()
        assert await _bells(db_session, event) == set()
        # Marked, so later runs stop looking at it.
        assert event.custom_fields[REMINDER_MARKER] is True


class TestOnce:
    async def test_a_second_run_sends_nothing(self, db_session, org, send_email):
        organizer = await _member(db_session, org, "events.manage")
        event = await _event(db_session, org, organizer_id=organizer)

        await _run(db_session, org)
        again = await _run(db_session, org)

        assert (again.events, again.emails, again.notifications) == (0, 0, 0)
        assert send_email.await_count == 1
        assert await _bells(db_session, event) == {organizer}

    async def test_postponing_lets_the_moved_event_be_reminded_again(
        self, db_session, org
    ):
        organizer = await _member(db_session, org, "events.manage")
        start = datetime.now(timezone.utc) + timedelta(hours=1)
        event = Event(
            organization_id=org.id,
            title="Block party",
            event_type=EventType.PUBLIC_EDUCATION,
            start_datetime=start,
            end_datetime=start + timedelta(hours=2),
            organizer_id=organizer,
            custom_fields={REMINDER_MARKER: True, "keep_me": "yes"},
        )
        db_session.add(event)
        await db_session.commit()

        with patch.object(EventService, "_notify_postponement", AsyncMock()):
            moved = await EventService(db_session).postpone_event(
                event.id,
                org.id,
                start + timedelta(days=7),
                start + timedelta(days=7, hours=2),
                "Rain",
                postponed_by=organizer,
            )

        assert moved.custom_fields == {"keep_me": "yes"}


class TestLeftAlone:
    async def test_an_event_with_a_headcount(self, db_session, org, send_email):
        organizer = await _member(db_session, org, "events.manage")
        await _event(db_session, org, organizer_id=organizer, guest_headcount=140)

        counts = await _run(db_session, org)

        assert counts.notifications == 0
        send_email.assert_not_awaited()

    async def test_an_event_that_ended_earlier_today(self, db_session, org, send_email):
        organizer = await _member(db_session, org, "events.manage")
        event = await _event(
            db_session,
            org,
            organizer_id=organizer,
            ended_before_today=-timedelta(minutes=1),
        )

        await _run(db_session, org)

        send_email.assert_not_awaited()
        assert REMINDER_MARKER not in (event.custom_fields or {})

    async def test_an_event_older_than_the_lookback(self, db_session, org, send_email):
        organizer = await _member(db_session, org, "events.manage")
        await _event(
            db_session,
            org,
            organizer_id=organizer,
            ended_before_today=timedelta(days=LOOKBACK_DAYS, hours=1),
        )

        await _run(db_session, org)

        send_email.assert_not_awaited()

    async def test_an_event_at_the_edge_of_the_lookback_is_still_reminded(
        self, db_session, org, send_email
    ):
        organizer = await _member(db_session, org, "events.manage")
        await _event(
            db_session,
            org,
            organizer_id=organizer,
            ended_before_today=timedelta(days=LOOKBACK_DAYS) - timedelta(hours=1),
        )

        await _run(db_session, org)

        assert send_email.await_count == 1

    async def test_an_event_that_is_not_outreach(self, db_session, org, send_email):
        organizer = await _member(db_session, org, "events.manage")
        await _event(
            db_session,
            org,
            organizer_id=organizer,
            event_type=EventType.BUSINESS_MEETING,
        )

        await _run(db_session, org)

        send_email.assert_not_awaited()

    async def test_a_cancelled_event(self, db_session, org, send_email):
        organizer = await _member(db_session, org, "events.manage")
        await _event(db_session, org, organizer_id=organizer, is_cancelled=True)

        await _run(db_session, org)

        send_email.assert_not_awaited()

    async def test_another_departments_event(self, db_session, org, send_email):
        other = await _org(db_session, "Other")
        organizer = await _member(db_session, other, "events.manage")
        event = await _event(db_session, other, organizer_id=organizer)

        await _run(db_session, org)

        send_email.assert_not_awaited()
        assert REMINDER_MARKER not in (event.custom_fields or {})


class TestEmailSwitches:
    async def test_a_member_who_opted_out_still_gets_the_bell(
        self, db_session, org, send_email
    ):
        organizer = await _member(db_session, org, "events.manage", preferences=OFF)
        event = await _event(db_session, org, organizer_id=organizer)

        counts = await _run(db_session, org)

        send_email.assert_not_awaited()
        assert (counts.emails, counts.notifications) == (0, 1)
        assert await _bells(db_session, event) == {organizer}

    async def test_a_department_that_switched_the_template_off_sends_no_email(
        self, db_session, org, send_email
    ):
        organizer = await _member(db_session, org, "events.manage")
        event = await _event(db_session, org, organizer_id=organizer)
        db_session.add(
            EmailTemplate(
                organization_id=org.id,
                template_type=EmailTemplateType.GUEST_HEADCOUNT_REMINDER,
                name="Guest Headcount Reminder",
                subject="x",
                html_body="x",
                is_active=False,
            )
        )
        await db_session.flush()

        await _run(db_session, org)

        send_email.assert_not_awaited()
        assert await _bells(db_session, event) == {organizer}

    async def test_a_failed_send_does_not_stop_the_next_recipient(
        self, db_session, org
    ):
        organizer = await _member(db_session, org, "events.manage")
        alternate = await _member(db_session, org, "events.manage")
        await _event(
            db_session, org, organizer_id=organizer, alternate_organizer_id=alternate
        )
        mock = AsyncMock(side_effect=[RuntimeError("SMTP down"), (1, 0)])

        with patch.object(EmailService, "send_email", mock):
            counts = await _run(db_session, org)

        assert mock.await_count == 2
        assert (counts.emails, counts.notifications) == (1, 2)

"""Events (app-review B17 pass 6).

- "Send reminders" sends them, by notice and email.
- Removing a party from a full event promotes as many waitlisted parties as
  now fit.
- A recurring series cannot end before it starts.
- A monthly series on the 31st keeps returning to month end when the nightly
  task extends it; a "5th weekday" series skips every month without one;
  skipped dates do not count against the occurrence cap; a rolling series can
  start on Feb 29, and a daily rolling series fits the cap.
- The event-reminder task reminds current members only, once per run.
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from zoneinfo import ZoneInfo

import pytest
from pydantic import ValidationError
from sqlalchemy import func, select, text

from app.models.event import Event, EventRSVP, RecurrencePattern, RSVPStatus
from app.models.notification import NotificationLog
from app.schemas.event import RecurringEventCreate, RSVPCreate
from app.services.event_service import EventService


def _uid():
    return str(uuid.uuid4())


async def _org(db, tz="UTC"):
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Pass6 Events', 'fire_department', :slug, :tz)"
        ),
        {"id": org_id, "slug": f"ev6-{org_id[:8]}", "tz": tz},
    )
    return org_id


async def _user(db, org_id, status="active"):
    uid = _uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) VALUES "
            "(:id, :org, :un, 'P', 'Q', :em, 'h', :st)"
        ),
        {
            "id": uid,
            "org": org_id,
            "un": f"u{uid[:8]}",
            "em": f"{uid[:8]}@ev6.example",
            "st": status,
        },
    )
    return uid


async def _event(db, org_id, *, cap=None):
    start = datetime.now(timezone.utc) + timedelta(days=3)
    event = Event(
        organization_id=org_id,
        title="Pass6 event",
        event_type="other",
        start_datetime=start,
        end_datetime=start + timedelta(hours=2),
        max_attendees=cap,
        allow_guests=True,
        is_draft=False,
    )
    db.add(event)
    await db.flush()
    return event


@pytest.mark.integration
class TestSendReminders:
    async def test_the_button_sends_notices(self, db_session):
        from app.api.v1.endpoints.events import (
            SendRemindersRequest,
            send_event_reminders,
        )

        org = await _org(db_session)
        officer = await _user(db_session, org)
        for _ in range(3):
            await _user(db_session, org)
        event = await _event(db_session, org)
        caller = SimpleNamespace(id=officer, organization_id=org, username="officer")

        with patch(
            "app.services.event_service.EventService._email_event_notification",
            new=AsyncMock(return_value=4),
        ) as email:
            response = await send_event_reminders(
                uuid.UUID(event.id),
                SendRemindersRequest(reminder_type="all"),
                db_session,
                caller,
            )

        notices = (
            await db_session.execute(
                select(func.count())
                .select_from(NotificationLog)
                .where(NotificationLog.organization_id == org)
            )
        ).scalar_one()
        assert response.sent_count == 4
        assert notices == 4
        email.assert_awaited_once()


@pytest.mark.integration
class TestRemovingAPartyPromotesEveryoneWhoFits:
    async def test_four_seats_freed_promote_three_solo_members(self, db_session):
        org = await _org(db_session)
        event = await _event(db_session, org, cap=4)
        service = EventService(db_session)
        party = await _user(db_session, org)
        rsvp, error = await service.create_or_update_rsvp(
            event.id, party, RSVPCreate(status="going", guest_count=3), org
        )
        assert error is None
        assert rsvp.status == RSVPStatus.GOING
        for _ in range(3):
            member = await _user(db_session, org)
            await service.create_or_update_rsvp(
                event.id, member, RSVPCreate(status="going"), org
            )

        error = await service.remove_attendee(
            uuid.UUID(event.id), uuid.UUID(party), org
        )

        assert error is None
        statuses = (
            (
                await db_session.execute(
                    select(EventRSVP.status).where(EventRSVP.event_id == event.id)
                )
            )
            .scalars()
            .all()
        )
        assert sorted(s.value for s in statuses) == ["going", "going", "going"]


@pytest.mark.unit
class TestRecurringSchema:
    def test_an_end_before_the_start_is_refused(self):
        start = datetime(2027, 1, 5, 19, 0, tzinfo=timezone.utc)
        with pytest.raises(ValidationError, match="end_datetime must be after"):
            RecurringEventCreate(
                title="Drill",
                start_datetime=start,
                end_datetime=start - timedelta(hours=2),
                recurrence_pattern="weekly",
                recurrence_end_date=start + timedelta(weeks=3),
            )


@pytest.mark.unit
class TestRecurrenceDates:
    def test_a_fifth_weekday_series_skips_every_month_without_one(self):
        tz = ZoneInfo("America/New_York")
        # Monday 2027-03-29 is the 5th Monday of March, 7pm EDT.
        start = datetime(2027, 3, 29, 23, 0, tzinfo=timezone.utc)

        occurrences = EventService(None)._generate_recurrence_dates(
            start_datetime=start,
            end_datetime=start + timedelta(hours=2),
            pattern="monthly_weekday",
            recurrence_end_date=datetime(2028, 3, 1, tzinfo=timezone.utc),
            weekday=0,
            week_ordinal=5,
            timezone_=tz,
        )

        assert [s.astimezone(tz).date().isoformat() for s, _ in occurrences] == [
            "2027-03-29",
            "2027-05-31",
            "2027-08-30",
            "2027-11-29",
            "2028-01-31",
        ]

    def test_skipped_dates_do_not_count_against_the_cap(self):
        start = datetime(2027, 1, 1, 19, 0)
        skipped = [
            (datetime(2027, 1, 1) + timedelta(days=i)).strftime("%Y-%m-%d")
            for i in range(1, 6)
        ]

        occurrences = EventService(None)._generate_recurrence_dates(
            start_datetime=start,
            end_datetime=start + timedelta(hours=1),
            pattern="daily",
            recurrence_end_date=datetime(2028, 12, 31, 23, 0),
            exceptions=skipped,
        )

        # Over the cap, so the caller refuses the series rather than storing
        # one that silently ends a year before its stated end date.
        assert len(occurrences) > 365
        assert not any(s.strftime("%Y-%m-%d") in skipped for s, _ in occurrences)

    def test_an_extension_returns_to_the_series_day(self):
        start = datetime(2027, 2, 28, 19, 0)

        occurrences = EventService(None)._generate_recurrence_dates(
            start_datetime=start,
            end_datetime=start + timedelta(hours=1),
            pattern="monthly",
            recurrence_end_date=datetime(2027, 5, 31, 23, 0),
            anchor_day=31,
        )

        assert [s.date().isoformat() for s, _ in occurrences] == [
            "2027-02-28",
            "2027-03-31",
            "2027-04-30",
            "2027-05-31",
        ]


@pytest.mark.integration
class TestRollingSeries:
    async def _create(self, db, start, pattern):
        org = await _org(db)
        user = await _user(db, org)
        data = RecurringEventCreate(
            title="Rolling",
            start_datetime=start,
            end_datetime=start + timedelta(hours=1),
            recurrence_pattern=pattern,
            rolling_recurrence=True,
        ).model_dump(exclude_unset=True)
        return await EventService(db).create_recurring_event(data, org, user)

    async def test_one_can_start_on_feb_29(self, db_session):
        events, error = await self._create(
            db_session, datetime(2028, 2, 29, 19, 0, tzinfo=timezone.utc), "weekly"
        )

        assert error is None
        assert len(events) == 53  # weeks 0 to 52, the last on day 364

    async def test_a_daily_one_fits_the_cap(self, db_session):
        events, error = await self._create(
            db_session, datetime(2027, 3, 1, 19, 0, tzinfo=timezone.utc), "daily"
        )

        assert error is None
        assert len(events) == 365

    async def test_the_nightly_extension_keeps_a_31st_series_at_month_end(
        self, db_session
    ):
        from app.services.scheduled_tasks import run_rolling_recurrence_extend

        org = await _org(db_session)
        user = await _user(db_session, org)
        year = datetime.now(timezone.utc).year + 1
        first = datetime(year, 1, 31, 19, 0, tzinfo=timezone.utc)
        parent = Event(
            organization_id=org,
            created_by=user,
            title="Month end",
            event_type="other",
            start_datetime=first,
            end_datetime=first + timedelta(hours=1),
            is_recurring=True,
            recurrence_pattern=RecurrencePattern.MONTHLY,
            rolling_recurrence=True,
            recurrence_end_date=first,
            is_draft=False,
        )
        db_session.add(parent)
        await db_session.flush()
        clamped = datetime(year, 2, 28, 19, 0, tzinfo=timezone.utc)
        db_session.add(
            Event(
                organization_id=org,
                created_by=user,
                title="Month end",
                event_type="other",
                start_datetime=clamped,
                end_datetime=clamped + timedelta(hours=1),
                is_recurring=True,
                recurrence_pattern=RecurrencePattern.MONTHLY,
                recurrence_parent_id=parent.id,
                is_draft=False,
            )
        )
        await db_session.commit()

        await run_rolling_recurrence_extend(db_session)

        days = (
            (
                await db_session.execute(
                    select(Event.start_datetime)
                    .where(
                        (Event.id == parent.id)
                        | (Event.recurrence_parent_id == parent.id)
                    )
                    .order_by(Event.start_datetime)
                )
            )
            .scalars()
            .all()
        )
        assert [d.date().isoformat() for d in days[:5]] == [
            f"{year}-01-31",
            f"{year}-02-28",
            f"{year}-03-31",
            f"{year}-04-30",
            f"{year}-05-31",
        ]


@pytest.mark.integration
class TestReminderTask:
    async def test_reminds_current_members_once(self, db_session):
        from app.services.scheduled_tasks import run_event_reminders

        org = await _org(db_session)
        current = await _user(db_session, org)
        departed = await _user(db_session, org, status="dropped_voluntary")
        start = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=1)
        event = Event(
            organization_id=org,
            title="Soon",
            event_type="other",
            start_datetime=start,
            end_datetime=start + timedelta(hours=1),
            is_draft=False,
            send_reminders=True,
            reminder_target="going",
            reminder_schedule=[168, 24, 2],
        )
        db_session.add(event)
        await db_session.flush()
        for member in (current, departed):
            db_session.add(
                EventRSVP(
                    organization_id=org,
                    event_id=event.id,
                    user_id=member,
                    status=RSVPStatus.GOING,
                    guest_count=0,
                )
            )
        await db_session.commit()

        with patch(
            "app.services.email_service.EmailService.send_event_reminder",
            new=AsyncMock(return_value=True),
        ) as email:
            await run_event_reminders(db_session)

        recipients = (
            (
                await db_session.execute(
                    select(NotificationLog.recipient_id).where(
                        NotificationLog.organization_id == org,
                        NotificationLog.category == "event_reminder",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert recipients == [current]
        assert email.await_count == 1

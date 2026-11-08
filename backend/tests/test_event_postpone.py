"""Postponing an event (workflow review W80-11).

An edit of the schedule keeps an event's attendance; a postponement says the
event did not happen at its old time. So it clears every check-in and
correction — member and guest — removes the credit they produced, resets the
reminder markers, keeps the RSVPs, records when and from what start, and tells
the members who meant to come. Delivered twice, it acts once (pitfall #36).
"""

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import (
    AttendancePetitionStatus,
    Event,
    EventAttendancePetition,
    EventExternalAttendee,
    EventRSVP,
)
from app.schemas.event import EventCreate, RSVPOverride
from app.services.event_service import EventService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


def _utc(value):
    return EventService._as_utc(value)


async def _insert_org(db: AsyncSession) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Test Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"org-{org_id[:8]}"},
    )
    return org_id


async def _insert_user(db: AsyncSession, org_id: str, first: str) -> str:
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, 'Tester', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"{first.lower()}-{user_id[:8]}",
            "fn": first,
            "em": f"{first.lower()}-{user_id[:8]}@test.com",
        },
    )
    return user_id


@pytest.fixture
async def dept(db_session: AsyncSession):
    org = await _insert_org(db_session)
    officer = await _insert_user(db_session, org, "Officer")
    present = await _insert_user(db_session, org, "Pat")
    expected = await _insert_user(db_session, org, "Sam")
    await db_session.flush()
    return org, officer, present, expected


def _whole_minute(value: datetime) -> datetime:
    return value.replace(second=0, microsecond=0)


async def _event(db, org, officer, start, end, title="Ladder Drill"):
    event = await EventService(db).create_event(
        EventCreate(
            title=title,
            event_type="training",
            start_datetime=start,
            end_datetime=end,
            requires_rsvp=False,
        ),
        organization_id=org,
        created_by=officer,
    )
    return str(event.id)


async def _live_drill_with_attendance(db, dept):
    """A drill under way: one member checked in with corrected times, one
    expected, one guest checked in, and a reminder already sent."""
    org, officer, present, expected = dept
    start = _whole_minute(datetime.now(timezone.utc) - timedelta(minutes=30))
    end = start + timedelta(hours=2)
    event_id = await _event(db, org, officer, start, end)
    service = EventService(db)
    _, error = await service.manager_add_attendee(
        event_id, present, org, officer, checked_in=True
    )
    assert error is None
    _, error = await service.override_rsvp_attendance(
        event_id,
        present,
        org,
        officer,
        RSVPOverride(override_check_in_at=start, override_check_out_at=end),
    )
    assert error is None
    _, error = await service.manager_add_attendee(
        event_id, expected, org, officer, checked_in=False
    )
    assert error is None
    db.add(
        EventExternalAttendee(
            organization_id=org,
            event_id=event_id,
            name="Visiting Instructor",
            checked_in=True,
            checked_in_at=start,
        )
    )
    event = (await db.execute(select(Event).where(Event.id == event_id))).scalar_one()
    event.custom_fields = {"reminders_sent": [24, 1], "keep_me": "yes"}
    await db.commit()
    return event_id, start, end


def _next_week(start: datetime, end: datetime):
    return start + timedelta(days=7), end + timedelta(days=7)


class TestPostponing:
    async def test_starts_attendance_afresh_and_keeps_who_meant_to_come(
        self, db_session, dept
    ):
        org, officer, present, expected = dept
        event_id, start, end = await _live_drill_with_attendance(db_session, dept)
        new_start, new_end = _next_week(start, end)

        with patch.object(EventService, "_notify_postponement", AsyncMock()) as notify:
            event = await EventService(db_session).postpone_event(
                event_id,
                org,
                new_start,
                new_end,
                "Ladder truck out of service",
                postponed_by=officer,
            )

        assert _utc(event.start_datetime) == new_start
        assert _utc(event.end_datetime) == new_end
        assert _utc(event.postponed_from_start) == start
        assert event.postponed_at is not None
        assert event.postponement_reason == "Ladder truck out of service"
        assert event.custom_fields == {"keep_me": "yes"}

        db_session.expire_all()
        rsvps = (
            (
                await db_session.execute(
                    select(EventRSVP).where(EventRSVP.event_id == event_id)
                )
            )
            .scalars()
            .all()
        )
        assert {r.user_id: r.status.value for r in rsvps} == {
            present: "going",
            expected: "going",
        }
        for rsvp in rsvps:
            assert (
                rsvp.checked_in,
                rsvp.checked_in_at,
                rsvp.checked_out_at,
                rsvp.attendance_duration_minutes,
                rsvp.override_check_in_at,
                rsvp.override_check_out_at,
                rsvp.override_duration_minutes,
                rsvp.overridden_by,
            ) == (False, None, None, None, None, None, None, None)
        guest = (
            await db_session.execute(
                select(EventExternalAttendee).where(
                    EventExternalAttendee.event_id == event_id
                )
            )
        ).scalar_one()
        assert (guest.checked_in, guest.checked_in_at) == (False, None)

        notify.assert_awaited_once()
        _, user_ids, _, old_start, reason = notify.await_args.args
        assert sorted(user_ids) == sorted([present, expected])
        assert _utc(old_start) == start
        assert reason == "Ladder truck out of service"

    async def test_the_same_postponement_twice_acts_once(self, db_session, dept):
        org, officer, _, _ = dept
        event_id, start, end = await _live_drill_with_attendance(db_session, dept)
        new_start, new_end = _next_week(start, end)
        service = EventService(db_session)

        with patch.object(EventService, "_notify_postponement", AsyncMock()) as notify:
            first = await service.postpone_event(
                event_id, org, new_start, new_end, "Ladder truck out of service"
            )
            stamped = first.postponed_at
            second = await service.postpone_event(
                event_id, org, new_start, new_end, "Ladder truck out of service"
            )

        assert notify.await_count == 1
        assert second.postponed_at == stamped

    async def test_a_second_move_remembers_the_original_start(self, db_session, dept):
        org, _, _, _ = dept
        event_id, start, end = await _live_drill_with_attendance(db_session, dept)
        service = EventService(db_session)

        with patch.object(EventService, "_notify_postponement", AsyncMock()):
            await service.postpone_event(
                event_id, org, *_next_week(start, end), "Ladder truck out of service"
            )
            event = await service.postpone_event(
                event_id,
                org,
                start + timedelta(days=14),
                end + timedelta(days=14),
                "Still out of service",
            )

        assert _utc(event.postponed_from_start) == start
        assert event.postponement_reason == "Still out of service"

    async def test_credit_a_reopened_event_wrote_is_voided(self, db_session, dept):
        """Reopened after finalize, then postponed rather than re-finalized:
        the completed record must not stand for a drill that did not happen."""
        org, officer, present, _ = dept
        start = _whole_minute(datetime.now(timezone.utc) - timedelta(hours=6))
        end = start + timedelta(hours=2)
        event_id = await _event(db_session, org, officer, start, end)
        service = EventService(db_session)
        await service.manager_add_attendee(
            event_id, present, org, officer, checked_in=False
        )
        await service.override_rsvp_attendance(
            event_id,
            present,
            org,
            officer,
            RSVPOverride(override_check_in_at=start, override_check_out_at=end),
        )
        outcome = await service.finalize_event_attendance_detailed(
            event_id, org, finalized_by=officer
        )
        assert outcome.training_records_completed == 1
        _, error = await service.reopen_event_attendance(event_id, org)
        assert error is None

        future = _whole_minute(datetime.now(timezone.utc) + timedelta(days=3))
        with patch.object(EventService, "_notify_postponement", AsyncMock()):
            await service.postpone_event(
                event_id, org, future, future + timedelta(hours=2), "Rained out"
            )

        rows = await db_session.execute(
            text(
                "SELECT status, hours_completed FROM training_records "
                "WHERE user_id = :u"
            ),
            {"u": present},
        )
        assert [(r.status, r.hours_completed) for r in rows] == [("cancelled", 0)]


class TestRefusals:
    async def _future(self):
        start = _whole_minute(datetime.now(timezone.utc) + timedelta(days=2))
        return start, start + timedelta(hours=2)

    async def test_a_finalized_event_is_refused_as_locked(self, db_session, dept):
        org, officer, present, _ = dept
        start = _whole_minute(datetime.now(timezone.utc) - timedelta(hours=6))
        event_id = await _event(
            db_session, org, officer, start, start + timedelta(hours=2)
        )
        service = EventService(db_session)
        await service.finalize_event_attendance_detailed(event_id, org, officer)

        with pytest.raises(ValueError, match="postponing the event"):
            await service.postpone_event(event_id, org, *await self._future(), "x" * 10)

    async def test_a_cancelled_event_is_refused(self, db_session, dept):
        org, officer, _, _ = dept
        start, end = await self._future()
        event_id = await _event(db_session, org, officer, start, end)
        service = EventService(db_session)
        await service.cancel_event(event_id, org, "Called off for weather")

        with pytest.raises(ValueError, match="cancelled event cannot be postponed"):
            await service.postpone_event(
                event_id,
                org,
                start + timedelta(days=1),
                end + timedelta(days=1),
                "x" * 10,
            )

    async def test_a_new_start_in_the_past_is_refused(self, db_session, dept):
        org, officer, _, _ = dept
        start, end = await self._future()
        event_id = await _event(db_session, org, officer, start, end)
        past = _whole_minute(datetime.now(timezone.utc) - timedelta(days=1))

        with pytest.raises(ValueError, match="must start in the future"):
            await EventService(db_session).postpone_event(
                event_id, org, past, past + timedelta(hours=2), "x" * 10
            )

    async def test_the_same_time_is_not_a_postponement(self, db_session, dept):
        org, officer, _, _ = dept
        start, end = await self._future()
        event_id = await _event(db_session, org, officer, start, end)

        with pytest.raises(ValueError, match="Choose a new time"):
            await EventService(db_session).postpone_event(
                event_id, org, start, end, "x" * 10
            )

    async def test_pending_attendance_requests_are_settled_first(
        self, db_session, dept
    ):
        org, officer, present, _ = dept
        start = _whole_minute(datetime.now(timezone.utc) - timedelta(hours=6))
        event_id = await _event(
            db_session, org, officer, start, start + timedelta(hours=2)
        )
        db_session.add(
            EventAttendancePetition(
                organization_id=org,
                event_id=event_id,
                user_id=present,
                status=AttendancePetitionStatus.PENDING,
                reason="Phone died",
            )
        )
        await db_session.commit()

        with pytest.raises(ValueError, match="^1 attendance request is waiting"):
            await EventService(db_session).postpone_event(
                event_id, org, *await self._future(), "x" * 10
            )


class TestNotice:
    async def test_members_are_told_the_old_time_and_why(self, db_session, dept):
        org, officer, present, expected = dept
        event_id, start, end = await _live_drill_with_attendance(db_session, dept)

        with patch.object(EventService, "email_event_change", AsyncMock()) as email:
            await EventService(db_session).postpone_event(
                event_id, org, *_next_week(start, end), "Ladder truck out of service"
            )

        rows = (
            await db_session.execute(
                text(
                    "SELECT recipient_id, subject, message FROM notification_logs "
                    "WHERE organization_id = :o AND category = 'event_update'"
                ),
                {"o": org},
            )
        ).all()
        assert sorted(r.recipient_id for r in rows) == sorted([present, expected])
        assert {r.subject for r in rows} == {"Event Postponed: Ladder Drill"}
        assert all("Ladder truck out of service" in r.message for r in rows)
        email.assert_awaited_once()
        assert _utc(email.await_args.kwargs["postponed_from"]) == start
        assert (
            email.await_args.kwargs["postponement_reason"]
            == "Ladder truck out of service"
        )

    async def test_no_notice_when_the_officer_asks_for_none(self, db_session, dept):
        org, _, _, _ = dept
        event_id, start, end = await _live_drill_with_attendance(db_session, dept)

        with patch.object(EventService, "_notify_postponement", AsyncMock()) as notify:
            await EventService(db_session).postpone_event(
                event_id,
                org,
                *_next_week(start, end),
                "Ladder truck out of service",
                send_notifications=False,
            )

        notify.assert_not_awaited()

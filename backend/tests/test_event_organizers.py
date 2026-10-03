"""Event organizers: who is asked about an attendance request, who may decide
it, and handing an event — or the rest of a series — to somebody else.

Against a real database, because the parts most worth testing are queries: the
fallback chain through positions, the series selection a transfer locks, and
the prompts a transfer archives and re-issues.
"""

import json
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from pydantic import ValidationError
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload

from app.models.event import Event, EventType
from app.models.notification import NotificationLog
from app.models.user import User
from app.schemas.event import (
    AttendancePetitionCreate,
    EventCreate,
    EventSettingsUpdate,
    EventTransferRequest,
)
from app.services.event_attendance_petition_service import (
    REVIEW_PROMPT_CATEGORY,
    EventAttendancePetitionService,
)
from app.services.event_organizer_service import (
    TRANSFER_NOTICE_CATEGORY,
    EventOrganizerService,
)
from app.services.event_service import EventService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture(autouse=True)
def no_email():
    with (
        patch.object(EventAttendancePetitionService, "_send_email", new=AsyncMock()),
        patch.object(EventOrganizerService, "_send_email", new=AsyncMock()) as sent,
    ):
        yield sent


async def _org(db, settings=None) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, "
            "timezone, settings) "
            "VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC', :settings)"
        ),
        {
            "id": org_id,
            "slug": f"o-{org_id[:8]}",
            "settings": json.dumps(settings or {}),
        },
    )
    return org_id


async def _position(db, org_id: str, slug: str, permissions=()) -> str:
    position_id = _uid()
    await db.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, "
            "permissions, is_system) VALUES (:id, :org, :name, :slug, :perms, 0)"
        ),
        {
            "id": position_id,
            "org": org_id,
            "name": slug.title(),
            "slug": slug,
            "perms": json.dumps(list(permissions)),
        },
    )
    return position_id


async def _user(db, org_id: str, first: str, *, position=None, status="active") -> str:
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, 'Member', :em, 'hashed', :status)"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"{first.lower()}-{user_id[:8]}",
            "fn": first,
            "em": f"{first.lower()}-{user_id[:8]}@test.example",
            "status": status,
        },
    )
    if position:
        await db.execute(
            text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
            {"u": user_id, "p": position},
        )
    return user_id


async def _event(
    db,
    org_id: str,
    *,
    organizer=None,
    alternate=None,
    created_by=None,
    starts_in: timedelta = -timedelta(hours=5),
    event_type: str = "training",
    parent_id=None,
    is_recurring: bool = False,
) -> str:
    event_id = _uid()
    start = datetime.now(timezone.utc) + starts_in
    await db.execute(
        text(
            "INSERT INTO events (id, organization_id, title, event_type, "
            "start_datetime, end_datetime, requires_rsvp, is_mandatory, "
            "is_cancelled, is_draft, reminder_schedule, check_in_window_type, "
            "created_by, organizer_id, alternate_organizer_id, is_recurring, "
            "recurrence_pattern, recurrence_parent_id) "
            "VALUES (:id, :org, 'Drill Night', :type, :start, :end, 0, 0, 0, 0, "
            "'[24]', 'flexible', :creator, :organizer, :alternate, :recurring, "
            ":pattern, :parent)"
        ),
        {
            "id": event_id,
            "org": org_id,
            "type": event_type,
            "start": start,
            "end": start + timedelta(hours=2),
            "creator": created_by,
            "organizer": organizer,
            "alternate": alternate,
            "recurring": 1 if is_recurring else 0,
            "pattern": "weekly" if is_recurring else None,
            "parent": parent_id,
        },
    )
    return event_id


async def _load(db, user_id: str) -> User:
    result = await db.execute(
        select(User)
        .options(selectinload(User.positions))
        .where(User.id == user_id)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def _get_event(db, event_id: str) -> Event:
    result = await db.execute(
        select(Event)
        .where(Event.id == event_id)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def _open_prompts(db, recipient: str):
    result = await db.execute(
        select(NotificationLog).where(
            NotificationLog.recipient_id == recipient,
            NotificationLog.category == REVIEW_PROMPT_CATEGORY,
            NotificationLog.expires_at.is_(None),
        )
    )
    return list(result.scalars().all())


async def _notices(db, recipient: str, category: str):
    result = await db.execute(
        select(NotificationLog).where(
            NotificationLog.recipient_id == recipient,
            NotificationLog.category == category,
        )
    )
    return list(result.scalars().all())


async def _ask(db, event_id: str, member_id: str):
    member = await _load(db, member_id)
    return await EventAttendancePetitionService(db).submit(
        event_id, member, AttendancePetitionCreate(reason="Phone died at the door")
    )


async def _ask_directly(db, dept, event_id: str):
    """A pending request on *event_id*, and the organizer's prompt for it,
    written the way submit() would — for an event that has not ended, which
    submit() itself refuses."""
    petition_id = _uid()
    await db.execute(
        text(
            "INSERT INTO event_attendance_petitions (id, organization_id, "
            "event_id, user_id, status, reason) "
            "VALUES (:id, :org, :event, :user, 'pending', 'Was there')"
        ),
        {
            "id": petition_id,
            "org": dept["org"],
            "event": event_id,
            "user": dept["member"],
        },
    )
    db.add(
        NotificationLog(
            organization_id=dept["org"],
            recipient_id=dept["organizer"],
            channel="in_app",
            category=REVIEW_PROMPT_CATEGORY,
            subject="Attendance request",
            message="Review it",
            notification_metadata={"event_id": event_id, "petition_id": petition_id},
            delivered=True,
        )
    )
    await db.flush()
    return petition_id


@pytest.fixture
async def dept(db_session):
    org_id = await _org(db_session)
    manager_pos = await _position(
        db_session, org_id, "events-manager", ["events.manage"]
    )
    ids = {
        "org": org_id,
        "organizer": await _user(db_session, org_id, "Olive"),
        "alternate": await _user(db_session, org_id, "Alex"),
        "member": await _user(db_session, org_id, "Sam"),
        "newbie": await _user(db_session, org_id, "Nia"),
        "manager": await _user(db_session, org_id, "Mona", position=manager_pos),
    }
    await db_session.flush()
    return ids


class TestWhoIsAsked:
    async def test_organizer_and_alternate_both_hear_and_managers_do_not(
        self, db_session, dept
    ):
        event_id = await _event(
            db_session,
            dept["org"],
            organizer=dept["organizer"],
            alternate=dept["alternate"],
        )

        await _ask(db_session, event_id, dept["member"])

        assert len(await _open_prompts(db_session, dept["organizer"])) == 1
        assert len(await _open_prompts(db_session, dept["alternate"])) == 1
        assert not await _open_prompts(db_session, dept["manager"])

    async def test_the_organizer_asking_goes_to_the_alternate_only(
        self, db_session, dept
    ):
        event_id = await _event(
            db_session,
            dept["org"],
            organizer=dept["organizer"],
            alternate=dept["alternate"],
        )

        await _ask(db_session, event_id, dept["organizer"])

        assert len(await _open_prompts(db_session, dept["alternate"])) == 1
        assert not await _open_prompts(db_session, dept["organizer"])
        assert not await _open_prompts(db_session, dept["manager"])

    async def test_an_organizer_who_left_falls_through_to_the_fallback(
        self, db_session, dept
    ):
        gone = await _user(db_session, dept["org"], "Gil", status="retired")
        event_id = await _event(db_session, dept["org"], organizer=gone)

        await _ask(db_session, event_id, dept["member"])

        assert not await _open_prompts(db_session, gone)
        # No position configured and no Secretary: the last resort.
        assert len(await _open_prompts(db_session, dept["manager"])) == 1

    async def test_a_probationary_organizer_is_still_asked(self, db_session, dept):
        probie = await _user(db_session, dept["org"], "Pat", status="probationary")
        event_id = await _event(db_session, dept["org"], organizer=probie)

        await _ask(db_session, event_id, dept["member"])

        assert len(await _open_prompts(db_session, probie)) == 1
        assert not await _open_prompts(db_session, dept["manager"])

    async def test_unconfigured_type_falls_back_to_the_secretary(
        self, db_session, dept
    ):
        secretary_pos = await _position(db_session, dept["org"], "secretary")
        secretary = await _user(db_session, dept["org"], "Sue", position=secretary_pos)
        event_id = await _event(db_session, dept["org"])

        await _ask(db_session, event_id, dept["member"])

        assert len(await _open_prompts(db_session, secretary)) == 1
        assert not await _open_prompts(db_session, dept["manager"])

    async def test_the_configured_position_for_the_type_wins(self, db_session):
        org_id = await _org(db_session)
        training_pos = await _position(db_session, org_id, "training_officer")
        secretary_pos = await _position(db_session, org_id, "secretary")
        await db_session.execute(
            text("UPDATE organizations SET settings = :s WHERE id = :id"),
            {
                "id": org_id,
                "s": json.dumps(
                    {
                        "events": {
                            "attendance_request_fallback_positions": {
                                "training": training_pos,
                            }
                        }
                    }
                ),
            },
        )
        officer = await _user(db_session, org_id, "Tom", position=training_pos)
        secretary = await _user(db_session, org_id, "Sue", position=secretary_pos)
        member = await _user(db_session, org_id, "Sam")
        training = await _event(db_session, org_id, event_type="training")
        meeting = await _event(db_session, org_id, event_type="business_meeting")

        await _ask(db_session, training, member)
        await _ask(db_session, meeting, member)

        officer_prompts = await _open_prompts(db_session, officer)
        secretary_prompts = await _open_prompts(db_session, secretary)
        assert [p.notification_metadata["event_id"] for p in officer_prompts] == [
            training
        ]
        assert [p.notification_metadata["event_id"] for p in secretary_prompts] == [
            meeting
        ]

    async def test_a_vacant_configured_position_moves_on_to_the_secretary(
        self, db_session
    ):
        vacant = _uid()
        org_id = await _org(
            db_session,
            {"events": {"attendance_request_fallback_positions": {"training": vacant}}},
        )
        secretary_pos = await _position(db_session, org_id, "secretary")
        secretary = await _user(db_session, org_id, "Sue", position=secretary_pos)
        member = await _user(db_session, org_id, "Sam")
        event_id = await _event(db_session, org_id)

        await _ask(db_session, event_id, member)

        assert len(await _open_prompts(db_session, secretary)) == 1

    async def test_a_malformed_setting_degrades_to_the_default(self, db_session):
        org_id = await _org(
            db_session,
            {"events": {"attendance_request_fallback_positions": ["not", "a map"]}},
        )
        secretary_pos = await _position(db_session, org_id, "secretary")
        secretary = await _user(db_session, org_id, "Sue", position=secretary_pos)
        member = await _user(db_session, org_id, "Sam")
        event_id = await _event(db_session, org_id)

        await _ask(db_session, event_id, member)

        assert len(await _open_prompts(db_session, secretary)) == 1


class TestWhoMayDecide:
    async def test_the_alternate_may_review_without_events_manage(
        self, db_session, dept
    ):
        event_id = await _event(
            db_session,
            dept["org"],
            organizer=dept["organizer"],
            alternate=dept["alternate"],
        )
        await _ask(db_session, event_id, dept["member"])
        alternate = await _load(db_session, dept["alternate"])

        listed = await EventAttendancePetitionService(db_session).list_for_event(
            event_id, alternate
        )

        assert len(listed) == 1

    async def test_the_creator_loses_the_right_once_handed_over(self, db_session, dept):
        event_id = await _event(
            db_session,
            dept["org"],
            created_by=dept["organizer"],
            organizer=dept["newbie"],
        )
        creator = await _load(db_session, dept["organizer"])

        with pytest.raises(PermissionError):
            await EventAttendancePetitionService(db_session).list_for_event(
                event_id, creator
            )


class TestTransfer:
    async def _series(self, db, dept):
        """A weekly series: two past occurrences (the first is the parent)
        and two upcoming ones, all run by the organizer."""
        org = dept["org"]
        parent = await _event(
            db,
            org,
            organizer=dept["organizer"],
            starts_in=-timedelta(days=14),
            is_recurring=True,
        )
        past = await _event(
            db,
            org,
            organizer=dept["organizer"],
            starts_in=-timedelta(days=7),
            is_recurring=True,
            parent_id=parent,
        )
        upcoming = await _event(
            db,
            org,
            organizer=dept["organizer"],
            starts_in=timedelta(days=7),
            is_recurring=True,
            parent_id=parent,
        )
        later = await _event(
            db,
            org,
            organizer=dept["organizer"],
            starts_in=timedelta(days=14),
            is_recurring=True,
            parent_id=parent,
        )
        return parent, past, upcoming, later

    async def test_this_and_future_moves_upcoming_and_the_parent_only(
        self, db_session, dept
    ):
        parent, past, upcoming, later = await self._series(db_session, dept)
        actor = await _load(db_session, dept["organizer"])

        result = await EventOrganizerService(db_session).transfer(
            upcoming, actor, dept["newbie"], dept["alternate"], "future"
        )

        assert result.updated_count == 3
        assert set(result.affected_event_ids) == {parent, upcoming, later}
        for event_id in (parent, upcoming, later):
            event = await _get_event(db_session, event_id)
            assert event.organizer_id == dept["newbie"]
            assert event.alternate_organizer_id == dept["alternate"]
        # The occurrence already run keeps the organizer who ran it.
        assert (await _get_event(db_session, past)).organizer_id == dept["organizer"]

    async def test_this_event_only_leaves_the_rest_of_the_series(
        self, db_session, dept
    ):
        parent, _past, upcoming, later = await self._series(db_session, dept)
        actor = await _load(db_session, dept["manager"])

        result = await EventOrganizerService(db_session).transfer(
            upcoming, actor, dept["newbie"], None, "this"
        )

        assert result.updated_count == 1
        assert (await _get_event(db_session, upcoming)).organizer_id == dept["newbie"]
        assert (await _get_event(db_session, later)).organizer_id == dept["organizer"]
        assert (await _get_event(db_session, parent)).organizer_id == dept["organizer"]

    async def test_the_new_and_outgoing_are_told_but_not_the_actor(
        self, db_session, dept, no_email
    ):
        event_id = await _event(
            db_session,
            dept["org"],
            organizer=dept["organizer"],
            alternate=dept["alternate"],
            starts_in=timedelta(days=3),
        )
        actor = await _load(db_session, dept["organizer"])

        await EventOrganizerService(db_session).transfer(
            event_id, actor, dept["newbie"], None, "this"
        )

        assigned = await _notices(db_session, dept["newbie"], TRANSFER_NOTICE_CATEGORY)
        released = await _notices(
            db_session, dept["alternate"], TRANSFER_NOTICE_CATEGORY
        )
        assert len(assigned) == 1
        assert "organizer" in assigned[0].subject
        assert len(released) == 1
        assert "no longer" in released[0].message
        assert not await _notices(
            db_session, dept["organizer"], TRANSFER_NOTICE_CATEGORY
        )
        # Email follows each member's preferences; both default to receiving.
        assert no_email.await_count == 2

    async def test_open_requests_move_to_the_new_organizer(self, db_session, dept):
        event_id = await _event(
            db_session,
            dept["org"],
            organizer=dept["organizer"],
            alternate=dept["alternate"],
        )
        await _ask(db_session, event_id, dept["member"])
        actor = await _load(db_session, dept["manager"])

        await EventOrganizerService(db_session).transfer(
            event_id, actor, dept["newbie"], dept["alternate"], "this"
        )

        assert not await _open_prompts(db_session, dept["organizer"])
        assert len(await _open_prompts(db_session, dept["newbie"])) == 1
        # Kept the role, so kept the one prompt rather than gaining a second.
        assert len(await _open_prompts(db_session, dept["alternate"])) == 1

    async def test_a_failed_email_does_not_strand_the_other_requests(
        self, db_session, dept
    ):
        """A notice that fails rolls the session back; every request after it
        must still be re-addressed, and the transfer itself must stand."""
        parent, _past, upcoming, later = await self._series(db_session, dept)
        # Requests can only be made on events that are over, so make the two
        # upcoming occurrences look over without moving them out of "future".
        for event_id in (upcoming, later):
            await _ask_directly(db_session, dept, event_id)
        actor = await _load(db_session, dept["manager"])

        with patch.object(
            EventAttendancePetitionService,
            "_send_email",
            new=AsyncMock(side_effect=RuntimeError("SMTP down")),
        ):
            await EventOrganizerService(db_session).transfer(
                upcoming, actor, dept["newbie"], None, "future"
            )

        assert len(await _open_prompts(db_session, dept["newbie"])) == 2
        assert not await _open_prompts(db_session, dept["organizer"])
        assert (await _get_event(db_session, later)).organizer_id == dept["newbie"]

    async def test_the_alternate_may_hand_it_over(self, db_session, dept):
        event_id = await _event(
            db_session,
            dept["org"],
            organizer=dept["organizer"],
            alternate=dept["alternate"],
            starts_in=timedelta(days=3),
        )
        actor = await _load(db_session, dept["alternate"])

        await EventOrganizerService(db_session).transfer(
            event_id, actor, dept["alternate"], dept["newbie"], "this"
        )

        event = await _get_event(db_session, event_id)
        assert event.organizer_id == dept["alternate"]
        assert event.alternate_organizer_id == dept["newbie"]

    async def test_a_plain_member_may_not(self, db_session, dept):
        event_id = await _event(db_session, dept["org"], organizer=dept["organizer"])
        actor = await _load(db_session, dept["member"])

        with pytest.raises(PermissionError):
            await EventOrganizerService(db_session).transfer(
                event_id, actor, dept["member"], None, "this"
            )

    async def test_another_departments_member_is_refused(self, db_session, dept):
        other_org = await _org(db_session)
        outsider = await _user(db_session, other_org, "Otto")
        event_id = await _event(db_session, dept["org"], organizer=dept["organizer"])
        actor = await _load(db_session, dept["manager"])

        with pytest.raises(ValueError, match="not an active member"):
            await EventOrganizerService(db_session).transfer(
                event_id, actor, outsider, None, "this"
            )

    async def test_another_departments_event_is_not_found(self, db_session, dept):
        other_org = await _org(db_session)
        event_id = await _event(db_session, other_org)
        actor = await _load(db_session, dept["manager"])

        with pytest.raises(LookupError):
            await EventOrganizerService(db_session).transfer(
                event_id, actor, dept["newbie"], None, "this"
            )

    async def test_the_alternate_must_be_somebody_else(self, db_session, dept):
        event_id = await _event(db_session, dept["org"], organizer=dept["organizer"])
        actor = await _load(db_session, dept["manager"])

        with pytest.raises(ValueError, match="different member"):
            await EventOrganizerService(db_session).transfer(
                event_id, actor, dept["newbie"], dept["newbie"], "this"
            )

    async def test_an_unchanged_pair_is_refused(self, db_session, dept):
        event_id = await _event(db_session, dept["org"], organizer=dept["organizer"])
        actor = await _load(db_session, dept["manager"])

        with pytest.raises(ValueError, match="already has"):
            await EventOrganizerService(db_session).transfer(
                event_id, actor, dept["organizer"], None, "this"
            )

    def test_the_request_schema_accepts_only_known_scopes(self):
        with pytest.raises(ValidationError):
            EventTransferRequest(organizer_id=uuid.uuid4(), scope="all")


class TestCreation:
    @staticmethod
    def _payload(**extra) -> EventCreate:
        start = datetime.now(timezone.utc) + timedelta(days=2)
        return EventCreate(
            title="Pump Ops",
            event_type="training",
            start_datetime=start,
            end_datetime=start + timedelta(hours=2),
            **extra,
        )

    async def test_the_creator_is_the_organizer_by_default(self, db_session, dept):
        event = await EventService(db_session).create_event(
            self._payload(), dept["org"], dept["manager"]
        )

        assert event.organizer_id == dept["manager"]
        assert event.alternate_organizer_id is None

    async def test_a_chosen_pair_is_stored(self, db_session, dept):
        event = await EventService(db_session).create_event(
            self._payload(
                organizer_id=dept["organizer"], alternate_organizer_id=dept["alternate"]
            ),
            dept["org"],
            dept["manager"],
        )

        assert event.organizer_id == dept["organizer"]
        assert event.alternate_organizer_id == dept["alternate"]

    async def test_a_foreign_organizer_is_refused(self, db_session, dept):
        other_org = await _org(db_session)
        outsider = await _user(db_session, other_org, "Otto")

        with pytest.raises(ValueError, match="not an active member"):
            await EventService(db_session).create_event(
                self._payload(organizer_id=outsider), dept["org"], dept["manager"]
            )

    async def test_a_recurring_series_carries_the_pair_on_every_occurrence(
        self, db_session, dept
    ):
        start = datetime.now(timezone.utc) + timedelta(days=1)
        events, error = await EventService(db_session).create_recurring_event(
            {
                "title": "Drill Night",
                "event_type": "training",
                "start_datetime": start,
                "end_datetime": start + timedelta(hours=2),
                "recurrence_pattern": "weekly",
                "recurrence_end_date": start + timedelta(days=21),
                "organizer_id": dept["organizer"],
                "alternate_organizer_id": dept["alternate"],
            },
            dept["org"],
            dept["manager"],
        )

        assert error is None
        assert len(events) == 4
        assert {e.organizer_id for e in events} == {dept["organizer"]}
        assert {e.alternate_organizer_id for e in events} == {dept["alternate"]}

    async def test_an_insert_path_that_names_no_organizer_uses_the_creator(
        self, db_session, dept
    ):
        """Duplicate, CSV import and a training session's event build Event()
        directly; the column default keeps them on the creator."""
        start = datetime.now(timezone.utc) + timedelta(days=2)
        event = Event(
            organization_id=dept["org"],
            created_by=dept["newbie"],
            title="Imported",
            event_type=EventType.OTHER,
            start_datetime=start,
            end_datetime=start + timedelta(hours=1),
        )
        db_session.add(event)
        await db_session.flush()

        assert (await _get_event(db_session, event.id)).organizer_id == dept["newbie"]


class TestSeriesReminderRecipients:
    async def test_the_organizer_pair_not_the_creator(self, db_session, dept):
        event_id = await _event(
            db_session,
            dept["org"],
            created_by=dept["manager"],
            organizer=dept["organizer"],
            alternate=dept["alternate"],
        )
        event = await _get_event(db_session, event_id)

        recipients = await EventOrganizerService(db_session).series_reminder_recipients(
            event
        )

        assert [u.id for u in recipients] == [dept["organizer"], dept["alternate"]]

    async def test_the_creator_when_neither_is_reachable(self, db_session, dept):
        event_id = await _event(db_session, dept["org"], created_by=dept["manager"])
        event = await _get_event(db_session, event_id)

        recipients = await EventOrganizerService(db_session).series_reminder_recipients(
            event
        )

        assert [u.id for u in recipients] == [dept["manager"]]


class TestFallbackSetting:
    def test_an_unknown_event_type_is_refused(self):
        with pytest.raises(ValidationError):
            EventSettingsUpdate(
                attendance_request_fallback_positions={"bonfire": _uid()}
            )

    def test_null_clears_a_type(self):
        update = EventSettingsUpdate(
            attendance_request_fallback_positions={"training": None}
        )
        assert update.attendance_request_fallback_positions == {"training": None}

    async def test_another_departments_position_is_refused(self, db_session, dept):
        from fastapi import HTTPException

        from app.api.v1.endpoints.events import update_event_settings

        other_org = await _org(db_session)
        foreign = await _position(db_session, other_org, "secretary")
        manager = await _load(db_session, dept["manager"])

        with pytest.raises(HTTPException) as refused:
            await update_event_settings(
                EventSettingsUpdate(
                    attendance_request_fallback_positions={"training": foreign}
                ),
                db=db_session,
                current_user=manager,
            )
        assert refused.value.status_code == 400

    async def test_an_own_position_is_saved(self, db_session, dept):
        from app.api.v1.endpoints.events import update_event_settings

        own = await _position(db_session, dept["org"], "training_officer")
        manager = await _load(db_session, dept["manager"])

        merged = await update_event_settings(
            EventSettingsUpdate(
                attendance_request_fallback_positions={"training": own}
            ),
            db=db_session,
            current_user=manager,
        )

        assert merged["attendance_request_fallback_positions"] == {"training": own}


class TestScheduledTasksFollowTheOrganizer:
    async def test_a_rolling_series_extends_with_the_current_organizer(
        self, db_session, dept
    ):
        from app.services.scheduled_tasks import run_rolling_recurrence_extend

        parent = await _event(
            db_session,
            dept["org"],
            created_by=dept["manager"],
            organizer=dept["newbie"],
            alternate=dept["alternate"],
            starts_in=timedelta(days=1),
            is_recurring=True,
        )
        await db_session.execute(
            text("UPDATE events SET rolling_recurrence = 1 WHERE id = :id"),
            {"id": parent},
        )

        await run_rolling_recurrence_extend(db_session)

        children = (
            (
                await db_session.execute(
                    select(Event).where(Event.recurrence_parent_id == parent)
                )
            )
            .scalars()
            .all()
        )
        assert children
        assert {c.organizer_id for c in children} == {dept["newbie"]}
        assert {c.alternate_organizer_id for c in children} == {dept["alternate"]}

    async def test_the_series_end_reminder_goes_to_the_organizer_pair(
        self, db_session, dept
    ):
        from app.services.scheduled_tasks import run_series_end_reminders

        parent = await _event(
            db_session,
            dept["org"],
            created_by=dept["manager"],
            organizer=dept["organizer"],
            alternate=dept["alternate"],
            starts_in=timedelta(days=1),
            is_recurring=True,
        )
        await db_session.execute(
            text("UPDATE events SET recurrence_end_date = :end WHERE id = :id"),
            {"id": parent, "end": datetime.now(timezone.utc) + timedelta(days=60)},
        )

        with patch(
            "app.services.email_service.EmailService.send_email",
            new=AsyncMock(return_value=(1, 0)),
        ):
            await run_series_end_reminders(db_session)

        for recipient in (dept["organizer"], dept["alternate"]):
            assert await _notices(db_session, recipient, "series_end_reminder")
        assert not await _notices(db_session, dept["manager"], "series_end_reminder")


class TestPositionOptions:
    async def test_lists_only_this_departments_positions(self, db_session, dept):
        from app.api.v1.endpoints.events import list_fallback_position_options

        own = await _position(db_session, dept["org"], "secretary")
        other_org = await _org(db_session)
        await _position(db_session, other_org, "secretary")
        manager = await _load(db_session, dept["manager"])

        options = await list_fallback_position_options(
            db=db_session, current_user=manager
        )

        # The dept's events-manager position and the Secretary; never the
        # other department's.
        assert {o["id"] for o in options} == {own, manager.positions[0].id}
        assert {"id", "name", "slug"} == set(options[0])

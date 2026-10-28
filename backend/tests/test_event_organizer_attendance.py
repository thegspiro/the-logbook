"""An event's organizer runs its attendance; a training manager runs a Training
event's.

The attendance tools — the roster, its history and counts, the member picker,
adding, checking in, correcting and removing attendees — used to answer only
to ``events.manage``. A member named as an event's organizer could show the
check-in QR code and approve late requests, but could not add the members who
were standing in the room. These routes now admit:

* ``events.manage`` — any event, unchanged;
* ``training.manage`` — any Training event;
* the event's organizer or alternate — their own event, except that on a
  Training event they do not correct times or credited hours, and nowhere do
  they write their own attendance.

Against a real database: the decision is made from the event row read
org-scoped, and the writes it admits are the service's real ones.
"""

import json
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints import events
from app.models.event import Event, EventRSVP
from app.models.user import User
from app.schemas.event import (
    BulkAddAttendees,
    CheckInRequest,
    ManagerAddAttendee,
    RSVPOverride,
)
from app.utils.contact_visibility import ContactPolicy

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _org(db) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, "
            "timezone, settings) "
            "VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC', '{}')"
        ),
        {"id": org_id, "slug": f"o-{org_id[:8]}"},
    )
    return org_id


async def _position(db, org_id: str, slug: str, permissions) -> str:
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


async def _user(db, org_id: str, first: str, position=None) -> str:
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, 'Member', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"{first.lower()}-{user_id[:8]}",
            "fn": first,
            "em": f"{first.lower()}-{user_id[:8]}@test.example",
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
    organizer,
    alternate=None,
    event_type,
    started_ago: timedelta = timedelta(hours=14),
) -> str:
    """By default an event that ended last night and has not been finalized."""
    event_id = _uid()
    start = datetime.now(timezone.utc) - started_ago
    await db.execute(
        text(
            "INSERT INTO events (id, organization_id, title, event_type, "
            "start_datetime, end_datetime, requires_rsvp, is_mandatory, "
            "is_cancelled, is_draft, reminder_schedule, check_in_window_type, "
            "created_by, organizer_id, alternate_organizer_id) "
            "VALUES (:id, :org, 'Monthly Meeting', :type, :start, :end, 0, 0, 0, "
            "0, '[24]', 'flexible', :organizer, :organizer, :alternate)"
        ),
        {
            "id": event_id,
            "org": org_id,
            "type": event_type,
            "start": start,
            "end": start + timedelta(hours=2),
            "organizer": organizer,
            "alternate": alternate,
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
    result = await db.execute(select(Event).where(Event.id == event_id))
    return result.scalar_one()


async def _rsvp(db, event_id: str, user_id: str):
    result = await db.execute(
        select(EventRSVP)
        .where(EventRSVP.event_id == event_id)
        .where(EventRSVP.user_id == user_id)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


@pytest.fixture(autouse=True)
def audit():
    with patch.object(events, "log_audit_event", AsyncMock()) as logged:
        yield logged


@pytest.fixture
async def dept(db_session):
    org_id = await _org(db_session)
    events_pos = await _position(
        db_session, org_id, "events-manager", ["events.manage"]
    )
    training_pos = await _position(
        db_session, org_id, "training-officer", ["training.manage"]
    )
    ids = {
        "org": org_id,
        "organizer": await _user(db_session, org_id, "Olive"),
        "alternate": await _user(db_session, org_id, "Alex"),
        "member": await _user(db_session, org_id, "Sam"),
        "other": await _user(db_session, org_id, "Pat"),
        "events_manager": await _user(db_session, org_id, "Mona", events_pos),
        "training_manager": await _user(db_session, org_id, "Tara", training_pos),
    }
    ids["meeting"] = await _event(
        db_session,
        org_id,
        organizer=ids["organizer"],
        alternate=ids["alternate"],
        event_type="business_meeting",
    )
    ids["training"] = await _event(
        db_session,
        org_id,
        organizer=ids["organizer"],
        alternate=ids["alternate"],
        event_type="training",
    )
    await db_session.flush()
    return ids


async def _add(db, dept, event_key, actor_key, target_key, *, checked_in=True):
    return await events.manager_add_attendee(
        event_id=uuid.UUID(dept[event_key]),
        attendee_data=ManagerAddAttendee(
            user_id=dept[target_key], checked_in=checked_in
        ),
        db=db,
        current_user=await _load(db, dept[actor_key]),
    )


async def _refused(call) -> HTTPException:
    with pytest.raises(HTTPException) as exc:
        await call
    return exc.value


class TestTheOrganizerRunsTheirEvent:
    @pytest.mark.parametrize("actor", ["organizer", "alternate"])
    async def test_adds_and_checks_in_a_member(self, db_session, dept, audit, actor):
        response = await _add(db_session, dept, "meeting", actor, "member")

        assert str(response.user_id) == dept["member"]
        assert response.checked_in is True
        rsvp = await _rsvp(db_session, dept["meeting"], dept["member"])
        assert rsvp is not None
        assert rsvp.checked_in is True
        assert audit.await_args.kwargs["event_data"]["acting_as"] == "organizer"
        assert audit.await_args.kwargs["user_id"] == dept[actor]

    async def test_checks_in_a_member_during_the_event(self, db_session, dept):
        """Check-in closes with the event; afterwards a late arrival is added
        already checked in, which the test above covers."""
        happening_now = await _event(
            db_session,
            dept["org"],
            organizer=dept["organizer"],
            event_type="business_meeting",
            started_ago=timedelta(minutes=30),
        )

        response = await events.check_in_attendee(
            event_id=uuid.UUID(happening_now),
            check_in_data=CheckInRequest(user_id=dept["member"]),
            db=db_session,
            current_user=await _load(db_session, dept["organizer"]),
        )

        assert response.checked_in is True

    async def test_bulk_add_adds_everyone_but_themselves(self, db_session, dept):
        response = await events.bulk_add_attendees(
            event_id=uuid.UUID(dept["meeting"]),
            data=BulkAddAttendees(
                user_ids=[dept["member"], dept["other"], dept["organizer"]],
                status="going",
            ),
            db=db_session,
            current_user=await _load(db_session, dept["organizer"]),
        )

        assert response.created_count == 2
        (row,) = response.errors
        assert str(row.user_id) == dept["organizer"]
        assert await _rsvp(db_session, dept["meeting"], dept["organizer"]) is None

    async def test_reads_the_roster_and_counts(self, db_session, dept):
        await _add(db_session, dept, "meeting", "organizer", "member")
        organizer = await _load(db_session, dept["organizer"])

        roster = await events.list_event_rsvps(
            event_id=uuid.UUID(dept["meeting"]),
            status_filter=None,
            skip=0,
            limit=100,
            db=db_session,
            current_user=organizer,
        )
        stats = await events.get_event_stats(
            event_id=uuid.UUID(dept["meeting"]),
            db=db_session,
            current_user=organizer,
        )

        assert [str(r.user_id) for r in roster] == [dept["member"]]
        assert stats.checked_in_count == 1

    async def test_corrects_times_on_an_ordinary_event(self, db_session, dept):
        await _add(db_session, dept, "meeting", "organizer", "member")

        response = await events.override_rsvp_attendance(
            event_id=uuid.UUID(dept["meeting"]),
            user_id=uuid.UUID(dept["member"]),
            override_data=RSVPOverride(override_duration_minutes=90),
            db=db_session,
            current_user=await _load(db_session, dept["organizer"]),
        )

        assert response.override_duration_minutes == 90

    async def test_removes_a_mistaken_add(self, db_session, dept):
        await _add(db_session, dept, "training", "organizer", "member")

        await events.remove_attendee(
            event_id=uuid.UUID(dept["training"]),
            user_id=uuid.UUID(dept["member"]),
            db=db_session,
            current_user=await _load(db_session, dept["organizer"]),
        )

        assert await _rsvp(db_session, dept["training"], dept["member"]) is None


class TestWhatTheOrganizerMayNotDo:
    async def test_cannot_record_their_own_attendance(self, db_session, dept):
        refused = await _refused(
            _add(db_session, dept, "meeting", "organizer", "organizer")
        )

        assert refused.status_code == 403
        assert await _rsvp(db_session, dept["meeting"], dept["organizer"]) is None

    async def test_cannot_correct_times_on_a_training_event(self, db_session, dept):
        await _add(db_session, dept, "training", "organizer", "member")

        refused = await _refused(
            events.override_rsvp_attendance(
                event_id=uuid.UUID(dept["training"]),
                user_id=uuid.UUID(dept["member"]),
                override_data=RSVPOverride(override_duration_minutes=600),
                db=db_session,
                current_user=await _load(db_session, dept["organizer"]),
            )
        )

        assert refused.status_code == 403
        rsvp = await _rsvp(db_session, dept["training"], dept["member"])
        assert rsvp.override_duration_minutes is None

    async def test_can_still_add_to_a_training_event(self, db_session, dept):
        response = await _add(db_session, dept, "training", "organizer", "member")

        assert response.checked_in is True

    async def test_sees_emails_through_the_contact_policy(self, db_session, dept):
        await _add(db_session, dept, "meeting", "organizer", "member")
        hidden = ContactPolicy(
            show_email=False,
            show_phone=False,
            show_mobile=False,
            honor_member_choice=True,
        )

        with patch.object(
            events, "load_contact_policy", AsyncMock(return_value=hidden)
        ):
            as_organizer = await events.list_event_rsvps(
                event_id=uuid.UUID(dept["meeting"]),
                status_filter=None,
                skip=0,
                limit=100,
                db=db_session,
                current_user=await _load(db_session, dept["organizer"]),
            )
            as_manager = await events.list_event_rsvps(
                event_id=uuid.UUID(dept["meeting"]),
                status_filter=None,
                skip=0,
                limit=100,
                db=db_session,
                current_user=await _load(db_session, dept["events_manager"]),
            )

        assert as_organizer[0].user_email is None
        assert as_manager[0].user_email is not None


class TestWhoIsTurnedAway:
    async def test_a_member_who_does_not_organize_it(self, db_session, dept):
        refused = await _refused(_add(db_session, dept, "meeting", "other", "member"))

        assert refused.status_code == 403
        assert await _rsvp(db_session, dept["meeting"], dept["member"]) is None

    async def test_the_organizer_of_a_different_event(self, db_session, dept):
        elsewhere = await _event(
            db_session,
            dept["org"],
            organizer=dept["other"],
            event_type="business_meeting",
        )

        refused = await _refused(
            events.get_eligible_members(
                event_id=uuid.UUID(elsewhere),
                db=db_session,
                current_user=await _load(db_session, dept["organizer"]),
            )
        )

        assert refused.status_code == 403

    async def test_an_organizer_id_on_another_departments_event(self, db_session, dept):
        """The event is read org-scoped, so naming a member as organizer on a
        foreign row admits nobody — and does not confirm the row exists."""
        foreign_org = await _org(db_session)
        foreign = await _event(
            db_session,
            foreign_org,
            organizer=dept["organizer"],
            event_type="business_meeting",
        )

        refused = await _refused(
            events.list_event_rsvps(
                event_id=uuid.UUID(foreign),
                status_filter=None,
                skip=0,
                limit=100,
                db=db_session,
                current_user=await _load(db_session, dept["organizer"]),
            )
        )

        assert refused.status_code == 404

    async def test_a_training_manager_on_an_event_that_is_not_training(
        self, db_session, dept
    ):
        refused = await _refused(
            _add(db_session, dept, "meeting", "training_manager", "member")
        )

        assert refused.status_code == 403


class TestTheTrainingManager:
    async def test_runs_any_training_event_including_times(
        self, db_session, dept, audit
    ):
        await _add(db_session, dept, "training", "training_manager", "member")
        assert audit.await_args.kwargs["event_data"]["acting_as"] == (
            "training_manager"
        )

        response = await events.override_rsvp_attendance(
            event_id=uuid.UUID(dept["training"]),
            user_id=uuid.UUID(dept["member"]),
            override_data=RSVPOverride(override_duration_minutes=120),
            db=db_session,
            current_user=await _load(db_session, dept["training_manager"]),
        )

        assert response.override_duration_minutes == 120


class TestTheFlagsThePageReads:
    """``attendance_access`` / ``can_correct_attendance_times`` come from the
    same functions the routes gate on."""

    @pytest.mark.parametrize(
        ("actor", "event_key", "manage", "correct"),
        [
            ("organizer", "meeting", True, True),
            ("organizer", "training", True, False),
            ("alternate", "training", True, False),
            ("training_manager", "training", True, True),
            ("training_manager", "meeting", False, False),
            ("events_manager", "training", True, True),
            ("member", "meeting", False, False),
        ],
    )
    async def test_flags(self, db_session, dept, actor, event_key, manage, correct):
        event = await _get_event(db_session, dept[event_key])
        user = await _load(db_session, dept[actor])

        access = events.attendance_access(event, user)

        assert (access is not None) is manage
        assert events.may_correct_attendance_times(event, access) is correct

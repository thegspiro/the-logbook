"""Attendance petitions: a member asks to be marked present after the fact.

Covers against a real database what a mock would take on trust: the unique
one-request-per-member index, the RSVP an approval writes (the same override
fields finalize credits from), who may decide, the refusal while attendance is
finalized, and who hears about it.
"""

import json
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from pydantic import ValidationError
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload

from app.models.event import AttendancePetitionStatus, EventRSVP
from app.models.notification import NotificationLog
from app.models.user import User
from app.schemas.event import (
    AttendancePetitionApprove,
    AttendancePetitionCreate,
    AttendancePetitionReject,
)
from app.services.event_attendance_petition_service import (
    MEMBER_UPDATE_CATEGORY,
    REVIEW_PROMPT_CATEGORY,
    EventAttendancePetitionService,
    PetitionNotFound,
)
from app.services.event_service import ATTENDANCE_LOCKED_PREFIX

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture(autouse=True)
def no_email():
    with patch.object(
        EventAttendancePetitionService, "_send_email", new=AsyncMock()
    ) as sent:
        yield sent


async def _org(db) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"p-{org_id[:8]}"},
    )
    return org_id


async def _user(db, org_id: str, first: str, permissions=()) -> str:
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
    if permissions:
        position_id = _uid()
        await db.execute(
            text(
                "INSERT INTO positions (id, organization_id, name, slug, "
                "permissions, is_system) VALUES (:id, :org, :name, :slug, :perms, 0)"
            ),
            {
                "id": position_id,
                "org": org_id,
                "name": f"Pos {position_id[:6]}",
                "slug": f"p-{position_id[:8]}",
                "perms": json.dumps(list(permissions)),
            },
        )
        await db.execute(
            text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
            {"u": user_id, "p": position_id},
        )
    return user_id


_SAME_AS_CREATOR = object()


async def _event(
    db,
    org_id: str,
    created_by,
    *,
    ended_ago: timedelta = timedelta(hours=3),
    cancelled: bool = False,
    finalized: bool = False,
    organizer=_SAME_AS_CREATOR,
    alternate=None,
    event_type: str = "training",
) -> str:
    """Raw insert, so the organizer is set the way the migration backfills an
    existing row: to its creator, unless the test names somebody else."""
    event_id = _uid()
    end = datetime.now(timezone.utc) - ended_ago
    await db.execute(
        text(
            "INSERT INTO events (id, organization_id, title, event_type, "
            "start_datetime, end_datetime, requires_rsvp, is_mandatory, "
            "is_cancelled, is_draft, reminder_schedule, check_in_window_type, "
            "created_by, organizer_id, alternate_organizer_id, "
            "attendance_finalized_at) "
            "VALUES (:id, :org, 'Ladder Drill', :type, :start, :end, 0, 0, "
            ":cancelled, 0, '[24]', 'flexible', :creator, :organizer, :alternate, "
            ":fin)"
        ),
        {
            "id": event_id,
            "org": org_id,
            "type": event_type,
            "start": end - timedelta(hours=2),
            "end": end,
            "cancelled": 1 if cancelled else 0,
            "creator": created_by,
            "organizer": created_by if organizer is _SAME_AS_CREATOR else organizer,
            "alternate": alternate,
            "fin": datetime.now(timezone.utc) if finalized else None,
        },
    )
    return event_id


async def _load(db, user_id: str) -> User:
    result = await db.execute(
        select(User).options(selectinload(User.positions)).where(User.id == user_id)
    )
    return result.scalar_one()


@pytest.fixture
async def dept(db_session):
    org_id = await _org(db_session)
    ids = {
        "org": org_id,
        "organizer": await _user(db_session, org_id, "Olive"),
        "member": await _user(db_session, org_id, "Sam"),
        "manager": await _user(
            db_session, org_id, "Mona", permissions=["events.manage"]
        ),
        "bystander": await _user(db_session, org_id, "Bea"),
    }
    await db_session.flush()
    return ids


def _ask(reason: str = "Phone died at the door") -> AttendancePetitionCreate:
    return AttendancePetitionCreate(reason=reason)


async def _notices(db, recipient: str, category: str):
    result = await db.execute(
        select(NotificationLog).where(
            NotificationLog.recipient_id == recipient,
            NotificationLog.category == category,
        )
    )
    return list(result.scalars().all())


class TestSubmit:
    async def test_a_member_can_ask_after_the_event_and_the_organizer_hears(
        self, db_session, dept
    ):
        event_id = await _event(db_session, dept["org"], dept["organizer"])
        member = await _load(db_session, dept["member"])

        petition = await EventAttendancePetitionService(db_session).submit(
            event_id, member, _ask()
        )

        assert petition.status == AttendancePetitionStatus.PENDING
        assert petition.reason == "Phone died at the door"
        prompts = await _notices(db_session, dept["organizer"], REVIEW_PROMPT_CATEGORY)
        assert len(prompts) == 1
        assert prompts[0].notification_metadata["petition_id"] == petition.id
        # The organizer is the one prompted; managers are not also buried.
        assert not await _notices(db_session, dept["manager"], REVIEW_PROMPT_CATEGORY)

    async def test_without_an_organizer_every_event_manager_hears(
        self, db_session, dept
    ):
        event_id = await _event(db_session, dept["org"], None)
        member = await _load(db_session, dept["member"])

        await EventAttendancePetitionService(db_session).submit(
            event_id, member, _ask()
        )

        assert await _notices(db_session, dept["manager"], REVIEW_PROMPT_CATEGORY)
        assert not await _notices(db_session, dept["bystander"], REVIEW_PROMPT_CATEGORY)

    async def test_refused_while_check_in_is_still_open(self, db_session, dept):
        event_id = await _event(
            db_session, dept["org"], dept["organizer"], ended_ago=-timedelta(hours=1)
        )
        member = await _load(db_session, dept["member"])

        with pytest.raises(ValueError, match="Check in instead"):
            await EventAttendancePetitionService(db_session).submit(
                event_id, member, _ask()
            )

    async def test_refused_after_thirty_days(self, db_session, dept):
        event_id = await _event(
            db_session, dept["org"], dept["organizer"], ended_ago=timedelta(days=31)
        )
        member = await _load(db_session, dept["member"])

        with pytest.raises(ValueError, match="within 30 days"):
            await EventAttendancePetitionService(db_session).submit(
                event_id, member, _ask()
            )

    async def test_refused_on_a_cancelled_event(self, db_session, dept):
        event_id = await _event(
            db_session, dept["org"], dept["organizer"], cancelled=True
        )
        member = await _load(db_session, dept["member"])

        with pytest.raises(ValueError, match="not open to attendance requests"):
            await EventAttendancePetitionService(db_session).submit(
                event_id, member, _ask()
            )

    async def test_refused_when_already_checked_in(self, db_session, dept):
        event_id = await _event(db_session, dept["org"], dept["organizer"])
        db_session.add(
            EventRSVP(
                organization_id=dept["org"],
                event_id=event_id,
                user_id=dept["member"],
                status="going",
                checked_in=True,
            )
        )
        await db_session.flush()
        member = await _load(db_session, dept["member"])

        with pytest.raises(ValueError, match="already recorded as present"):
            await EventAttendancePetitionService(db_session).submit(
                event_id, member, _ask()
            )

    async def test_one_request_per_member_per_event(self, db_session, dept):
        event_id = await _event(db_session, dept["org"], dept["organizer"])
        member = await _load(db_session, dept["member"])
        service = EventAttendancePetitionService(db_session)
        await service.submit(event_id, member, _ask())

        member = await _load(db_session, dept["member"])
        with pytest.raises(ValueError, match="already requested"):
            await service.submit(event_id, member, _ask("Again"))

    async def test_another_departments_event_is_not_found(self, db_session, dept):
        other_org = await _org(db_session)
        event_id = await _event(db_session, other_org, None)
        member = await _load(db_session, dept["member"])

        with pytest.raises(PetitionNotFound):
            await EventAttendancePetitionService(db_session).submit(
                event_id, member, _ask()
            )


class TestDecide:
    async def _pending(self, db_session, dept, **event_kwargs):
        event_id = await _event(
            db_session, dept["org"], dept["organizer"], **event_kwargs
        )
        member = await _load(db_session, dept["member"])
        petition = await EventAttendancePetitionService(db_session).submit(
            event_id, member, _ask()
        )
        return event_id, petition

    @staticmethod
    def _times(hours_ago: float = 5):
        start = datetime.now(timezone.utc) - timedelta(hours=hours_ago)
        return AttendancePetitionApprove(
            check_in_at=start,
            check_out_at=start + timedelta(minutes=90),
            review_note="Saw you on the ladder",
        )

    async def test_the_organizer_approves_without_events_manage(self, db_session, dept):
        event_id, petition = await self._pending(db_session, dept)
        organizer = await _load(db_session, dept["organizer"])
        times = self._times()

        decided = await EventAttendancePetitionService(db_session).approve(
            event_id, petition.id, organizer, times
        )

        assert decided.status == AttendancePetitionStatus.APPROVED
        assert decided.reviewed_by == dept["organizer"]
        rsvp = (
            await db_session.execute(
                select(EventRSVP).where(
                    EventRSVP.event_id == event_id,
                    EventRSVP.user_id == dept["member"],
                )
            )
        ).scalar_one()
        # The fields finalize credits from, exactly as Edit Times writes them.
        assert rsvp.checked_in is True
        assert rsvp.override_duration_minutes == 90
        assert rsvp.overridden_by == dept["organizer"]
        assert rsvp.override_check_in_at is not None
        # The member is told; the organizer's prompt is archived.
        assert await _notices(db_session, dept["member"], MEMBER_UPDATE_CATEGORY)
        prompt = (
            await _notices(db_session, dept["organizer"], REVIEW_PROMPT_CATEGORY)
        )[0]
        await db_session.refresh(prompt)
        assert prompt.read is True
        assert prompt.expires_at is not None

    async def test_an_event_manager_can_decide_too(self, db_session, dept):
        event_id, petition = await self._pending(db_session, dept)
        manager = await _load(db_session, dept["manager"])

        decided = await EventAttendancePetitionService(db_session).reject(
            event_id,
            petition.id,
            manager,
            AttendancePetitionReject(review_note="Not on the sign-in sheet"),
        )

        assert decided.status == AttendancePetitionStatus.REJECTED
        assert decided.review_note == "Not on the sign-in sheet"
        notice = (await _notices(db_session, dept["member"], MEMBER_UPDATE_CATEGORY))[0]
        assert "Not on the sign-in sheet" in notice.message

    async def test_anyone_else_may_not(self, db_session, dept):
        event_id, petition = await self._pending(db_session, dept)
        bystander = await _load(db_session, dept["bystander"])
        service = EventAttendancePetitionService(db_session)

        with pytest.raises(PermissionError):
            await service.approve(event_id, petition.id, bystander, self._times())
        with pytest.raises(PermissionError):
            await service.list_for_event(event_id, bystander)

    async def test_nobody_decides_their_own_request(self, db_session, dept):
        event_id = await _event(db_session, dept["org"], dept["organizer"])
        manager = await _load(db_session, dept["manager"])
        service = EventAttendancePetitionService(db_session)
        petition = await service.submit(event_id, manager, _ask())

        manager = await _load(db_session, dept["manager"])
        with pytest.raises(PermissionError, match="your own"):
            await service.approve(event_id, petition.id, manager, self._times())

    async def test_a_decided_request_stays_decided(self, db_session, dept):
        event_id, petition = await self._pending(db_session, dept)
        organizer = await _load(db_session, dept["organizer"])
        service = EventAttendancePetitionService(db_session)
        await service.reject(
            event_id, petition.id, organizer, AttendancePetitionReject(review_note="No")
        )

        manager = await _load(db_session, dept["manager"])
        with pytest.raises(ValueError, match="already been decided"):
            await service.approve(event_id, petition.id, manager, self._times())

    async def test_approval_waits_for_attendance_to_be_reopened(self, db_session, dept):
        event_id, petition = await self._pending(db_session, dept, finalized=True)
        organizer = await _load(db_session, dept["organizer"])

        with pytest.raises(ValueError, match="has been finalized") as excinfo:
            await EventAttendancePetitionService(db_session).approve(
                event_id, petition.id, organizer, self._times()
            )
        assert str(excinfo.value).startswith(ATTENDANCE_LOCKED_PREFIX)

    async def test_a_future_check_out_is_refused(self, db_session, dept):
        event_id, petition = await self._pending(db_session, dept)
        organizer = await _load(db_session, dept["organizer"])

        with pytest.raises(ValueError, match="future"):
            await EventAttendancePetitionService(db_session).approve(
                event_id, petition.id, organizer, self._times(hours_ago=1)
            )

    async def test_the_review_list_puts_pending_first(self, db_session, dept):
        event_id, first = await self._pending(db_session, dept)
        organizer = await _load(db_session, dept["organizer"])
        service = EventAttendancePetitionService(db_session)
        await service.reject(
            event_id, first.id, organizer, AttendancePetitionReject(review_note="No")
        )
        bystander = await _load(db_session, dept["bystander"])
        second = await service.submit(event_id, bystander, _ask())

        organizer = await _load(db_session, dept["organizer"])
        listed = await service.list_for_event(event_id, organizer)

        assert [p.id for p in listed] == [second.id, first.id]


def test_a_rejection_needs_a_reason():
    with pytest.raises(ValidationError, match="must not be blank"):
        AttendancePetitionReject(review_note="   ")


def test_requested_times_must_be_in_order():
    now = datetime.now(timezone.utc)
    with pytest.raises(ValidationError, match="Departure time must be after"):
        AttendancePetitionCreate(
            reason="x", requested_check_in_at=now, requested_check_out_at=now
        )


class TestOwnStanding:
    async def test_an_eligible_member_may_ask(self, db_session, dept):
        event_id = await _event(db_session, dept["org"], dept["organizer"])
        member = await _load(db_session, dept["member"])

        petition, refusal = await EventAttendancePetitionService(db_session).get_own(
            event_id, member
        )

        assert petition is None
        assert refusal is None

    async def test_a_back_filled_check_in_counts_as_present(self, db_session, dept):
        event_id = await _event(db_session, dept["org"], dept["organizer"])
        db_session.add(
            EventRSVP(
                organization_id=dept["org"],
                event_id=event_id,
                user_id=dept["member"],
                status="going",
                checked_in=False,
                override_check_in_at=datetime.now(timezone.utc) - timedelta(hours=4),
            )
        )
        await db_session.flush()
        member = await _load(db_session, dept["member"])

        petition, refusal = await EventAttendancePetitionService(db_session).get_own(
            event_id, member
        )

        assert petition is None
        assert refusal == "You are already recorded as present at this event"

    async def test_an_earlier_request_is_returned_and_closes_the_door(
        self, db_session, dept
    ):
        event_id = await _event(db_session, dept["org"], dept["organizer"])
        member = await _load(db_session, dept["member"])
        service = EventAttendancePetitionService(db_session)
        submitted = await service.submit(event_id, member, _ask())

        member = await _load(db_session, dept["member"])
        petition, refusal = await service.get_own(event_id, member)

        assert petition is not None
        assert petition.id == submitted.id
        assert refusal is not None

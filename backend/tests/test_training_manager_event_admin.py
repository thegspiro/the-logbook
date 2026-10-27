"""A training manager edits a Training event and closes and reopens its
attendance.

Editing an event, closing its attendance (Finalize, End Event, Record Times)
and reopening it answered only to ``events.manage`` and, for reopening,
``events.reopen_attendance``. On a Training event every one of those steps
decides training credit, so ``training.manage`` now reaches them too — on
Training events only, and without the power to make the event something
other than Training.

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
from app.models.event import Event
from app.models.user import User
from app.schemas.event import (
    EventUpdate,
    RecordActualTimes,
    ReopenAttendanceRequest,
)

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
    event_type: str,
    started_ago: timedelta = timedelta(hours=14),
    parent_id=None,
    is_recurring: bool = False,
    title: str = "Pump Ops",
) -> str:
    """By default an event that ended last night and has not been finalized."""
    event_id = _uid()
    start = datetime.now(timezone.utc) - started_ago
    await db.execute(
        text(
            "INSERT INTO events (id, organization_id, title, event_type, "
            "start_datetime, end_datetime, requires_rsvp, is_mandatory, "
            "is_cancelled, is_draft, reminder_schedule, check_in_window_type, "
            "is_recurring, recurrence_pattern, recurrence_parent_id) "
            "VALUES (:id, :org, :title, :type, :start, :end, 0, 0, 0, 0, "
            "'[24]', 'flexible', :recurring, :pattern, :parent)"
        ),
        {
            "id": event_id,
            "org": org_id,
            "title": title,
            "type": event_type,
            "start": start,
            "end": start + timedelta(hours=2),
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


async def _refused(call) -> HTTPException:
    with pytest.raises(HTTPException) as exc:
        await call
    return exc.value


@pytest.fixture(autouse=True)
def audit():
    with patch.object(events, "log_audit_event", AsyncMock()) as logged:
        yield logged


@pytest.fixture
async def dept(db_session):
    org_id = await _org(db_session)
    training_pos = await _position(
        db_session, org_id, "training-officer", ["training.manage"]
    )
    reopen_pos = await _position(
        db_session, org_id, "records-officer", ["events.reopen_attendance"]
    )
    ids = {
        "org": org_id,
        "training_manager": await _user(db_session, org_id, "Tara", training_pos),
        "reopener": await _user(db_session, org_id, "Rey", reopen_pos),
        "member": await _user(db_session, org_id, "Sam"),
    }
    ids["training"] = await _event(db_session, org_id, event_type="training")
    ids["meeting"] = await _event(db_session, org_id, event_type="business_meeting")
    await db_session.flush()
    return ids


async def _edit(db, dept, event_key, actor_key, **change):
    return await events.update_event(
        event_id=uuid.UUID(dept[event_key]),
        event_data=EventUpdate(**change),
        db=db,
        current_user=await _load(db, dept[actor_key]),
    )


async def _finalize(db, dept, event_key, actor_key):
    return await events.finalize_attendance(
        event_id=uuid.UUID(dept[event_key]),
        db=db,
        current_user=await _load(db, dept[actor_key]),
    )


async def _reopen(db, dept, event_key, actor_key):
    return await events.reopen_attendance(
        event_id=uuid.UUID(dept[event_key]),
        body=ReopenAttendanceRequest(),
        db=db,
        current_user=await _load(db, dept[actor_key]),
    )


class TestEditingATrainingEvent:
    async def test_edits_it(self, db_session, dept, audit):
        response = await _edit(
            db_session, dept, "training", "training_manager", title="Pump Ops II"
        )

        assert response.title == "Pump Ops II"
        assert audit.await_args.kwargs["event_data"]["acting_as"] == (
            "training_manager"
        )

    async def test_keeps_the_type_when_the_form_resends_it(self, db_session, dept):
        response = await _edit(
            db_session,
            dept,
            "training",
            "training_manager",
            event_type="training",
            description="Bring gloves",
        )

        assert response.description == "Bring gloves"

    async def test_cannot_make_it_another_type(self, db_session, dept):
        refused = await _refused(
            _edit(
                db_session,
                dept,
                "training",
                "training_manager",
                event_type="business_meeting",
            )
        )

        assert refused.status_code == 403
        event = await _get_event(db_session, dept["training"])
        assert event.event_type.value == "training"

    async def test_cannot_edit_an_event_that_is_not_training(self, db_session, dept):
        refused = await _refused(
            _edit(db_session, dept, "meeting", "training_manager", title="Mine now")
        )

        assert refused.status_code == 403
        assert (await _get_event(db_session, dept["meeting"])).title == "Pump Ops"

    async def test_a_member_without_the_grant_is_refused(self, db_session, dept):
        refused = await _refused(
            _edit(db_session, dept, "training", "member", title="Mine now")
        )

        assert refused.status_code == 403

    async def test_another_departments_event_is_not_found(self, db_session, dept):
        foreign = await _event(
            db_session, await _org(db_session), event_type="training"
        )

        refused = await _refused(
            events.update_event(
                event_id=uuid.UUID(foreign),
                event_data=EventUpdate(title="Mine now"),
                db=db_session,
                current_user=await _load(db_session, dept["training_manager"]),
            )
        )

        assert refused.status_code == 404


class TestEditingATrainingSeries:
    async def _series(self, db, dept, second_type: str):
        parent = await _event(
            db,
            dept["org"],
            event_type="training",
            started_ago=-timedelta(days=1),
            is_recurring=True,
        )
        child = await _event(
            db,
            dept["org"],
            event_type=second_type,
            started_ago=-timedelta(days=8),
            parent_id=parent,
        )
        await db.flush()
        return parent, child

    async def test_edits_every_upcoming_occurrence(self, db_session, dept):
        parent, child = await self._series(db_session, dept, "training")

        response = await events.update_future_events(
            event_id=uuid.UUID(parent),
            event_data=EventUpdate(description="New drill plan"),
            db=db_session,
            current_user=await _load(db_session, dept["training_manager"]),
        )

        assert response["updated_count"] == 2
        assert (await _get_event(db_session, child)).description == "New drill plan"

    async def test_refuses_a_series_holding_another_type(self, db_session, dept):
        """An occurrence an events manager re-typed is no longer the training
        manager's, and a series edit would otherwise reach it."""
        parent, child = await self._series(db_session, dept, "business_meeting")

        refused = await _refused(
            events.update_future_events(
                event_id=uuid.UUID(parent),
                event_data=EventUpdate(description="New drill plan"),
                db=db_session,
                current_user=await _load(db_session, dept["training_manager"]),
            )
        )

        assert refused.status_code == 403
        assert (await _get_event(db_session, child)).description is None


class TestClosingAndReopeningAttendance:
    async def test_finalizes_a_training_event(self, db_session, dept):
        await _finalize(db_session, dept, "training", "training_manager")

        event = await _get_event(db_session, dept["training"])
        assert event.attendance_finalized_at is not None
        assert str(event.attendance_finalized_by) == dept["training_manager"]

    async def test_cannot_finalize_an_event_that_is_not_training(
        self, db_session, dept
    ):
        refused = await _refused(
            _finalize(db_session, dept, "meeting", "training_manager")
        )

        assert refused.status_code == 403
        assert (
            await _get_event(db_session, dept["meeting"])
        ).attendance_finalized_at is None

    async def test_reopens_a_training_event_they_finalized(
        self, db_session, dept, audit
    ):
        """The department chose this over requiring a second person: the
        audit row is what records it."""
        await _finalize(db_session, dept, "training", "training_manager")

        await _reopen(db_session, dept, "training", "training_manager")

        event = await _get_event(db_session, dept["training"])
        assert event.attendance_finalized_at is None
        reopened = audit.await_args.kwargs
        assert reopened["event_type"] == "event_attendance_reopened"
        assert reopened["event_data"]["acting_as"] == "training_manager"

    async def test_cannot_reopen_an_event_that_is_not_training(self, db_session, dept):
        meeting = await _get_event(db_session, dept["meeting"])
        meeting.attendance_finalized_at = datetime.now(timezone.utc)
        await db_session.flush()

        refused = await _refused(
            _reopen(db_session, dept, "meeting", "training_manager")
        )

        assert refused.status_code == 403
        assert (
            await _get_event(db_session, dept["meeting"])
        ).attendance_finalized_at is not None

    async def test_the_reopen_grant_still_reopens_any_event(self, db_session, dept):
        meeting = await _get_event(db_session, dept["meeting"])
        meeting.attendance_finalized_at = datetime.now(timezone.utc)
        await db_session.flush()

        await _reopen(db_session, dept, "meeting", "reopener")

        assert (
            await _get_event(db_session, dept["meeting"])
        ).attendance_finalized_at is None

    async def test_records_times_on_a_training_event(self, db_session, dept):
        event = await _get_event(db_session, dept["training"])
        end = event.end_datetime

        await events.record_actual_times(
            event_id=uuid.UUID(dept["training"]),
            times_data=RecordActualTimes(actual_end_time=end),
            db=db_session,
            current_user=await _load(db_session, dept["training_manager"]),
        )

        event = await _get_event(db_session, dept["training"])
        assert event.actual_end_time is not None
        assert event.attendance_finalized_at is not None

    async def test_ends_a_training_event_in_progress(self, db_session, dept):
        happening_now = await _event(
            db_session,
            dept["org"],
            event_type="training",
            started_ago=timedelta(minutes=30),
        )

        await events.end_event(
            event_id=uuid.UUID(happening_now),
            db=db_session,
            current_user=await _load(db_session, dept["training_manager"]),
        )

        assert (await _get_event(db_session, happening_now)).actual_end_time

    async def test_cannot_end_an_event_that_is_not_training(self, db_session, dept):
        happening_now = await _event(
            db_session,
            dept["org"],
            event_type="business_meeting",
            started_ago=timedelta(minutes=30),
        )

        refused = await _refused(
            events.end_event(
                event_id=uuid.UUID(happening_now),
                db=db_session,
                current_user=await _load(db_session, dept["training_manager"]),
            )
        )

        assert refused.status_code == 403
        assert (await _get_event(db_session, happening_now)).actual_end_time is None


class TestTheFlagsThePageReads:
    """``can_edit_event`` and ``can_reopen_attendance`` come from the function
    the routes gate on."""

    @pytest.mark.parametrize(
        ("actor", "event_key", "expected"),
        [
            ("training_manager", "training", True),
            ("training_manager", "meeting", False),
            ("member", "training", False),
        ],
    )
    async def test_flags(self, db_session, dept, actor, event_key, expected):
        event = await _get_event(db_session, dept[event_key])
        user = await _load(db_session, dept[actor])

        assert events.training_manager_administers(event, user) is expected

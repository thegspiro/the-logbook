"""An event edit carries the event's training details in the same save.

The single training-event form edits a Training event and its session
together, through ``PATCH /events/{id}`` and ``PATCH /events/{id}/update-future``.
Until 2026-11-11 neither carried training details: the session was edited
from a card on the event page, one save per concern, and a "this and all
future events" edit could not reach the sessions at all.

Against real rows, read back with raw SQL so an identity map cannot report a
write that never landed.
"""

import re
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints import events as events_endpoint
from app.models.training import (
    RequirementFrequency,
    RequirementSource,
    RequirementType,
    TrainingCourse,
    TrainingRequirement,
    TrainingType,
)
from app.models.user import User
from app.schemas.event import EventCreate, EventUpdate
from app.schemas.training_session import (
    TrainingSessionAttach,
    TrainingSessionDetailsUpdate,
)
from app.services.event_service import ATTENDANCE_LOCKED_PREFIX, EventService
from app.services.training_session_service import (
    ATTENDANCE_REQUIREMENT_NOT_LINKABLE,
)

pytestmark = [pytest.mark.integration]

ATTENDANCE_LOCKED_PATTERN = "^" + re.escape(ATTENDANCE_LOCKED_PREFIX)


def _uid() -> str:
    return str(uuid.uuid4())


async def _insert_org(db: AsyncSession) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, "
            "timezone, settings) "
            "VALUES (:id, 'Test Dept', 'fire_department', :slug, 'UTC', '{}')"
        ),
        {"id": org_id, "slug": f"org-{org_id[:8]}"},
    )
    return org_id


async def _insert_position(db: AsyncSession, org_id: str, permissions) -> str:
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
            "slug": f"pos-{position_id[:8]}",
            "perms": '["' + '","'.join(permissions) + '"]',
        },
    )
    return position_id


async def _insert_user(db: AsyncSession, org_id: str, first: str, position=None) -> str:
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
    if position:
        await db.execute(
            text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
            {"u": user_id, "p": position},
        )
    return user_id


async def _requirement(db: AsyncSession, org_id: str, requirement_type) -> str:
    requirement = TrainingRequirement(
        id=_uid(),
        organization_id=org_id,
        name=f"Req {uuid.uuid4().hex[:6]}",
        requirement_type=requirement_type,
        source=RequirementSource.DEPARTMENT,
        frequency=RequirementFrequency.ANNUAL,
        required_attendance_pct=60,
        required_hours=10,
    )
    db.add(requirement)
    await db.flush()
    return str(requirement.id)


async def _course(db: AsyncSession, org_id: str) -> str:
    course = TrainingCourse(
        id=_uid(),
        organization_id=org_id,
        name="Pump Operations I",
        code="PO1",
        training_type=TrainingType.CERTIFICATION,
        credit_hours=6.0,
    )
    db.add(course)
    await db.flush()
    return str(course.id)


@pytest.fixture
async def dept(db_session: AsyncSession):
    org = await _insert_org(db_session)
    trainer = await _insert_position(db_session, org, ["training.manage"])
    events_manager = await _insert_position(db_session, org, ["events.manage"])
    ids = {
        "org": org,
        "officer": await _insert_user(db_session, org, "Officer", events_manager),
        "training_manager": await _insert_user(db_session, org, "Tara", trainer),
        "drills": await _requirement(
            db_session, org, RequirementType.SESSION_ATTENDANCE
        ),
        "meetings": await _requirement(
            db_session, org, RequirementType.SESSION_ATTENDANCE
        ),
    }
    await db_session.flush()
    return ids


def _window(days_ahead: int = 7, hours: int = 3):
    start = (datetime.now(timezone.utc) + timedelta(days=days_ahead)).replace(
        hour=18, minute=0, second=0, microsecond=0
    )
    return start, start + timedelta(hours=hours)


async def _event(db, dept, details=None, *, title="Monday Drill", window=None) -> str:
    start, end = window or _window()
    event = await EventService(db).create_event(
        EventCreate(
            title=title,
            event_type="training",
            start_datetime=start,
            end_datetime=end,
            requires_rsvp=False,
            training_details=(
                TrainingSessionAttach(**details) if details is not None else None
            ),
        ),
        organization_id=dept["org"],
        created_by=dept["officer"],
    )
    return str(event.id)


async def _finalize(db, event_id: str) -> None:
    await db.execute(
        text("UPDATE events SET attendance_finalized_at = :at WHERE id = :e"),
        {"at": datetime.now(timezone.utc), "e": event_id},
    )
    await db.execute(
        text("UPDATE training_sessions SET is_finalized = 1 WHERE event_id = :e"),
        {"e": event_id},
    )


async def _edit(db, dept, event_id, **change):
    return await EventService(db).update_event(
        event_id, dept["org"], EventUpdate(**change), dept["officer"]
    )


async def _session(db, event_id: str):
    result = await db.execute(
        text(
            "SELECT id, course_id, course_name, course_code, training_type, "
            "credit_hours, instructor FROM training_sessions WHERE event_id = :e"
        ),
        {"e": event_id},
    )
    row = result.one_or_none()
    return None if row is None else dict(row._mapping)


async def _links(db, event_id: str) -> set:
    result = await db.execute(
        text(
            "SELECT r.requirement_id FROM training_session_requirements r "
            "JOIN training_sessions s ON s.id = r.session_id WHERE s.event_id = :e"
        ),
        {"e": event_id},
    )
    return {str(r) for r in result.scalars().all()}


# What the form re-sends for an event made with no details: every field,
# at the values a session-less Training event already credits.
UNTOUCHED_FORM = {
    "course_id": None,
    "course_name": None,
    "course_code": None,
    "category_id": None,
    "program_id": None,
    "phase_id": None,
    "requirement_id": None,
    "training_type": "continuing_education",
    "credit_hours": None,
    "instructor": None,
    "instructor_id": None,
    "issues_certification": False,
    "certification_number_prefix": None,
    "issuing_agency": None,
    "expiration_months": None,
    "counts_toward_certification": True,
    "auto_create_records": True,
    "require_completion_confirmation": False,
    "approval_deadline_days": 7,
    "attendance_requirement_ids": [],
}


class TestASingleEvent:
    async def test_the_details_and_links_are_saved_with_the_event(
        self, db_session, dept
    ):
        event_id = await _event(db_session, dept, {})

        await _edit(
            db_session,
            dept,
            event_id,
            description="Bring gloves",
            training_details=TrainingSessionDetailsUpdate(
                instructor="Lt. Okafor",
                credit_hours=2.5,
                attendance_requirement_ids=[dept["drills"], dept["meetings"]],
            ),
        )

        session = await _session(db_session, event_id)
        assert session["instructor"] == "Lt. Okafor"
        assert session["credit_hours"] == 2.5
        assert await _links(db_session, event_id) == {dept["drills"], dept["meetings"]}

    async def test_the_links_sent_replace_the_whole_set(self, db_session, dept):
        event_id = await _event(
            db_session,
            dept,
            {"attendance_requirement_ids": [dept["drills"], dept["meetings"]]},
        )

        await _edit(
            db_session,
            dept,
            event_id,
            training_details=TrainingSessionDetailsUpdate(
                attendance_requirement_ids=[dept["meetings"]]
            ),
        )

        assert await _links(db_session, event_id) == {dept["meetings"]}

    async def test_a_field_left_out_is_untouched(self, db_session, dept):
        event_id = await _event(
            db_session,
            dept,
            {
                "instructor": "Lt. Okafor",
                "attendance_requirement_ids": [dept["drills"]],
            },
        )

        await _edit(
            db_session,
            dept,
            event_id,
            training_details=TrainingSessionDetailsUpdate(credit_hours=1.0),
        )

        session = await _session(db_session, event_id)
        assert session["instructor"] == "Lt. Okafor"
        assert await _links(db_session, event_id) == {dept["drills"]}

    async def test_clearing_the_course_files_it_under_the_title(self, db_session, dept):
        course = await _course(db_session, dept["org"])
        event_id = await _event(db_session, dept, {"course_id": course})

        await _edit(
            db_session,
            dept,
            event_id,
            training_details=TrainingSessionDetailsUpdate(course_id=None),
        )

        session = await _session(db_session, event_id)
        assert session["course_id"] is None
        assert session["course_name"] == "Monday Drill"
        assert session["course_code"] is None

    async def test_a_one_off_name_replaces_the_course(self, db_session, dept):
        course = await _course(db_session, dept["org"])
        event_id = await _event(db_session, dept, {"course_id": course})

        await _edit(
            db_session,
            dept,
            event_id,
            training_details=TrainingSessionDetailsUpdate(
                course_id=None, course_name="Ladder Throws"
            ),
        )

        session = await _session(db_session, event_id)
        assert (session["course_id"], session["course_name"]) == (
            None,
            "Ladder Throws",
        )

    async def test_cleared_hours_credit_the_scheduled_length(self, db_session, dept):
        event_id = await _event(
            db_session, dept, {"credit_hours": 1.0}, window=_window(hours=3)
        )

        await _edit(
            db_session,
            dept,
            event_id,
            training_details=TrainingSessionDetailsUpdate(credit_hours=None),
        )

        assert (await _session(db_session, event_id))["credit_hours"] == 3.0

    async def test_the_type_cannot_be_cleared(self, db_session, dept):
        event_id = await _event(db_session, dept, {})

        with pytest.raises(ValueError, match="Training type is required"):
            await _edit(
                db_session,
                dept,
                event_id,
                training_details=TrainingSessionDetailsUpdate(training_type=None),
            )

    async def test_another_event_type_is_refused(self, db_session, dept):
        start, end = _window()
        meeting = await EventService(db_session).create_event(
            EventCreate(
                title="Business Meeting",
                event_type="business_meeting",
                start_datetime=start,
                end_datetime=end,
                requires_rsvp=False,
            ),
            dept["org"],
            dept["officer"],
        )

        with pytest.raises(ValueError, match="only be added to a Training event"):
            await _edit(
                db_session,
                dept,
                str(meeting.id),
                training_details=TrainingSessionDetailsUpdate(instructor="Lt. Okafor"),
            )

    async def test_a_session_attendance_requirement_is_refused_as_a_new_link(
        self, db_session, dept
    ):
        event_id = await _event(db_session, dept, {})

        with pytest.raises(ValueError, match="graded by session attendance") as refused:
            await _edit(
                db_session,
                dept,
                event_id,
                training_details=TrainingSessionDetailsUpdate(
                    requirement_id=dept["drills"]
                ),
            )

        assert str(refused.value) == ATTENDANCE_REQUIREMENT_NOT_LINKABLE

    async def test_a_session_attendance_requirement_already_stored_still_saves(
        self, db_session, dept
    ):
        event_id = await _event(db_session, dept, {})
        await db_session.execute(
            text(
                "UPDATE training_sessions SET requirement_id = :r WHERE event_id = :e"
            ),
            {"r": dept["drills"], "e": event_id},
        )

        await _edit(
            db_session,
            dept,
            event_id,
            training_details=TrainingSessionDetailsUpdate(
                requirement_id=dept["drills"], instructor="Lt. Okafor"
            ),
        )

        assert (await _session(db_session, event_id))["instructor"] == "Lt. Okafor"


class TestAnEventMadeWithoutDetails:
    async def test_re_sending_the_untouched_form_attaches_nothing(
        self, db_session, dept
    ):
        event_id = await _event(db_session, dept)

        await _edit(
            db_session,
            dept,
            event_id,
            description="Bring gloves",
            training_details=TrainingSessionDetailsUpdate(**UNTOUCHED_FORM),
        )

        assert await _session(db_session, event_id) is None

    async def test_a_detail_attaches_a_session(self, db_session, dept):
        course = await _course(db_session, dept["org"])
        event_id = await _event(db_session, dept)

        await _edit(
            db_session,
            dept,
            event_id,
            training_details=TrainingSessionDetailsUpdate(
                **{
                    **UNTOUCHED_FORM,
                    "course_id": course,
                    "training_type": "certification",
                }
            ),
        )

        session = await _session(db_session, event_id)
        assert session["course_id"] == course
        assert session["course_name"] == "Pump Operations I"

    async def test_links_alone_attach_a_session(self, db_session, dept):
        event_id = await _event(db_session, dept)

        await _edit(
            db_session,
            dept,
            event_id,
            training_details=TrainingSessionDetailsUpdate(
                **{**UNTOUCHED_FORM, "attendance_requirement_ids": [dept["drills"]]}
            ),
        )

        assert await _links(db_session, event_id) == {dept["drills"]}

    async def test_once_finalized_it_refuses_a_detail(self, db_session, dept):
        event_id = await _event(db_session, dept)
        await _finalize(db_session, event_id)

        with pytest.raises(ValueError, match=ATTENDANCE_LOCKED_PATTERN) as refused:
            await _edit(
                db_session,
                dept,
                event_id,
                training_details=TrainingSessionDetailsUpdate(instructor="Lt. Okafor"),
            )

        assert str(refused.value).startswith(ATTENDANCE_LOCKED_PREFIX)
        assert await _session(db_session, event_id) is None

    async def test_once_finalized_the_untouched_form_still_saves(
        self, db_session, dept
    ):
        event_id = await _event(db_session, dept)
        await _finalize(db_session, event_id)

        await _edit(
            db_session,
            dept,
            event_id,
            title="Monday Drill (Station 2)",
            training_details=TrainingSessionDetailsUpdate(**UNTOUCHED_FORM),
        )

        assert await _session(db_session, event_id) is None


class TestAFinalizedEvent:
    async def test_its_links_may_change(self, db_session, dept):
        event_id = await _event(db_session, dept, {})
        await _finalize(db_session, event_id)

        await _edit(
            db_session,
            dept,
            event_id,
            training_details=TrainingSessionDetailsUpdate(
                attendance_requirement_ids=[dept["drills"]]
            ),
        )

        assert await _links(db_session, event_id) == {dept["drills"]}

    async def test_the_whole_form_re_sent_with_a_title_fix_saves(
        self, db_session, dept
    ):
        """The form sends every field. Restating what is stored is no change,
        and a session filed under the title follows the renamed event before
        the details are compared."""
        event_id = await _event(db_session, dept, {}, window=_window(hours=3))
        await _finalize(db_session, event_id)

        await _edit(
            db_session,
            dept,
            event_id,
            title="Monday Drill (Station 2)",
            training_details=TrainingSessionDetailsUpdate(
                **{**UNTOUCHED_FORM, "attendance_requirement_ids": [dept["drills"]]}
            ),
        )

        session = await _session(db_session, event_id)
        assert session["course_name"] == "Monday Drill (Station 2)"
        assert await _links(db_session, event_id) == {dept["drills"]}

    async def test_a_changed_detail_is_refused_and_nothing_is_written(
        self, db_session, dept
    ):
        event_id = await _event(db_session, dept, {"instructor": "Lt. Okafor"})
        await _finalize(db_session, event_id)

        with pytest.raises(ValueError, match=ATTENDANCE_LOCKED_PATTERN) as refused:
            await _edit(
                db_session,
                dept,
                event_id,
                training_details=TrainingSessionDetailsUpdate(
                    instructor="Capt. Reyes",
                    attendance_requirement_ids=[dept["drills"]],
                ),
            )

        assert str(refused.value).startswith(ATTENDANCE_LOCKED_PREFIX)
        assert "instructor" in str(refused.value)
        assert (await _session(db_session, event_id))["instructor"] == "Lt. Okafor"
        assert await _links(db_session, event_id) == set()


class TestAFormThatRestatesWhatItRead:
    """The form sends the course name it loaded. On a save that also renames
    the event, a session filed under the title has already followed the new
    title, so the old name it restates must not read as a change."""

    async def test_a_finalized_event_s_title_fix_saves(self, db_session, dept):
        event_id = await _event(db_session, dept, {})
        await _finalize(db_session, event_id)

        await _edit(
            db_session,
            dept,
            event_id,
            title="Monday Drill (Station 2)",
            training_details=TrainingSessionDetailsUpdate(course_name="Monday Drill"),
        )

        session = await _session(db_session, event_id)
        assert session["course_name"] == "Monday Drill (Station 2)"

    async def test_an_open_event_s_session_keeps_following_the_title(
        self, db_session, dept
    ):
        event_id = await _event(db_session, dept, {})

        await _edit(
            db_session,
            dept,
            event_id,
            title="Monday Drill (Station 2)",
            training_details=TrainingSessionDetailsUpdate(course_name="Monday Drill"),
        )

        session = await _session(db_session, event_id)
        assert session["course_name"] == "Monday Drill (Station 2)"

    async def test_a_new_one_off_name_is_still_taken(self, db_session, dept):
        event_id = await _event(db_session, dept, {})

        await _edit(
            db_session,
            dept,
            event_id,
            title="Monday Drill (Station 2)",
            training_details=TrainingSessionDetailsUpdate(course_name="Ladder Throws"),
        )

        session = await _session(db_session, event_id)
        assert session["course_name"] == "Ladder Throws"


class TestABlankMeansWhatItMeansOnCreate:
    """A blank hours, instructor or expiry is filled from the session's library
    course on create; an update's null must mean the same, or re-sending a
    blank the form read would change the credit."""

    async def _event_with_course(self, db, dept) -> str:
        course = TrainingCourse(
            id=_uid(),
            organization_id=dept["org"],
            name="Pump Operations I",
            code="PO1",
            training_type=TrainingType.CERTIFICATION,
            credit_hours=6.0,
            instructor="Capt. Reyes",
            expiration_months=24,
        )
        db.add(course)
        await db.flush()
        return await _event(
            db, dept, {"course_id": str(course.id)}, window=_window(hours=3)
        )

    async def test_blank_hours_instructor_and_expiry_stay_the_course_s(
        self, db_session, dept
    ):
        event_id = await self._event_with_course(db_session, dept)

        await _edit(
            db_session,
            dept,
            event_id,
            training_details=TrainingSessionDetailsUpdate(
                credit_hours=None, instructor=None, expiration_months=None
            ),
        )

        result = await db_session.execute(
            text(
                "SELECT credit_hours, instructor, expiration_months "
                "FROM training_sessions WHERE event_id = :e"
            ),
            {"e": event_id},
        )
        assert tuple(result.one()) == (6.0, "Capt. Reyes", 24)

    async def test_a_finalized_event_re_sending_blanks_still_saves(
        self, db_session, dept
    ):
        event_id = await self._event_with_course(db_session, dept)
        await _finalize(db_session, event_id)

        await _edit(
            db_session,
            dept,
            event_id,
            description="Bring gloves",
            training_details=TrainingSessionDetailsUpdate(
                credit_hours=None, instructor=None, expiration_months=None
            ),
        )

        assert (await _session(db_session, event_id))["credit_hours"] == 6.0


class TestASeries:
    async def _series(self, db, dept, details) -> list:
        start, end = _window(days_ahead=-14)
        events, error = await EventService(db).create_recurring_event(
            {
                "title": "Weekly Drill",
                "event_type": "training",
                "start_datetime": start,
                "end_datetime": end,
                "requires_rsvp": False,
                "recurrence_pattern": "weekly",
                "recurrence_end_date": start + timedelta(days=35),
                "training_details": details,
            },
            dept["org"],
            dept["officer"],
        )
        assert error is None
        return [str(e.id) for e in sorted(events, key=lambda e: e.start_datetime)]

    async def _edit_future(self, db, dept, anchor, details):
        return await EventService(db).update_future_events(
            anchor,
            dept["org"],
            EventUpdate(training_details=details),
            dept["officer"],
        )

    async def test_every_later_occurrence_gets_the_details(self, db_session, dept):
        ids = await self._series(db_session, dept, {})

        await self._edit_future(
            db_session,
            dept,
            ids[2],
            TrainingSessionDetailsUpdate(
                instructor="Lt. Okafor", attendance_requirement_ids=[dept["drills"]]
            ),
        )

        for event_id in ids[:2]:
            assert (await _session(db_session, event_id))["instructor"] is None
            assert await _links(db_session, event_id) == set()
        for event_id in ids[2:]:
            assert (await _session(db_session, event_id))["instructor"] == (
                "Lt. Okafor"
            )
            assert await _links(db_session, event_id) == {dept["drills"]}

    async def test_an_occurrence_without_a_session_gets_one(self, db_session, dept):
        ids = await self._series(db_session, dept, {})
        await db_session.execute(
            text("DELETE FROM training_sessions WHERE event_id = :e"), {"e": ids[3]}
        )

        await self._edit_future(
            db_session,
            dept,
            ids[2],
            TrainingSessionDetailsUpdate(instructor="Lt. Okafor"),
        )

        assert (await _session(db_session, ids[3]))["instructor"] == "Lt. Okafor"

    async def test_a_finalized_occurrence_takes_new_links(self, db_session, dept):
        ids = await self._series(db_session, dept, {})
        await _finalize(db_session, ids[2])

        await self._edit_future(
            db_session,
            dept,
            ids[2],
            TrainingSessionDetailsUpdate(attendance_requirement_ids=[dept["drills"]]),
        )

        for event_id in ids[2:]:
            assert await _links(db_session, event_id) == {dept["drills"]}

    async def test_a_locked_change_on_one_occurrence_refuses_the_series(
        self, db_session, dept
    ):
        ids = await self._series(db_session, dept, {})
        await _finalize(db_session, ids[2])

        with pytest.raises(ValueError, match=ATTENDANCE_LOCKED_PATTERN) as refused:
            await self._edit_future(
                db_session,
                dept,
                ids[2],
                TrainingSessionDetailsUpdate(instructor="Lt. Okafor"),
            )

        message = str(refused.value)
        assert message.startswith(ATTENDANCE_LOCKED_PREFIX)
        assert "(1 of 1 finalized occurrence would change)" in message
        for event_id in ids[2:]:
            assert (await _session(db_session, event_id))["instructor"] is None


class TestTheSchema:
    def test_an_unknown_key_is_refused(self):
        with pytest.raises(ValidationError):
            TrainingSessionDetailsUpdate(prerequisites="none")

    def test_a_library_course_and_a_one_off_name_are_not_both_accepted(self):
        with pytest.raises(ValidationError, match="not both"):
            TrainingSessionDetailsUpdate(course_id=uuid.uuid4(), course_name="X")


class TestTheEndpoints:
    @pytest.fixture
    def audit(self):
        with patch.object(events_endpoint, "log_audit_event", AsyncMock()) as logged:
            yield logged

    @staticmethod
    async def _user(db, user_id) -> User:
        result = await db.execute(
            select(User)
            .options(selectinload(User.positions))
            .where(User.id == user_id)
            .execution_options(populate_existing=True)
        )
        return result.scalar_one()

    async def test_a_training_manager_is_refused_the_details(
        self, db_session, dept, audit
    ):
        event_id = await _event(db_session, dept, {})
        manager = await self._user(db_session, dept["training_manager"])
        details = TrainingSessionDetailsUpdate(
            attendance_requirement_ids=[dept["drills"]]
        )

        for route in (
            events_endpoint.update_event,
            events_endpoint.update_future_events,
        ):
            with pytest.raises(HTTPException) as refused:
                await route(
                    event_id=uuid.UUID(event_id),
                    event_data=EventUpdate(training_details=details),
                    db=db_session,
                    current_user=manager,
                )
            assert refused.value.status_code == 403

        assert await _links(db_session, event_id) == set()

    async def test_a_training_manager_still_edits_the_event_itself(
        self, db_session, dept, audit
    ):
        event_id = await _event(db_session, dept, {})
        manager = await self._user(db_session, dept["training_manager"])

        response = await events_endpoint.update_event(
            event_id=uuid.UUID(event_id),
            event_data=EventUpdate(description="Bring gloves"),
            db=db_session,
            current_user=manager,
        )

        assert response.description == "Bring gloves"

    async def test_the_links_chosen_are_audited(self, db_session, dept, audit):
        event_id = await _event(db_session, dept, {})
        officer = await self._user(db_session, dept["officer"])

        await events_endpoint.update_event(
            event_id=uuid.UUID(event_id),
            event_data=EventUpdate(
                training_details=TrainingSessionDetailsUpdate(
                    attendance_requirement_ids=[dept["drills"]]
                )
            ),
            db=db_session,
            current_user=officer,
        )

        [entry] = [
            call.kwargs["event_data"]
            for call in audit.await_args_list
            if call.kwargs["event_type"] == "training_session_updated"
        ]
        assert entry == {
            "event_id": event_id,
            "scope": "this_event",
            "fields": ["attendance_requirement_ids"],
            "action": "attendance_requirements_set",
            "attendance_requirement_ids": [dept["drills"]],
        }

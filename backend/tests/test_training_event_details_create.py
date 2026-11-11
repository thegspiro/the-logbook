"""A Training event is created with its training details in one call.

The single training-event form saves through ``POST /events`` and
``POST /events/recurring``. Until 2026-11-11 those carried only a course,
category, program, requirement and type; instructor, hours, certification,
the completion flags and the "Counts toward attendance" links could be set
only from Training Admin's own form, and an unknown key was silently dropped.

Against real rows, read back with raw SQL so an ORM identity map cannot report
a write that never landed.
"""

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import BackgroundTasks
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

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
from app.schemas.event import EventCreate, RecurringEventCreate, RSVPOverride
from app.schemas.training_session import (
    RecurringTrainingSessionCreate,
    TrainingSessionAttach,
    TrainingSessionCreate,
)
from app.services.event_service import EventService
from app.services.training_session_service import TrainingSessionService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


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


async def _requirement(db: AsyncSession, org_id: str, requirement_type) -> str:
    requirement = TrainingRequirement(
        id=_uid(),
        organization_id=org_id,
        name=f"Drills {uuid.uuid4().hex[:6]}",
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
        instructor="Capt. Reyes",
        expiration_months=24,
    )
    db.add(course)
    await db.flush()
    return str(course.id)


@pytest.fixture
async def dept(db_session: AsyncSession):
    org = await _insert_org(db_session)
    officer = await _insert_user(db_session, org, "Officer")
    member = await _insert_user(db_session, org, "Pat")
    await db_session.flush()
    return org, officer, member


def _window(hours: int = 3, days_ahead: int = 7):
    start = (datetime.now(timezone.utc) + timedelta(days=days_ahead)).replace(
        hour=18, minute=0, second=0, microsecond=0
    )
    return start, start + timedelta(hours=hours)


async def _create(db, org, officer, details: dict, *, title="Monthly Drill", **kw):
    start, end = kw.pop("window", None) or _window()
    event = await EventService(db).create_event(
        EventCreate(
            title=title,
            event_type="training",
            start_datetime=start,
            end_datetime=end,
            requires_rsvp=False,
            training_details=TrainingSessionAttach(**details),
            **kw,
        ),
        organization_id=org,
        created_by=officer,
    )
    return str(event.id)


async def _session_row(db: AsyncSession, event_id: str) -> dict:
    result = await db.execute(
        text(
            "SELECT id, course_id, course_name, course_code, training_type, "
            "credit_hours, instructor, instructor_id, issues_certification, "
            "certification_number_prefix, issuing_agency, expiration_months, "
            "counts_toward_certification, auto_create_records, "
            "require_completion_confirmation, approval_deadline_days "
            "FROM training_sessions WHERE event_id = :e"
        ),
        {"e": event_id},
    )
    row = result.one()
    return dict(row._mapping)


async def _linked(db: AsyncSession, session_id: str) -> set:
    result = await db.execute(
        text(
            "SELECT requirement_id FROM training_session_requirements "
            "WHERE session_id = :s"
        ),
        {"s": session_id},
    )
    return {str(r) for r in result.scalars().all()}


class TestOneCallCreate:
    async def test_the_attendance_links_are_written_with_the_event(
        self, db_session, dept
    ):
        org, officer, _ = dept
        drills = await _requirement(db_session, org, RequirementType.SESSION_ATTENDANCE)
        meetings = await _requirement(
            db_session, org, RequirementType.SESSION_ATTENDANCE
        )

        event_id = await _create(
            db_session,
            org,
            officer,
            {"attendance_requirement_ids": [drills, meetings]},
        )

        session = await _session_row(db_session, event_id)
        assert await _linked(db_session, session["id"]) == {drills, meetings}

    async def test_every_field_the_form_shows_reaches_the_session(
        self, db_session, dept
    ):
        org, officer, member = dept

        event_id = await _create(
            db_session,
            org,
            officer,
            {
                "course_name": "Ladder Throws",
                "course_code": "LT-2",
                "training_type": "skills_practice",
                "credit_hours": 2.5,
                "instructor": "Lt. Okafor",
                "instructor_id": member,
                "issues_certification": True,
                "certification_number_prefix": "LT",
                "issuing_agency": "State Fire Academy",
                "expiration_months": 36,
                "counts_toward_certification": False,
                "auto_create_records": False,
                "require_completion_confirmation": True,
                "approval_deadline_days": 14,
            },
        )

        session = await _session_row(db_session, event_id)
        assert session["course_id"] is None
        assert session["course_name"] == "Ladder Throws"
        assert session["course_code"] == "LT-2"
        assert session["training_type"] == "skills_practice"
        assert session["credit_hours"] == 2.5
        assert session["instructor"] == "Lt. Okafor"
        assert session["instructor_id"] == member
        assert bool(session["issues_certification"]) is True
        assert session["certification_number_prefix"] == "LT"
        assert session["issuing_agency"] == "State Fire Academy"
        assert session["expiration_months"] == 36
        assert bool(session["counts_toward_certification"]) is False
        assert bool(session["auto_create_records"]) is False
        assert bool(session["require_completion_confirmation"]) is True
        assert session["approval_deadline_days"] == 14

    async def test_a_library_course_fills_what_was_left_blank(self, db_session, dept):
        org, officer, _ = dept
        course = await _course(db_session, org)

        event_id = await _create(db_session, org, officer, {"course_id": course})

        session = await _session_row(db_session, event_id)
        assert session["course_id"] == course
        assert session["course_name"] == "Pump Operations I"
        assert session["course_code"] == "PO1"
        assert session["training_type"] == "certification"
        assert session["credit_hours"] == 6.0
        assert session["instructor"] == "Capt. Reyes"
        assert session["expiration_months"] == 24

    async def test_what_the_officer_entered_beats_the_course(self, db_session, dept):
        org, officer, _ = dept
        course = await _course(db_session, org)

        event_id = await _create(
            db_session,
            org,
            officer,
            {
                "course_id": course,
                "training_type": "refresher",
                "credit_hours": 3.0,
                "instructor": "Lt. Okafor",
                "expiration_months": 12,
            },
        )

        session = await _session_row(db_session, event_id)
        assert session["course_name"] == "Pump Operations I"
        assert session["training_type"] == "refresher"
        assert session["credit_hours"] == 3.0
        assert session["instructor"] == "Lt. Okafor"
        assert session["expiration_months"] == 12

    async def test_no_course_is_filed_under_the_title_for_the_scheduled_hours(
        self, db_session, dept
    ):
        org, officer, _ = dept

        event_id = await _create(db_session, org, officer, {}, window=_window(hours=3))

        session = await _session_row(db_session, event_id)
        assert session["course_id"] is None
        assert session["course_name"] == "Monthly Drill"
        assert session["training_type"] == "continuing_education"
        assert session["credit_hours"] == 3.0
        assert bool(session["auto_create_records"]) is True
        assert bool(session["require_completion_confirmation"]) is False

    async def test_another_kind_of_requirement_is_refused_and_nothing_is_written(
        self, db_session, dept
    ):
        org, officer, _ = dept
        hours = await _requirement(db_session, org, RequirementType.HOURS)

        with pytest.raises(ValueError, match="Invalid attendance requirement"):
            await _create(
                db_session,
                org,
                officer,
                {"attendance_requirement_ids": [hours]},
                title="Refused Drill",
            )

        result = await db_session.execute(
            text("SELECT COUNT(*) FROM events WHERE title = 'Refused Drill'")
        )
        assert result.scalar_one() == 0

    async def test_a_foreign_instructor_is_refused(self, db_session, dept):
        org, officer, _ = dept
        other_org = await _insert_org(db_session)
        outsider = await _insert_user(db_session, other_org, "Outsider")

        with pytest.raises(ValueError, match="Invalid instructor"):
            await _create(db_session, org, officer, {"instructor_id": outsider})


class TestASeries:
    async def test_every_occurrence_counts_toward_the_requirements(
        self, db_session, dept
    ):
        org, officer, _ = dept
        drills = await _requirement(db_session, org, RequirementType.SESSION_ATTENDANCE)
        start, end = _window()

        events, error = await EventService(db_session).create_recurring_event(
            {
                "title": "Weekly Drill",
                "event_type": "training",
                "start_datetime": start,
                "end_datetime": end,
                "requires_rsvp": False,
                "recurrence_pattern": "weekly",
                "recurrence_end_date": start + timedelta(days=21),
                "training_details": {
                    "attendance_requirement_ids": [drills],
                    "instructor": "Lt. Okafor",
                },
            },
            org,
            officer,
        )

        assert error is None
        assert len(events) == 4
        for event in events:
            session = await _session_row(db_session, str(event.id))
            assert session["instructor"] == "Lt. Okafor"
            assert await _linked(db_session, session["id"]) == {drills}


class TestAttachingToAnExistingEvent:
    async def test_the_attendance_links_are_written_too(self, db_session, dept):
        org, officer, _ = dept
        drills = await _requirement(db_session, org, RequirementType.SESSION_ATTENDANCE)
        start, end = _window()
        event = await EventService(db_session).create_event(
            EventCreate(
                title="Drill",
                event_type="training",
                start_datetime=start,
                end_datetime=end,
                requires_rsvp=False,
            ),
            organization_id=org,
            created_by=officer,
        )

        session, error = await TrainingSessionService(
            db_session
        ).attach_session_to_event(
            event.id,
            TrainingSessionAttach(attendance_requirement_ids=[drills]),
            org,
            officer,
        )

        assert error is None
        assert await _linked(db_session, str(session.id)) == {drills}


class TestTheTrainingAdminCreatePathNeedsNoCourse:
    async def test_no_course_and_no_hours_is_filed_under_the_title(
        self, db_session, dept
    ):
        org, officer, _ = dept
        start, end = _window(hours=2)

        session, error = await TrainingSessionService(
            db_session
        ).create_training_session(
            TrainingSessionCreate(
                title="Saturday Drill",
                start_datetime=start,
                end_datetime=end,
                requires_rsvp=False,
            ),
            org,
            officer,
        )

        assert error is None
        row = await _session_row(db_session, str(session.event_id))
        assert row["course_name"] == "Saturday Drill"
        assert row["training_type"] == "continuing_education"
        assert row["credit_hours"] == 2.0


class TestBothCreatePathsReadACourseTheSameWay:
    """POST /training/sessions and POST /events take the same course and the
    same blanks; the course fills the blank hours and type on both."""

    async def test_a_library_course_fills_blank_hours_and_type(self, db_session, dept):
        org, officer, _ = dept
        course = await _course(db_session, org)
        start, end = _window(hours=3)

        session, error = await TrainingSessionService(
            db_session
        ).create_training_session(
            TrainingSessionCreate(
                title="Pump Night",
                start_datetime=start,
                end_datetime=end,
                requires_rsvp=False,
                use_existing_course=True,
                course_id=course,
            ),
            org,
            officer,
        )

        assert error is None
        row = await _session_row(db_session, str(session.event_id))
        assert (row["credit_hours"], row["training_type"]) == (6.0, "certification")

    async def test_the_recurring_path_too(self, db_session, dept):
        org, officer, _ = dept
        course = await _course(db_session, org)
        start, end = _window(hours=3)

        sessions, error = await TrainingSessionService(
            db_session
        ).create_recurring_training_session(
            RecurringTrainingSessionCreate(
                title="Pump Night",
                start_datetime=start,
                end_datetime=end,
                requires_rsvp=False,
                use_existing_course=True,
                course_id=course,
                recurrence_pattern="weekly",
                recurrence_end_date=start + timedelta(days=7),
            ),
            org,
            officer,
        )

        assert error is None
        for session in sessions:
            row = await _session_row(db_session, str(session.event_id))
            assert (row["credit_hours"], row["training_type"]) == (
                6.0,
                "certification",
            )

    async def test_hours_and_type_sent_still_win(self, db_session, dept):
        org, officer, _ = dept
        course = await _course(db_session, org)
        start, end = _window(hours=3)

        session, _ = await TrainingSessionService(db_session).create_training_session(
            TrainingSessionCreate(
                title="Pump Night",
                start_datetime=start,
                end_datetime=end,
                requires_rsvp=False,
                use_existing_course=True,
                course_id=course,
                credit_hours=2.0,
                training_type="refresher",
            ),
            org,
            officer,
        )

        row = await _session_row(db_session, str(session.event_id))
        assert (row["credit_hours"], row["training_type"]) == (2.0, "refresher")


class TestACourselessSessionCreditsLikeNoSession:
    """Every Training event the single form creates has a session. With no
    course, its credit must be filed exactly as a session-less event's is."""

    async def _finalized_record(self, db, org, officer, member, details):
        past_start = (datetime.now(timezone.utc) - timedelta(hours=6)).replace(
            second=0, microsecond=0
        )
        past_end = past_start + timedelta(hours=4)
        start, end = past_start, past_end
        create = EventCreate(
            title="Hose Ops",
            event_type="training",
            start_datetime=start,
            end_datetime=end,
            requires_rsvp=False,
            training_details=(
                TrainingSessionAttach(**details) if details is not None else None
            ),
        )
        service = EventService(db)
        event = await service.create_event(create, org, officer)
        event_id = str(event.id)
        await service.manager_add_attendee(
            event_id, member, org, officer, checked_in=False
        )
        await service.override_rsvp_attendance(
            event_id,
            member,
            org,
            officer,
            RSVPOverride(override_check_in_at=start, override_check_out_at=end),
        )
        outcome = await service.finalize_event_attendance_detailed(
            event_id, org, finalized_by=officer
        )
        assert outcome.error is None
        result = await db.execute(
            text(
                "SELECT status, hours_completed, course_name, training_type "
                "FROM training_records WHERE user_id = :u AND source_event_id = :e"
            ),
            {"u": member, "e": event_id},
        )
        return dict(result.one()._mapping)

    async def test_the_record_matches_a_session_less_event_s(self, db_session, dept):
        org, officer, member = dept
        other = await _insert_user(db_session, org, "Sam")

        without_session = await self._finalized_record(
            db_session, org, officer, member, None
        )
        with_session = await self._finalized_record(db_session, org, officer, other, {})

        assert with_session == without_session
        assert with_session["course_name"] == "Hose Ops"
        assert with_session["training_type"] == "continuing_education"
        assert with_session["hours_completed"] == 4.0


class TestTheChoiceIsAudited:
    """Any events.manage holder may choose which sessions count toward an
    attendance requirement (TR14-2, accepted 2026-11-10); the audit trail is
    what records who chose it."""

    @pytest.fixture
    def audit(self):
        with patch.object(events_endpoint, "log_audit_event", AsyncMock()) as logged:
            yield logged

    @staticmethod
    def _logged(audit, event_type):
        return [
            call.kwargs["event_data"]
            for call in audit.await_args_list
            if call.kwargs["event_type"] == event_type
        ]

    async def test_a_single_event(self, db_session, dept, audit):
        org, officer, _ = dept
        drills = await _requirement(db_session, org, RequirementType.SESSION_ATTENDANCE)
        start, end = _window()
        actor = await db_session.get(User, officer)

        response = await events_endpoint.create_event(
            event_data=EventCreate(
                title="Drill",
                event_type="training",
                start_datetime=start,
                end_datetime=end,
                requires_rsvp=False,
                training_details=TrainingSessionAttach(
                    attendance_requirement_ids=[drills], instructor="Lt. Okafor"
                ),
            ),
            background_tasks=BackgroundTasks(),
            db=db_session,
            current_user=actor,
        )

        [entry] = self._logged(audit, "training_session_created")
        assert entry == {
            "event_id": str(response.id),
            "occurrences": 1,
            "fields": ["attendance_requirement_ids", "instructor"],
            "attendance_requirement_ids": [drills],
        }

    async def test_a_series(self, db_session, dept, audit):
        org, officer, _ = dept
        drills = await _requirement(db_session, org, RequirementType.SESSION_ATTENDANCE)
        start, end = _window()
        actor = await db_session.get(User, officer)

        created = await events_endpoint.create_recurring_event(
            recurring_data=RecurringEventCreate(
                title="Weekly Drill",
                event_type="training",
                start_datetime=start,
                end_datetime=end,
                requires_rsvp=False,
                recurrence_pattern="weekly",
                recurrence_end_date=start + timedelta(days=14),
                training_details=TrainingSessionAttach(
                    attendance_requirement_ids=[drills]
                ),
            ),
            db=db_session,
            current_user=actor,
        )

        [entry] = self._logged(audit, "training_session_created")
        assert entry["occurrences"] == len(created) == 3
        assert entry["attendance_requirement_ids"] == [drills]

    async def test_an_event_without_details_logs_no_session(
        self, db_session, dept, audit
    ):
        org, officer, _ = dept
        start, end = _window()
        actor = await db_session.get(User, officer)

        await events_endpoint.create_event(
            event_data=EventCreate(
                title="Business Meeting",
                event_type="business_meeting",
                start_datetime=start,
                end_datetime=end,
                requires_rsvp=False,
            ),
            background_tasks=BackgroundTasks(),
            db=db_session,
            current_user=actor,
        )

        assert self._logged(audit, "training_session_created") == []

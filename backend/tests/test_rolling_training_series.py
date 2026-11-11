"""A rolling series keeps what its latest occurrence carries.

The nightly job that keeps a rolling series twelve months deep built each new
occurrence from the series parent. A "this and all future events" edit only
reaches occurrences from the one edited onward, so an edit made anywhere but
on the parent was lost: the job went on generating occurrences with the old
title, the old mandatory tiers, and no training session at all, which is why
a rolling Training series could not be given training details.

The job now copies the latest occurrence, its training session and the
session's attendance links.

Against real rows, read back with raw SQL where an identity map could hide a
write that never landed.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import bindparam, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training import (
    RequirementFrequency,
    RequirementSource,
    RequirementType,
    TrainingRequirement,
)
from app.schemas.event import EventCreate, EventUpdate, RecurringEventCreate
from app.schemas.training_session import TrainingSessionAttach
from app.services.event_service import EventService
from app.services.scheduled_tasks import run_rolling_recurrence_extend

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


async def _insert_user(db: AsyncSession, org_id: str) -> str:
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Officer', 'Tester', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"officer-{user_id[:8]}",
            "em": f"officer-{user_id[:8]}@test.com",
        },
    )
    return user_id


async def _attendance_requirement(db: AsyncSession, org_id: str) -> str:
    requirement = TrainingRequirement(
        id=_uid(),
        organization_id=org_id,
        name=f"Drills {uuid.uuid4().hex[:6]}",
        requirement_type=RequirementType.SESSION_ATTENDANCE,
        source=RequirementSource.DEPARTMENT,
        frequency=RequirementFrequency.ANNUAL,
        required_attendance_pct=60,
    )
    db.add(requirement)
    await db.flush()
    return str(requirement.id)


@pytest.fixture
async def dept(db_session: AsyncSession):
    org = await _insert_org(db_session)
    officer = await _insert_user(db_session, org)
    await db_session.flush()
    return org, officer


def _started_weeks_ago(weeks: int):
    """A weekly series whose first night was ``weeks`` ago: created now, it
    runs a year from that night, so the job has ``weeks`` weeks to add."""
    start = (datetime.now(timezone.utc) - timedelta(weeks=weeks)).replace(
        hour=19, minute=0, second=0, microsecond=0
    )
    return start, start + timedelta(hours=2)


async def _rolling_series(db, org, officer, *, weeks_ago=6, **extra) -> list:
    start, end = _started_weeks_ago(weeks_ago)
    payload = RecurringEventCreate(
        title="Monday Drill",
        start_datetime=start,
        end_datetime=end,
        requires_rsvp=False,
        recurrence_pattern="weekly",
        rolling_recurrence=True,
        **extra,
    )
    events, error = await EventService(db).create_recurring_event(
        payload.model_dump(exclude_unset=True), org, officer
    )
    assert error is None
    return [str(e.id) for e in sorted(events, key=lambda e: e.start_datetime)]


async def _occurrences(db, parent_id: str) -> list:
    result = await db.execute(
        text(
            "SELECT id, title, start_datetime, is_mandatory, "
            "mandatory_membership_types, attendee_visibility "
            "FROM events WHERE id = :p OR recurrence_parent_id = :p "
            "ORDER BY start_datetime"
        ),
        {"p": parent_id},
    )
    return [dict(row._mapping) for row in result]


async def _sessions(db, event_ids) -> dict:
    result = await db.execute(
        text(
            "SELECT s.event_id, s.course_name, s.instructor, s.is_finalized, "
            "GROUP_CONCAT(r.requirement_id) AS links "
            "FROM training_sessions s "
            "LEFT JOIN training_session_requirements r ON r.session_id = s.id "
            "WHERE s.event_id IN :ids GROUP BY s.id"
        ).bindparams(bindparam("ids", expanding=True)),
        {"ids": list(event_ids)},
    )
    return {str(row.event_id): dict(row._mapping) for row in result}


class TestATrainingSeriesMayRoll:
    async def test_it_is_created_with_a_session_on_every_occurrence(
        self, db_session, dept
    ):
        org, officer = dept
        drills = await _attendance_requirement(db_session, org)

        ids = await _rolling_series(
            db_session,
            org,
            officer,
            event_type="training",
            training_details={"attendance_requirement_ids": [drills]},
        )

        sessions = await _sessions(db_session, ids)
        assert set(sessions) == set(ids)
        assert {s["links"] for s in sessions.values()} == {drills}


class TestTheJobCopiesTheLatestOccurrence:
    async def test_new_occurrences_get_the_session_and_its_links(
        self, db_session, dept
    ):
        org, officer = dept
        drills = await _attendance_requirement(db_session, org)
        ids = await _rolling_series(
            db_session,
            org,
            officer,
            event_type="training",
            training_details={
                "attendance_requirement_ids": [drills],
                "instructor": "Lt. Okafor",
            },
        )

        result = await run_rolling_recurrence_extend(db_session)

        assert result["errors"] == []
        occurrences = await _occurrences(db_session, ids[0])
        added = [str(o["id"]) for o in occurrences if str(o["id"]) not in ids]
        assert len(added) >= 5
        sessions = await _sessions(db_session, added)
        assert set(sessions) == set(added)
        for session in sessions.values():
            assert session["links"] == drills
            assert session["instructor"] == "Lt. Okafor"
            assert session["course_name"] == "Monday Drill"
            assert not session["is_finalized"]

    async def test_a_second_run_adds_nothing(self, db_session, dept):
        org, officer = dept
        ids = await _rolling_series(
            db_session,
            org,
            officer,
            event_type="training",
            training_details={},
        )
        await run_rolling_recurrence_extend(db_session)
        after_first = await _occurrences(db_session, ids[0])

        await run_rolling_recurrence_extend(db_session)

        after_second = await _occurrences(db_session, ids[0])
        assert len(after_second) == len(after_first)
        sessions = await _sessions(db_session, [str(o["id"]) for o in after_second])
        assert len(sessions) == len(after_second)

    async def test_a_future_edit_made_after_the_first_night_carries_on(
        self, db_session, dept
    ):
        org, officer = dept
        ids = await _rolling_series(db_session, org, officer, event_type="training")

        await EventService(db_session).update_future_events(
            ids[3], org, EventUpdate(title="Monday Drill (Station 2)"), officer
        )
        await run_rolling_recurrence_extend(db_session)

        occurrences = await _occurrences(db_session, ids[0])
        added = [o for o in occurrences if str(o["id"]) not in ids]
        assert added
        assert {o["title"] for o in added} == {"Monday Drill (Station 2)"}

    async def test_the_mandatory_tiers_and_roster_visibility_carry_on(
        self, db_session, dept
    ):
        org, officer = dept
        ids = await _rolling_series(
            db_session,
            org,
            officer,
            event_type="business_meeting",
            is_mandatory=True,
            mandatory_membership_types=["regular"],
            attendee_visibility="members",
        )

        await run_rolling_recurrence_extend(db_session)

        occurrences = await _occurrences(db_session, ids[0])
        added = [o for o in occurrences if str(o["id"]) not in ids]
        assert added
        for occurrence in added:
            assert occurrence["is_mandatory"]
            assert occurrence["attendee_visibility"] == "members"
            assert "regular" in str(occurrence["mandatory_membership_types"])


class TestADuplicate:
    async def test_copies_the_session_and_its_links_but_not_its_finalized_state(
        self, db_session, dept
    ):
        org, officer = dept
        drills = await _attendance_requirement(db_session, org)
        start, end = _started_weeks_ago(-1)
        source = await EventService(db_session).create_event(
            EventCreate(
                title="Ladder Night",
                event_type="training",
                start_datetime=start,
                end_datetime=end,
                requires_rsvp=False,
                training_details=TrainingSessionAttach(
                    attendance_requirement_ids=[drills], course_name="Ladder Throws"
                ),
            ),
            org,
            officer,
        )
        source_id = str(source.id)
        await db_session.execute(
            text("UPDATE training_sessions SET is_finalized = 1 WHERE event_id = :e"),
            {"e": source_id},
        )

        copy = await EventService(db_session).duplicate_event(source_id, org, officer)

        sessions = await _sessions(db_session, [str(copy.id)])
        session = sessions[str(copy.id)]
        assert session["course_name"] == "Ladder Throws"
        assert session["links"] == drills
        assert not session["is_finalized"]

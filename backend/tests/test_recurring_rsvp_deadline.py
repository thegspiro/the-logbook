"""A recurring series' RSVP deadline moves with each occurrence.

One absolute deadline used to be copied onto every occurrence, so RSVPs for
the whole series closed on the first occurrence's deadline. Each occurrence
now keeps the lead the deadline had before the series' start — the rule the
"this and all future" edit already applied. Recurring training sessions are
created through the same series builder and are covered here too.

Read back with raw SQL after expiring the session, so an identity map cannot
report a value that never reached the database.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import bindparam, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.event import RecurringEventCreate
from app.schemas.training_session import RecurringTrainingSessionCreate
from app.services.event_service import EventService
from app.services.training_session_service import TrainingSessionService

pytestmark = [pytest.mark.integration]

# Mondays, three weeks running.
FIRST_START = datetime(2027, 3, 1, 19, 0, tzinfo=timezone.utc)
SERIES_END = datetime(2027, 3, 15, 23, 59, tzinfo=timezone.utc)
STARTS = [FIRST_START + timedelta(weeks=n) for n in range(3)]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def dept(db_session: AsyncSession):
    org_id = _uid()
    user_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Test Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"org-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Officer', 'Tester', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"officer-{user_id[:8]}",
            "em": f"officer-{user_id[:8]}@test.com",
        },
    )
    await db_session.flush()
    return org_id, user_id


async def _stored(db: AsyncSession, event_ids: list) -> list:
    db.expire_all()
    rows = (
        await db.execute(
            text(
                "SELECT start_datetime, rsvp_deadline FROM events "
                "WHERE id IN :ids ORDER BY start_datetime"
            ).bindparams(bindparam("ids", expanding=True)),
            {"ids": event_ids},
        )
    ).all()
    return [(_utc(row[0]), _utc(row[1])) for row in rows]


def _utc(value):
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


async def _create_series(db, org_id, user_id, **extra) -> list:
    data = RecurringEventCreate(
        title="Weekly Drill",
        event_type="training",
        start_datetime=FIRST_START,
        end_datetime=FIRST_START + timedelta(hours=2),
        recurrence_pattern="weekly",
        recurrence_end_date=SERIES_END,
        **extra,
    )
    events, error = await EventService(db).create_recurring_event(
        event_data=data.model_dump(exclude_unset=True),
        organization_id=org_id,
        created_by=user_id,
    )
    assert error is None
    ids = [e.id for e in events]
    assert len(ids) == 3
    return ids


class TestRecurringEventRsvpDeadline:
    async def test_each_occurrence_keeps_the_lead_before_its_own_start(
        self, db_session, dept
    ):
        org_id, user_id = dept
        ids = await _create_series(
            db_session,
            org_id,
            user_id,
            requires_rsvp=True,
            rsvp_deadline=FIRST_START - timedelta(days=2),
        )

        stored = await _stored(db_session, ids)
        assert [start for start, _ in stored] == STARTS
        assert [deadline for _, deadline in stored] == [
            start - timedelta(days=2) for start in STARTS
        ]

    async def test_no_deadline_stays_none_on_every_occurrence(self, db_session, dept):
        org_id, user_id = dept
        ids = await _create_series(db_session, org_id, user_id, requires_rsvp=True)

        stored = await _stored(db_session, ids)
        assert [deadline for _, deadline in stored] == [None, None, None]

    async def test_a_deadline_after_the_start_keeps_its_offset(self, db_session, dept):
        org_id, user_id = dept
        ids = await _create_series(
            db_session,
            org_id,
            user_id,
            requires_rsvp=False,
            rsvp_deadline=FIRST_START + timedelta(hours=1),
        )

        stored = await _stored(db_session, ids)
        assert [deadline for _, deadline in stored] == [
            start + timedelta(hours=1) for start in STARTS
        ]


class TestRecurringTrainingSessionRsvpDeadline:
    async def test_each_session_keeps_the_lead_before_its_own_start(
        self, db_session, dept
    ):
        org_id, user_id = dept
        data = RecurringTrainingSessionCreate(
            title="Pump Ops",
            start_datetime=FIRST_START,
            end_datetime=FIRST_START + timedelta(hours=2),
            requires_rsvp=True,
            rsvp_deadline=FIRST_START - timedelta(days=2),
            course_name="Pump Ops",
            training_type="continuing_education",
            credit_hours=2,
            recurrence_pattern="weekly",
            recurrence_end_date=SERIES_END,
        )
        sessions, error = await TrainingSessionService(
            db_session
        ).create_recurring_training_session(data, org_id, user_id)
        assert error is None
        event_ids = [s.event_id for s in sessions]
        assert len(event_ids) == 3

        stored = await _stored(db_session, event_ids)
        assert [start for start, _ in stored] == STARTS
        assert [deadline for _, deadline in stored] == [
            start - timedelta(days=2) for start in STARTS
        ]

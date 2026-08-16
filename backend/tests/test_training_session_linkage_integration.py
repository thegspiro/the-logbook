"""
Integration tests for training session linkage against real database rows.

The unit tests beside these (``test_training_session_linkage.py``) mock the
session, so they prove the service *assigned* an attribute — not that a write
reached the database. That distinction is the whole point of the update path:
the failure mode CLAUDE.md pitfall #1 describes is an update acknowledged with
a 200 whose cleared field still holds the old value in MySQL.

So these assert by reading the row back with raw SQL, bypassing the ORM
identity map entirely. Cross-tenant rejection is likewise checked against a
row that genuinely exists in another organization, rather than a mock that
returns None.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.training_session import TrainingSessionLinkageUpdate
from app.services.training_session_service import TrainingSessionService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


_START = datetime(2026, 9, 15, 13, 0, tzinfo=timezone.utc)


async def _insert_org(db: AsyncSession, name: str = "Test Dept") -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": name, "slug": f"org-{org_id[:8]}"},
    )
    return org_id


async def _insert_event(db: AsyncSession, org_id: str) -> str:
    event_id = _uid()
    await db.execute(
        text(
            "INSERT INTO events "
            "(id, organization_id, title, start_datetime, end_datetime, "
            "event_type, reminder_schedule) "
            "VALUES (:id, :org, 'Hose Operations', :start, :end, "
            "'training', '[24]')"
        ),
        {
            "id": event_id,
            "org": org_id,
            "start": _START,
            "end": _START + timedelta(hours=3),
        },
    )
    return event_id


async def _insert_session(db: AsyncSession, org_id: str, event_id: str, **links) -> str:
    session_id = _uid()
    await db.execute(
        text(
            "INSERT INTO training_sessions "
            "(id, organization_id, event_id, course_name, training_type, "
            "credit_hours, category_id, program_id, phase_id, requirement_id) "
            "VALUES (:id, :org, :event, 'Hose Operations', 'skills_practice', "
            "3.0, :category, :program, :phase, :requirement)"
        ),
        {
            "id": session_id,
            "org": org_id,
            "event": event_id,
            "category": links.get("category_id"),
            "program": links.get("program_id"),
            "phase": links.get("phase_id"),
            "requirement": links.get("requirement_id"),
        },
    )
    return session_id


async def _insert_category(db: AsyncSession, org_id: str, name: str = "EMS") -> str:
    category_id = _uid()
    await db.execute(
        text(
            "INSERT INTO training_categories (id, organization_id, name) "
            "VALUES (:id, :org, :name)"
        ),
        {"id": category_id, "org": org_id, "name": name},
    )
    return category_id


async def _insert_requirement(
    db: AsyncSession, org_id: str, name: str = "CPR Renewal"
) -> str:
    requirement_id = _uid()
    await db.execute(
        text(
            "INSERT INTO training_requirements "
            "(id, organization_id, name, requirement_type, frequency) "
            "VALUES (:id, :org, :name, 'hours', 'annual')"
        ),
        {"id": requirement_id, "org": org_id, "name": name},
    )
    return requirement_id


async def _insert_program(
    db: AsyncSession, org_id: str, name: str = "Recruit School"
) -> str:
    program_id = _uid()
    await db.execute(
        text(
            "INSERT INTO training_programs (id, organization_id, name) "
            "VALUES (:id, :org, :name)"
        ),
        {"id": program_id, "org": org_id, "name": name},
    )
    return program_id


async def _insert_phase(db: AsyncSession, program_id: str, number: int = 2) -> str:
    phase_id = _uid()
    await db.execute(
        text(
            "INSERT INTO program_phases (id, program_id, phase_number, name) "
            "VALUES (:id, :program, :number, 'Live Fire')"
        ),
        {"id": phase_id, "program": program_id, "number": number},
    )
    return phase_id


async def _stored_links(db: AsyncSession, session_id: str) -> dict:
    """Read the linkage columns straight back out of MySQL.

    Raw SQL on purpose: an ORM read could be served from the identity map and
    would happily report the in-memory value of a write that never landed.
    """
    result = await db.execute(
        text(
            "SELECT category_id, program_id, phase_id, requirement_id "
            "FROM training_sessions WHERE id = :id"
        ),
        {"id": session_id},
    )
    row = result.one()
    return {
        "category_id": row[0],
        "program_id": row[1],
        "phase_id": row[2],
        "requirement_id": row[3],
    }


class TestUpdatePersistence:
    """The three-state contract, verified by reading the row back."""

    async def test_an_explicit_null_actually_clears_the_column(
        self, db_session: AsyncSession
    ):
        # The bug this guards is invisible in memory: skipping the None would
        # return a 200 while MySQL still holds the old requirement id.
        org_id = await _insert_org(db_session)
        event_id = await _insert_event(db_session, org_id)
        requirement_id = await _insert_requirement(db_session, org_id)
        session_id = await _insert_session(
            db_session, org_id, event_id, requirement_id=requirement_id
        )
        await db_session.flush()

        svc = TrainingSessionService(db_session)
        _, error = await svc.update_session_linkage(
            session_id, TrainingSessionLinkageUpdate(requirement_id=None), org_id
        )

        assert error is None
        assert (await _stored_links(db_session, session_id))["requirement_id"] is None

    async def test_a_value_is_written_through(self, db_session: AsyncSession):
        org_id = await _insert_org(db_session)
        event_id = await _insert_event(db_session, org_id)
        category_id = await _insert_category(db_session, org_id)
        session_id = await _insert_session(db_session, org_id, event_id)
        await db_session.flush()

        svc = TrainingSessionService(db_session)
        _, error = await svc.update_session_linkage(
            session_id, TrainingSessionLinkageUpdate(category_id=category_id), org_id
        )

        assert error is None
        assert (await _stored_links(db_session, session_id))[
            "category_id"
        ] == category_id

    async def test_an_omitted_field_keeps_its_stored_value(
        self, db_session: AsyncSession
    ):
        org_id = await _insert_org(db_session)
        event_id = await _insert_event(db_session, org_id)
        category_id = await _insert_category(db_session, org_id)
        requirement_id = await _insert_requirement(db_session, org_id)
        session_id = await _insert_session(
            db_session,
            org_id,
            event_id,
            category_id=category_id,
            requirement_id=requirement_id,
        )
        await db_session.flush()

        svc = TrainingSessionService(db_session)
        # Only category_id travels; requirement_id was never sent
        _, error = await svc.update_session_linkage(
            session_id, TrainingSessionLinkageUpdate(category_id=None), org_id
        )

        assert error is None
        stored = await _stored_links(db_session, session_id)
        assert stored["category_id"] is None
        assert stored["requirement_id"] == requirement_id

    async def test_a_full_relink_writes_every_column(self, db_session: AsyncSession):
        # What the edit card actually sends: every field it owns, every save.
        org_id = await _insert_org(db_session)
        event_id = await _insert_event(db_session, org_id)
        category_id = await _insert_category(db_session, org_id)
        requirement_id = await _insert_requirement(db_session, org_id)
        program_id = await _insert_program(db_session, org_id)
        phase_id = await _insert_phase(db_session, program_id)
        session_id = await _insert_session(db_session, org_id, event_id)
        await db_session.flush()

        svc = TrainingSessionService(db_session)
        _, error = await svc.update_session_linkage(
            session_id,
            TrainingSessionLinkageUpdate(
                category_id=category_id,
                program_id=program_id,
                phase_id=phase_id,
                requirement_id=requirement_id,
            ),
            org_id,
        )

        assert error is None
        assert await _stored_links(db_session, session_id) == {
            "category_id": category_id,
            "program_id": program_id,
            "phase_id": phase_id,
            "requirement_id": requirement_id,
        }


class TestCrossTenantIsolation:
    """Rejection checked against rows that really do exist — in another org."""

    async def test_a_real_category_from_another_org_is_refused(
        self, db_session: AsyncSession
    ):
        org_a = await _insert_org(db_session, "Dept A")
        org_b = await _insert_org(db_session, "Dept B")
        event_id = await _insert_event(db_session, org_a)
        session_id = await _insert_session(db_session, org_a, event_id)
        # A genuine row — just not org A's
        foreign_category = await _insert_category(db_session, org_b)
        await db_session.flush()

        svc = TrainingSessionService(db_session)
        updated, error = await svc.update_session_linkage(
            session_id,
            TrainingSessionLinkageUpdate(category_id=foreign_category),
            org_a,
        )

        assert updated is None
        assert error == "Invalid training category"
        # And nothing was written
        assert (await _stored_links(db_session, session_id))["category_id"] is None

    async def test_a_phase_under_another_org_s_program_is_refused(
        self, db_session: AsyncSession
    ):
        # ProgramPhase has no organization_id of its own — this is the case
        # that scoping through the parent program exists to catch.
        org_a = await _insert_org(db_session, "Dept A")
        org_b = await _insert_org(db_session, "Dept B")
        event_id = await _insert_event(db_session, org_a)
        session_id = await _insert_session(db_session, org_a, event_id)
        foreign_program = await _insert_program(db_session, org_b)
        foreign_phase = await _insert_phase(db_session, foreign_program)
        await db_session.flush()

        svc = TrainingSessionService(db_session)
        updated, error = await svc.update_session_linkage(
            session_id, TrainingSessionLinkageUpdate(phase_id=foreign_phase), org_a
        )

        assert updated is None
        assert error == "Invalid program phase"

    async def test_another_org_cannot_update_the_session_at_all(
        self, db_session: AsyncSession
    ):
        org_a = await _insert_org(db_session, "Dept A")
        org_b = await _insert_org(db_session, "Dept B")
        event_id = await _insert_event(db_session, org_a)
        session_id = await _insert_session(db_session, org_a, event_id)
        org_b_category = await _insert_category(db_session, org_b)
        await db_session.flush()

        svc = TrainingSessionService(db_session)
        # Org B holds events.manage in its own org; that must not reach org A's
        # session (CLAUDE.md 14b — the permission check does not scope the row).
        updated, error = await svc.update_session_linkage(
            session_id, TrainingSessionLinkageUpdate(category_id=org_b_category), org_b
        )

        assert updated is None
        assert error == "Training session not found"
        assert (await _stored_links(db_session, session_id))["category_id"] is None


class TestGetSessionByEvent:
    async def test_resolves_the_session_for_its_event(self, db_session: AsyncSession):
        org_id = await _insert_org(db_session)
        event_id = await _insert_event(db_session, org_id)
        session_id = await _insert_session(db_session, org_id, event_id)
        await db_session.flush()

        svc = TrainingSessionService(db_session)
        found = await svc.get_session_by_event(event_id, org_id)

        assert found is not None
        assert found.id == session_id

    async def test_does_not_resolve_across_organizations(
        self, db_session: AsyncSession
    ):
        org_a = await _insert_org(db_session, "Dept A")
        org_b = await _insert_org(db_session, "Dept B")
        event_id = await _insert_event(db_session, org_a)
        await _insert_session(db_session, org_a, event_id)
        await db_session.flush()

        svc = TrainingSessionService(db_session)

        assert await svc.get_session_by_event(event_id, org_b) is None

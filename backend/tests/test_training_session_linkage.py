"""
Tests for training session requirement/program linkage.

Two concerns:

1. **Org-scoping of client-supplied linkage FKs (XC-1).** The create wizard and
   the event-detail edit card both send category/program/phase/requirement ids
   straight from the browser. An id from another org must be rejected, not
   stored — an unvalidated FK persists a mis-attributed reference and, once
   eager-loaded, leaks the other org's data back in the response.

2. **The update path's three-state contract (CLAUDE.md pitfall #1).** A field
   omitted from the payload is untouched, an explicit null clears the link, a
   value sets it. Collapsing null into "skip" would acknowledge a cleared link
   with a 200 and leave the old one in the database.

DB is mocked; no MySQL.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.models.training import TrainingSession, TrainingType
from app.schemas.training_session import (
    TrainingSessionCreate,
    TrainingSessionLinkageUpdate,
)
from app.services.training_session_service import TrainingSessionService

ORG = uuid4()
ACTOR = uuid4()


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


class RecordingSession:
    """Async session that returns queued results and records added objects."""

    def __init__(self, results=None):
        self._results = list(results or [])
        self.added = []
        self.commit = AsyncMock()
        self.refresh = AsyncMock()
        self.flush = AsyncMock()
        self.rollback = AsyncMock()

    def add(self, obj):
        self.added.append(obj)

    async def execute(self, statement, *args, **kwargs):
        return self._results.pop(0) if self._results else MagicMock()

    def added_of(self, cls):
        return [o for o in self.added if isinstance(o, cls)]


def _payload(**kw) -> TrainingSessionCreate:
    start = datetime(2026, 9, 15, 9, 0, tzinfo=timezone.utc)
    base = dict(
        title="Hose Operations",
        start_datetime=start,
        end_datetime=start + timedelta(hours=3),
        requires_rsvp=False,
        use_existing_course=False,
        course_name="Hose Operations",
        training_type="skills_practice",
        credit_hours=3.0,
    )
    base.update(kw)
    return TrainingSessionCreate(**base)


def _session(**kw) -> TrainingSession:
    session = TrainingSession(
        id=str(uuid4()),
        organization_id=str(ORG),
        event_id=str(uuid4()),
        course_name="Hose Operations",
        training_type=TrainingType.SKILLS_PRACTICE,
        credit_hours=3.0,
    )
    for key, value in kw.items():
        setattr(session, key, value)
    return session


class TestCreateLinkageValidation:
    """Every linkage FK is checked against the caller's org before it is stored."""

    async def test_in_org_category_is_stored(self):
        category_id = uuid4()
        # is_in_org: category found; then the location/course path needs nothing
        db = RecordingSession([_one(str(category_id))])
        svc = TrainingSessionService(db)

        session, error = await svc.create_training_session(
            _payload(category_id=category_id), ORG, ACTOR
        )

        assert error is None
        assert session.category_id == str(category_id)

    async def test_foreign_category_is_rejected(self):
        # is_in_org resolves nothing — the row is not in the caller's org
        db = RecordingSession([_one(None)])
        svc = TrainingSessionService(db)

        session, error = await svc.create_training_session(
            _payload(category_id=uuid4()), ORG, ACTOR
        )

        assert session is None
        assert error == "Invalid training category"
        # Nothing was written — not even the Event that precedes the link
        assert db.added == []
        assert db.commit.await_count == 0

    async def test_foreign_program_is_rejected(self):
        db = RecordingSession([_one(None)])
        svc = TrainingSessionService(db)

        _, error = await svc.create_training_session(
            _payload(program_id=uuid4()), ORG, ACTOR
        )

        assert error == "Invalid training program"

    async def test_foreign_requirement_is_rejected(self):
        db = RecordingSession([_one(None)])
        svc = TrainingSessionService(db)

        _, error = await svc.create_training_session(
            _payload(requirement_id=uuid4()), ORG, ACTOR
        )

        assert error == "Invalid training requirement"

    async def test_phase_is_scoped_through_its_program(self):
        # ProgramPhase carries no organization_id of its own, so a phase whose
        # program belongs to another org must not resolve.
        db = RecordingSession([_one(None)])
        svc = TrainingSessionService(db)

        _, error = await svc.create_training_session(
            _payload(phase_id=uuid4()), ORG, ACTOR
        )

        assert error == "Invalid program phase"

    async def test_error_does_not_reveal_whether_the_id_exists_elsewhere(self):
        # Generic on purpose: a distinct "belongs to another org" message would
        # be a cross-tenant existence oracle.
        db = RecordingSession([_one(None)])
        svc = TrainingSessionService(db)

        _, error = await svc.create_training_session(
            _payload(requirement_id=uuid4()), ORG, ACTOR
        )

        assert "another" not in error.lower()
        assert "exist" not in error.lower()

    async def test_recurring_path_validates_too(self):
        from app.schemas.training_session import RecurringTrainingSessionCreate

        start = datetime(2026, 9, 15, 9, 0, tzinfo=timezone.utc)
        payload = RecurringTrainingSessionCreate(
            title="Hose Operations",
            start_datetime=start,
            end_datetime=start + timedelta(hours=3),
            requires_rsvp=False,
            use_existing_course=False,
            course_name="Hose Operations",
            training_type="skills_practice",
            credit_hours=3.0,
            category_id=uuid4(),
            recurrence_pattern="weekly",
            recurrence_end_date=start + timedelta(days=60),
        )
        db = RecordingSession([_one(None)])
        svc = TrainingSessionService(db)

        sessions, error = await svc.create_recurring_training_session(
            payload, ORG, ACTOR
        )

        assert sessions == []
        assert error == "Invalid training category"


class TestUpdateLinkage:
    """The edit card's three-state update contract."""

    async def test_sets_a_link(self):
        requirement_id = uuid4()
        session = _session()
        db = RecordingSession([_one(session), _one(str(requirement_id))])
        svc = TrainingSessionService(db)

        updated, error = await svc.update_session_linkage(
            session.id,
            TrainingSessionLinkageUpdate(requirement_id=requirement_id),
            ORG,
        )

        assert error is None
        assert updated.requirement_id == str(requirement_id)
        assert db.commit.await_count == 1

    async def test_explicit_null_clears_a_link(self):
        # The bug this guards: skipping None would 200 the request and leave
        # the old requirement attached.
        session = _session(requirement_id=str(uuid4()))
        db = RecordingSession([_one(session)])
        svc = TrainingSessionService(db)

        updated, error = await svc.update_session_linkage(
            session.id,
            TrainingSessionLinkageUpdate(requirement_id=None),
            ORG,
        )

        assert error is None
        assert updated.requirement_id is None

    async def test_omitted_field_is_left_alone(self):
        existing = str(uuid4())
        session = _session(requirement_id=existing, category_id=str(uuid4()))
        db = RecordingSession([_one(session)])
        svc = TrainingSessionService(db)

        # Only category_id is in the payload; requirement_id was never sent
        updated, error = await svc.update_session_linkage(
            session.id,
            TrainingSessionLinkageUpdate(category_id=None),
            ORG,
        )

        assert error is None
        assert updated.category_id is None
        assert updated.requirement_id == existing

    async def test_empty_payload_is_a_no_op(self):
        session = _session()
        db = RecordingSession([_one(session)])
        svc = TrainingSessionService(db)

        updated, error = await svc.update_session_linkage(
            session.id, TrainingSessionLinkageUpdate(), ORG
        )

        assert error is None
        assert updated is session
        assert db.commit.await_count == 0

    async def test_a_session_from_another_org_is_not_found(self):
        db = RecordingSession([_one(None)])
        svc = TrainingSessionService(db)

        updated, error = await svc.update_session_linkage(
            uuid4(), TrainingSessionLinkageUpdate(category_id=uuid4()), ORG
        )

        assert updated is None
        assert error == "Training session not found"
        assert db.commit.await_count == 0

    async def test_a_foreign_link_is_rejected_on_update_too(self):
        session = _session()
        db = RecordingSession([_one(session), _one(None)])
        svc = TrainingSessionService(db)

        updated, error = await svc.update_session_linkage(
            session.id,
            TrainingSessionLinkageUpdate(requirement_id=uuid4()),
            ORG,
        )

        assert updated is None
        assert error == "Invalid training requirement"
        assert db.commit.await_count == 0

    async def test_ids_are_stored_as_strings(self):
        # The columns are String(36); a raw UUID stored against one is the same
        # mismatch that made the course lookup match nothing.
        category_id = uuid4()
        session = _session()
        db = RecordingSession([_one(session), _one(str(category_id))])
        svc = TrainingSessionService(db)

        updated, _ = await svc.update_session_linkage(
            session.id, TrainingSessionLinkageUpdate(category_id=category_id), ORG
        )

        assert isinstance(updated.category_id, str)


class TestGetSessionByEvent:
    async def test_returns_the_event_s_session(self):
        session = _session()
        db = RecordingSession([_one(session)])
        svc = TrainingSessionService(db)

        assert await svc.get_session_by_event(uuid4(), ORG) is session

    async def test_returns_none_for_an_event_without_one(self):
        db = RecordingSession([_one(None)])
        svc = TrainingSessionService(db)

        assert await svc.get_session_by_event(uuid4(), ORG) is None

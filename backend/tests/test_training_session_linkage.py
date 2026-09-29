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
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.models.event import EventType
from app.models.training import TrainingSession, TrainingType
from app.schemas.training_session import (
    TrainingSessionAttach,
    TrainingSessionCreate,
    TrainingSessionLinkageUpdate,
)
from app.services.event_service import ATTENDANCE_LOCKED_PREFIX, EventService
from app.services.training_session_service import TrainingSessionService

ORG = uuid4()
ACTOR = uuid4()


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _open_event(**kw):
    """The session's event, as update_session_linkage locks it: still open."""
    fields = dict(
        id=str(uuid4()),
        title="Hose Operations",
        attendance_finalized_at=None,
        custom_fields={},
    )
    fields.update(kw)
    return SimpleNamespace(**fields)


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
        db = RecordingSession(
            [_one(session), _one(_open_event()), _one(str(requirement_id))]
        )
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
        db = RecordingSession([_one(session), _one(_open_event())])
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
        db = RecordingSession([_one(session), _one(_open_event())])
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
        db = RecordingSession([_one(session), _one(_open_event()), _one(None)])
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
        db = RecordingSession(
            [_one(session), _one(_open_event()), _one(str(category_id))]
        )
        svc = TrainingSessionService(db)

        updated, _ = await svc.update_session_linkage(
            session.id, TrainingSessionLinkageUpdate(category_id=category_id), ORG
        )

        assert isinstance(updated.category_id, str)

    async def test_refused_while_attendance_is_finalized(self):
        """A change would sit unapplied beside records it disagrees with until
        a reopen, so the closed event refuses it (a 409 at the endpoint)."""
        session = _session()
        locked = _open_event(attendance_finalized_at=datetime.now(timezone.utc))
        db = RecordingSession([_one(session), _one(locked)])
        svc = TrainingSessionService(db)

        updated, error = await svc.update_session_linkage(
            session.id, TrainingSessionLinkageUpdate(category_id=None), ORG
        )

        assert updated is None
        assert error.startswith(ATTENDANCE_LOCKED_PREFIX)
        assert db.commit.await_count == 0

    async def test_setting_a_course_refiles_the_session_under_it(self):
        session = _session(course_id=None, course_name="Hose Operations")
        course = SimpleNamespace(id=str(uuid4()), name="Pump Ops I", code="PO1")
        db = RecordingSession([_one(session), _one(_open_event()), _one(course)])
        svc = TrainingSessionService(db)

        updated, error = await svc.update_session_linkage(
            session.id, TrainingSessionLinkageUpdate(course_id=course.id), ORG
        )

        assert error is None
        assert updated.course_id == course.id
        assert updated.course_name == "Pump Ops I"
        assert updated.course_code == "PO1"

    async def test_clearing_the_course_files_under_the_event_title(self):
        session = _session(course_id=str(uuid4()), course_name="Pump Ops I")
        event = _open_event(title="Saturday Pump Drill")
        db = RecordingSession([_one(session), _one(event)])
        svc = TrainingSessionService(db)

        updated, error = await svc.update_session_linkage(
            session.id, TrainingSessionLinkageUpdate(course_id=None), ORG
        )

        assert error is None
        assert updated.course_id is None
        assert updated.course_name == "Saturday Pump Drill"
        assert updated.course_code is None

    async def test_training_type_can_change_but_not_clear(self):
        session = _session()
        db = RecordingSession([_one(session), _one(_open_event())])
        svc = TrainingSessionService(db)
        updated, error = await svc.update_session_linkage(
            session.id, TrainingSessionLinkageUpdate(training_type="refresher"), ORG
        )
        assert error is None
        assert updated.training_type == TrainingType.REFRESHER

        db = RecordingSession([_one(_session()), _one(_open_event())])
        svc = TrainingSessionService(db)
        updated, error = await svc.update_session_linkage(
            session.id, TrainingSessionLinkageUpdate(training_type=None), ORG
        )
        assert updated is None
        assert error == "Training type is required"


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


class TestAttachingDetailsStaysInOrg:
    """XC-1 on the paths that attach training details to an existing or new
    Training event: every id they store must be the caller's organization's."""

    async def test_a_foreign_course_is_refused(self):
        statements = []

        class Capturing(RecordingSession):
            async def execute(self, statement, *args, **kwargs):
                statements.append(statement)
                return _one(None)

        svc = TrainingSessionService(Capturing())

        course, error = await svc.resolve_attach_details(
            TrainingSessionAttach(course_id=uuid4()), ORG
        )

        assert (course, error) == (None, "Training course not found")
        compiled = str(statements[0].compile(compile_kwargs={"literal_binds": True}))
        assert f"training_courses.organization_id = '{ORG}'" in compiled

    async def test_another_org_s_event_is_not_found(self):
        db = RecordingSession([_one(None)])

        session, error = await TrainingSessionService(db).attach_session_to_event(
            uuid4(), TrainingSessionAttach(), ORG, ACTOR
        )

        assert (session, error) == (None, "Event not found")
        assert db.added == []
        assert db.commit.await_count == 0

    async def test_attach_with_a_foreign_course_adds_nothing(self):
        start = datetime(2026, 9, 15, 9, 0, tzinfo=timezone.utc)
        event = _open_event(
            event_type=EventType.TRAINING,
            is_cancelled=False,
            start_datetime=start,
            end_datetime=start + timedelta(hours=3),
        )
        # The event, its (absent) session, then the course lookup.
        db = RecordingSession([_one(event), _one(None), _one(None)])

        session, error = await TrainingSessionService(db).attach_session_to_event(
            event.id, TrainingSessionAttach(course_id=uuid4()), ORG, ACTOR
        )

        assert (session, error) == (None, "Training course not found")
        assert db.added == []
        assert db.commit.await_count == 0

    async def test_a_foreign_course_is_refused_on_update(self):
        session = _session()
        db = RecordingSession([_one(session), _one(_open_event()), _one(None)])

        updated, error = await TrainingSessionService(db).update_session_linkage(
            session.id, TrainingSessionLinkageUpdate(course_id=uuid4()), ORG
        )

        assert (updated, error) == (None, "Training course not found")
        assert db.commit.await_count == 0


class TestRecurringTrainingDetails:
    """A recurring Training series from Events gets one session per
    occurrence; the refusals come before anything is added."""

    def _data(self, **overrides):
        start = datetime(2026, 9, 15, 9, 0, tzinfo=timezone.utc)
        data = {
            "title": "Hose Operations",
            "event_type": "training",
            "start_datetime": start,
            "end_datetime": start + timedelta(hours=3),
            "recurrence_pattern": "weekly",
            "recurrence_end_date": start + timedelta(days=21),
            "training_details": {"category_id": str(uuid4())},
        }
        data.update(overrides)
        return data

    async def test_details_on_another_type_are_refused(self):
        db = RecordingSession()
        events, error = await EventService(db).create_recurring_event(
            self._data(event_type="business_meeting"), ORG, ACTOR
        )
        assert (events, error) == (
            [],
            "Training details can only be added to a Training event",
        )
        assert db.added == []

    async def test_a_rolling_series_is_refused(self):
        """The job that extends a rolling series copies events, not sessions.
        The schema refuses it first; the service holds the line for any other
        caller."""
        db = RecordingSession()
        events, error = await EventService(db).create_recurring_event(
            self._data(rolling_recurrence=True, recurrence_end_date=None), ORG, ACTOR
        )
        assert (events, error) == (
            [],
            "Training details can't be added to a rolling series",
        )
        assert db.added == []

    async def test_a_foreign_category_is_refused(self):
        db = RecordingSession([_one(None)])
        events, error = await EventService(db).create_recurring_event(
            self._data(), ORG, ACTOR
        )
        assert (events, error) == ([], "Invalid training category")
        assert db.added == []

"""DB-free coverage for event reminder audiences.

Covers the shared ``default_reminder_target`` helper, the scheduler's
resolution of a stored audience, and the direct ``Event(...)`` construction
paths that bypass the EventCreate-family Pydantic validator (training
sessions, recurring training series). Those paths previously inherited the
column default ``"going"``, so mandatory events created there reminded only
RSVP'd members instead of all active members. DB mocked; no MySQL.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from app.models.event import Event, default_reminder_target
from app.schemas.training_session import (
    RecurringTrainingSessionCreate,
    TrainingSessionCreate,
)
from app.services.event_service import EventService
from app.services.scheduled_tasks import _resolve_event_reminder_target
from app.services.training_session_service import TrainingSessionService


class TestDefaultReminderTarget:
    def test_mandatory_defaults_to_all_members(self):
        assert default_reminder_target(True) == "all"

    def test_optional_defaults_to_signed_up_members(self):
        assert default_reminder_target(False) == "going"


class TestScheduledResolution:
    def test_explicit_event_reminder_target_wins(self):
        event = SimpleNamespace(reminder_target="going", is_mandatory=True)
        assert _resolve_event_reminder_target(event) == "going"

    def test_legacy_mandatory_event_defaults_to_all_members(self):
        event = SimpleNamespace(is_mandatory=True)
        assert _resolve_event_reminder_target(event) == "all"

    def test_legacy_optional_event_defaults_to_signed_up_members(self):
        event = SimpleNamespace(is_mandatory=False)
        assert _resolve_event_reminder_target(event) == "going"


def _mock_db():
    db = MagicMock()
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    return db


def _payload(cls=TrainingSessionCreate, **kw):
    start = datetime(2026, 9, 1, 18, 0, tzinfo=timezone.utc)
    base = dict(
        title="Hose Operations",
        start_datetime=start,
        end_datetime=start + timedelta(hours=2),
        requires_rsvp=False,
        use_existing_course=False,
        course_name="Hose Operations",
        training_type="skills_practice",
        credit_hours=2.0,
    )
    base.update(kw)
    return cls(**base)


def _added_events(db):
    return [
        call.args[0]
        for call in db.add.call_args_list
        if isinstance(call.args[0], Event)
    ]


class TestTrainingSessionReminderTarget:
    """create_training_session builds Event(...) directly, bypassing Pydantic."""

    async def test_mandatory_session_reminds_all_members(self):
        db = _mock_db()
        service = TrainingSessionService(db)

        _, error = await service.create_training_session(
            _payload(is_mandatory=True), uuid4(), uuid4()
        )

        assert error is None
        events = _added_events(db)
        assert len(events) == 1
        assert events[0].reminder_target == "all"

    async def test_optional_session_reminds_signed_up_members(self):
        db = _mock_db()
        service = TrainingSessionService(db)

        _, error = await service.create_training_session(
            _payload(is_mandatory=False), uuid4(), uuid4()
        )

        assert error is None
        events = _added_events(db)
        assert len(events) == 1
        assert events[0].reminder_target == "going"


class TestRecurringTrainingSessionReminderTarget:
    """The recurring path hands EventService a plain dict — it must carry the
    audience too, or every child event falls back to the column default."""

    async def _event_data_for(self, is_mandatory):
        service = TrainingSessionService(_mock_db())
        recurring = _payload(
            RecurringTrainingSessionCreate,
            is_mandatory=is_mandatory,
            recurrence_pattern="weekly",
            recurrence_end_date=datetime(2026, 10, 1, tzinfo=timezone.utc),
        )
        # Short-circuit after the call; only the handed-off dict matters here.
        with patch.object(
            EventService,
            "create_recurring_event",
            new=AsyncMock(return_value=([], "halt")),
        ) as create_mock:
            await service.create_recurring_training_session(recurring, uuid4(), uuid4())
        return create_mock.call_args.kwargs["event_data"]

    async def test_mandatory_series_reminds_all_members(self):
        event_data = await self._event_data_for(is_mandatory=True)
        assert event_data["reminder_target"] == "all"

    async def test_optional_series_reminds_signed_up_members(self):
        event_data = await self._event_data_for(is_mandatory=False)
        assert event_data["reminder_target"] == "going"

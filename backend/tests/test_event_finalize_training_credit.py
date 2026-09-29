"""Finalize's training-credit wiring, with the database mocked.

The integration suite (``test_event_training_credit_integration.py``) proves
the records land. These pin what only a mock can see: the order finalize takes
its locks in, that the credit runs inside the event's transaction and the
pipeline and officer email only after its commit, that a non-training event
never touches the training service, and how voiding treats a record that did
or did not carry credit.
"""

from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.event import EventType
from app.models.training import TrainingStatus
from app.services.event_service import EventService
from app.services.training_session_service import (
    EventTrainingCredit,
    TrainingSessionService,
)

pytestmark = pytest.mark.unit

NOW = datetime.now(timezone.utc)


def _one(value):
    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    return result


def _all(items):
    result = MagicMock()
    result.scalars.return_value.all.return_value = items
    return result


def _event(**overrides):
    fields = {
        "id": "event-1",
        "organization_id": "org-1",
        "title": "Hose Ops",
        "event_type": EventType.TRAINING,
        "custom_fields": {},
        "attendance_finalized_at": None,
        "attendance_finalized_by": None,
        "start_datetime": NOW - timedelta(hours=6),
        "end_datetime": NOW - timedelta(hours=2),
        "actual_end_time": None,
        "custom_category": None,
        "is_cancelled": False,
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


class _FakeTraining:
    """Records what finalize asks of the training service, and when."""

    def __init__(self, db, calls):
        self.db = db
        self.calls = calls

    async def lock_for_event_finalize(self, event, organization_id):
        self.calls.append(("lock", self.db.commit.await_count))
        return None, []

    async def record_event_attendance(self, *args, **kwargs):
        self.calls.append(("record", self.db.commit.await_count))
        return EventTrainingCredit(records_completed=1)

    async def after_event_attendance_recorded(self, *args, **kwargs):
        self.calls.append(("after", self.db.commit.await_count))


async def _finalize(event):
    db = MagicMock()
    order = []

    async def execute(statement, *args, **kwargs):
        order.append(str(statement).split("\n")[0][:40])
        if not order[:-1]:
            return _one(event)
        return _all([])

    db.execute = execute
    db.commit = AsyncMock()
    calls = []
    svc = EventService(db)
    svc._advance_prospects_after_finalize = AsyncMock()
    with patch(
        "app.services.training_session_service.TrainingSessionService",
        side_effect=lambda session: _FakeTraining(session, calls),
    ), patch("app.services.event_service.AdminHoursService") as admin_hours, patch(
        "app.services.event_service.NotificationsService"
    ) as notifications:
        notifications.return_value.archive_related_notifications = AsyncMock()
        admin_hours.return_value.delete_event_attendance_entries_for_event = AsyncMock(
            return_value=2
        )
        admin_hours.return_value.credit_event_attendance = AsyncMock(return_value=0)
        outcome = await svc.finalize_event_attendance_detailed(
            "event-1", "org-1", finalized_by="officer-1"
        )
    return outcome, calls, db, admin_hours


class TestFinalizeWiring:
    async def test_a_cancelled_event_is_refused_before_anything_is_locked(self):
        """Cancelling voided the credit; finalizing would write it back for an
        event that did not happen."""
        outcome, calls, db, admin_hours = await _finalize(_event(is_cancelled=True))

        assert outcome.error == "Cannot finalize attendance for a cancelled event"
        assert calls == []
        db.commit.assert_not_awaited()
        admin_hours.return_value.credit_event_attendance.assert_not_awaited()

    async def test_credit_is_inside_the_transaction_and_follow_up_after_it(self):
        outcome, calls, db, admin_hours = await _finalize(_event())

        assert outcome.error is None
        assert outcome.training_credit is True
        assert outcome.training_records_completed == 1
        # The lock and the credit happen before the one commit that closes the
        # event; the pipeline and the email wait for it.
        assert calls == [("lock", 0), ("record", 0), ("after", 1)]
        assert db.commit.await_count == 1

    async def test_training_removes_the_event_s_admin_hours_instead_of_crediting(
        self,
    ):
        outcome, _calls, _db, admin_hours = await _finalize(_event())

        service = admin_hours.return_value
        service.delete_event_attendance_entries_for_event.assert_awaited_once_with(
            "event-1", "org-1"
        )
        service.credit_event_attendance.assert_not_awaited()
        assert outcome.admin_hours_entries_removed == 2

    async def test_an_empty_roster_still_reaches_the_training_credit(self):
        """So a re-finalize that leaves nobody on the roster can void what an
        earlier finalize credited."""
        _outcome, calls, _db, _ah = await _finalize(_event())
        assert ("record", 0) in calls

    async def test_a_running_training_event_is_refused(self):
        event = _event(end_datetime=NOW + timedelta(hours=1))
        outcome, calls, db, _ah = await _finalize(event)

        assert "once the event has ended" in outcome.error
        assert calls == []
        db.commit.assert_not_awaited()

    async def test_other_events_never_touch_the_training_service(self):
        outcome, calls, _db, _ah = await _finalize(
            _event(event_type=EventType.BUSINESS_MEETING)
        )
        assert outcome.error is None
        assert outcome.training_credit is False
        assert calls == []


class TestVoiding:
    """Taking credit back when an attendee is removed or no longer credited."""

    def _svc(self, records):
        db = MagicMock()
        db.execute = AsyncMock(return_value=_all(records))
        db.delete = AsyncMock()
        db.flush = AsyncMock()
        return TrainingSessionService(db), db

    async def test_a_credited_record_is_cancelled_with_a_note(self):
        record = SimpleNamespace(
            user_id="user-1",
            course_id=None,
            status=TrainingStatus.COMPLETED,
            completion_date=date(2026, 9, 20),
            hours_completed=4.0,
            notes=None,
        )
        svc, db = self._svc([record])

        changed = await svc.void_event_records(
            "event-1", "org-1", event_title="Hose Ops", only_user_ids={"user-1"}
        )

        assert changed == 1
        assert record.status == TrainingStatus.CANCELLED
        assert record.hours_completed == 0.0
        assert "removed from 'Hose Ops' attendance; was 4.00 h" in record.notes
        db.delete.assert_not_awaited()

    async def test_a_placeholder_that_never_carried_credit_is_deleted(self):
        record = SimpleNamespace(
            user_id="user-1",
            course_id=None,
            status=TrainingStatus.IN_PROGRESS,
            completion_date=None,
            hours_completed=0.0,
            notes=None,
        )
        svc, db = self._svc([record])

        changed = await svc.void_event_records("event-1", "org-1")

        assert changed == 1
        db.delete.assert_awaited_once_with(record)

    async def test_an_already_cancelled_record_is_left_alone(self):
        record = SimpleNamespace(
            user_id="user-1",
            course_id=None,
            status=TrainingStatus.CANCELLED,
            completion_date=date(2026, 9, 20),
            hours_completed=0.0,
            notes="[Voided: ...]",
        )
        svc, db = self._svc([record])

        assert await svc.void_event_records("event-1", "org-1") == 0
        assert record.notes == "[Voided: ...]"

    async def test_the_sourced_query_is_org_scoped(self):
        svc, db = self._svc([])
        await svc.void_event_records("event-1", "org-1", keep_user_ids={"user-2"})

        statement = db.execute.await_args_list[0].args[0]
        compiled = str(statement.compile(compile_kwargs={"literal_binds": True}))
        assert "training_records.organization_id = 'org-1'" in compiled
        assert "training_records.source_event_id = 'event-1'" in compiled
        assert "NOT IN ('user-2')" in compiled


class TestSnapshot:
    def test_the_roster_carries_the_credited_times(self):
        start = NOW - timedelta(hours=6)
        event = _event(start_datetime=start)
        rsvp = SimpleNamespace(
            user_id="user-1",
            checked_in_at=start - timedelta(minutes=30),
            checked_out_at=None,
            override_check_in_at=None,
            override_check_out_at=start + timedelta(hours=3),
            override_duration_minutes=None,
        )
        user = SimpleNamespace(first_name="Pat", last_name="Tester", email=None)

        entry = TrainingSessionService._attendee_snapshot_entry(
            event, rsvp, user, start + timedelta(hours=4), 180
        )

        # The early tap is clamped to the start; the corrected check-out wins.
        assert entry["checked_in_at"] == start.isoformat()
        assert entry["checked_out_at"] == (start + timedelta(hours=3)).isoformat()
        assert entry["calculated_duration_minutes"] == 180
        assert entry["user_name"] == "Pat Tester"
        assert entry["user_email"] == ""

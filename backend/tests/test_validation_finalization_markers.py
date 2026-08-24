"""Finalize-time completion markers for post-event/shift validation prompts.

PR #1442 review: attendance finalization was only recorded by the reminder
task itself (custom_fields.validation_notification_sent), so an event
finalized before the task ever ran (end_event, record_actual_times
auto-finalize, or the manual endpoint) still drew a stale "validate
attendance" prompt later. Shifts had the same gap: the reminder query never
filtered Shift.is_finalized, and the service finalize path never archived
the prompt. These tests lock the durable marker, the task-side skips, and
the archive call on every finalize path. DB mocked; no MySQL.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.services import scheduled_tasks
from app.services.event_service import ATTENDANCE_LOCKED_PREFIX, EventService
from app.services.scheduling_service import SchedulingService


def _one(value):
    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    return result


def _all(items):
    result = MagicMock()
    result.scalars.return_value.all.return_value = items
    return result


def _scalar(value):
    result = MagicMock()
    result.scalar.return_value = value
    return result


def _ended_event(custom_fields=None, finalized_at=None):
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id="event-1",
        custom_fields=custom_fields,
        actual_end_time=now - timedelta(hours=1),
        end_datetime=now - timedelta(hours=2),
        attendance_finalized_at=finalized_at,
        attendance_finalized_by=None,
    )


class TestEventFinalizeMarker:
    async def test_finalize_with_no_open_rsvps_still_records_completion(self):
        event = _ended_event()
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_one(event), _all([]), _all([])])
        db.commit = AsyncMock()
        svc = EventService(db)

        with patch("app.services.event_service.NotificationsService") as notif_cls:
            archive = AsyncMock()
            notif_cls.return_value.archive_related_notifications = archive
            count, err = await svc.finalize_event_attendance("event-1", "org-1")

        assert err is None
        assert count == 0
        assert event.custom_fields == {"attendance_finalized": True}
        # The column is the lock; the JSON marker is kept for the reminder task.
        assert event.attendance_finalized_at is not None
        db.commit.assert_awaited_once()
        archive.assert_awaited_once_with(
            "org-1", "event_validation", "event_id", "event-1"
        )

    async def test_finalizing_an_already_finalized_event_is_refused(self):
        """Finalize is a state transition now, so the second press is a
        conflict rather than a silent re-run over closed attendance."""
        event = _ended_event(custom_fields={"attendance_finalized": True})
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_one(event)])
        db.commit = AsyncMock()
        svc = EventService(db)

        count, err = await svc.finalize_event_attendance("event-1", "org-1")

        assert count == 0
        assert err is not None
        assert err.startswith(ATTENDANCE_LOCKED_PREFIX)
        db.commit.assert_not_awaited()

    async def test_marker_reassigns_a_deep_copy_of_custom_fields(self):
        """Pitfall #12: the marker must land on a fresh deep copy — sharing
        nested references with the committed state can turn the reassignment
        into a silent no-op UPDATE."""
        committed = {"registration": {"limit": 5}}
        event = _ended_event(custom_fields=committed)
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_one(event), _all([]), _all([])])
        db.commit = AsyncMock()
        svc = EventService(db)

        with patch("app.services.event_service.NotificationsService") as notif_cls:
            notif_cls.return_value.archive_related_notifications = AsyncMock()
            await svc.finalize_event_attendance("event-1", "org-1")

        assert event.custom_fields is not committed
        assert event.custom_fields["registration"] is not committed["registration"]
        assert event.custom_fields["attendance_finalized"] is True
        # The stand-in for SQLAlchemy's committed state was never mutated.
        assert committed == {"registration": {"limit": 5}}


class TestPostEventValidationSkips:
    async def test_event_finalized_before_task_ran_gets_no_stale_prompt(self):
        org = SimpleNamespace(id="org-1", settings={})
        event = SimpleNamespace(custom_fields={"attendance_finalized": True})
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_all([org]), _all([event])])
        db.add = MagicMock()
        db.commit = AsyncMock()

        result = await scheduled_tasks.run_post_event_validation(db)

        assert result["total_notifications"] == 0
        db.add.assert_not_called()

    async def test_legacy_sent_marker_still_skips(self):
        org = SimpleNamespace(id="org-1", settings={})
        event = SimpleNamespace(custom_fields={"validation_notification_sent": True})
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_all([org]), _all([event])])
        db.add = MagicMock()
        db.commit = AsyncMock()

        result = await scheduled_tasks.run_post_event_validation(db)

        assert result["total_notifications"] == 0
        db.add.assert_not_called()


class TestPostShiftValidationSkips:
    async def test_reminder_query_excludes_finalized_shifts(self):
        org = SimpleNamespace(id="org-1", settings={})
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_all([org]), _all([])])
        db.commit = AsyncMock()

        result = await scheduled_tasks.run_post_shift_validation(db)

        assert result["total_notifications"] == 0
        shift_stmt = db.execute.await_args_list[1].args[0]
        compiled = str(
            shift_stmt.compile(compile_kwargs={"literal_binds": True})
        ).lower()
        assert "is_finalized is false" in compiled


class TestFinalizeShiftArchivesPrompt:
    async def test_finalize_shift_archives_validation_prompt(self):
        now = datetime.now(timezone.utc)
        shift = SimpleNamespace(
            id="shift-1",
            is_finalized=False,
            start_time=now - timedelta(hours=10),
            end_time=now - timedelta(hours=1),
            apparatus_id=None,
        )
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _one(SimpleNamespace(settings={})),  # org settings lookup
                _all([]),  # open attendance to auto-close
                _scalar(0),  # call count snapshot
                _scalar(0),  # total minutes snapshot
                _all([]),  # attendance rows for per-member call counts
            ]
        )
        db.flush = AsyncMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        svc = SchedulingService(db)
        svc.get_shift_by_id = AsyncMock(return_value=shift)
        svc.compute_member_call_counts = AsyncMock(return_value={})
        svc._create_draft_reports_for_trainees = AsyncMock(return_value=0)

        with patch("app.services.scheduling_service.NotificationsService") as notif_cls:
            archive = AsyncMock()
            notif_cls.return_value.archive_related_notifications = archive
            result, err = await svc.finalize_shift(
                "shift-1", "org-1", finalized_by_user_id="officer-1"
            )

        assert err is None
        assert result is shift
        assert shift.is_finalized is True
        archive.assert_awaited_once_with(
            "org-1", "shift_validation", "shift_id", "shift-1"
        )

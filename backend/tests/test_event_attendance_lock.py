"""The attendance lock: finalizing an event closes it, reopening is a grant.

Finalizing used to be a recalculation with no state behind it. It wrote
``custom_fields["attendance_finalized"]``, which exactly one consumer read (the
post-event validation reminder) and no mutation checked — so check-in, adding
and removing attendees, correcting credited times, re-recording the clock and
deleting the event all kept working afterwards. A correction made then never
reached the admin-hours entry already credited from the finalized duration,
because ``credit_event_attendance`` skips an RSVP it has already credited: the
event screen and the hours ledger disagreed permanently, behind a success
toast.

These tests lock the state transition (every attendance write refused once
``attendance_finalized_at`` is set), the way back (reopen clears the derived
durations so re-finalizing genuinely recomputes), and the resync that carries a
correction into the ledger. DB mocked; no MySQL.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.permissions import ALL_PERMISSIONS, OPERATIONAL_RANKS
from app.models.admin_hours import AdminHoursEntryMethod
from app.services.admin_hours_service import AdminHoursService
from app.services.event_service import (
    ATTENDANCE_LOCKED_PREFIX,
    EventService,
    attendance_is_finalized,
    attendance_locked_error,
)


def _one(value):
    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    return result


def _all(items):
    result = MagicMock()
    result.scalars.return_value.all.return_value = items
    return result


def _event(finalized=True, **overrides):
    now = datetime.now(timezone.utc)
    fields = {
        "id": "event-1",
        "organization_id": "org-1",
        "title": "Monthly Drill",
        "custom_fields": {"attendance_finalized": True} if finalized else {},
        "attendance_finalized_at": now - timedelta(hours=1) if finalized else None,
        "attendance_finalized_by": "chief-1" if finalized else None,
        "start_datetime": now - timedelta(hours=4),
        "end_datetime": now - timedelta(hours=2),
        "actual_start_time": None,
        "actual_end_time": now - timedelta(hours=2),
        "is_cancelled": False,
        "max_attendees": None,
        "event_type": None,
        "custom_category": None,
        "updated_at": now,
        "check_in_window_type": None,
        "check_in_minutes_before": 60,
        "check_in_minutes_after": 15,
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


def _mock_db(*results):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=list(results))
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.delete = AsyncMock()
    db.flush = AsyncMock()
    db.add = MagicMock()
    return db


class TestLockPredicate:
    def test_column_is_the_authority(self):
        assert attendance_is_finalized(_event()) is True
        assert attendance_is_finalized(_event(finalized=False)) is False

    def test_legacy_json_marker_still_locks(self):
        """A row the migration's dialect guard skipped keeps its lock rather
        than silently reopening on deploy."""
        legacy = _event(finalized=False, custom_fields={"attendance_finalized": True})
        assert attendance_is_finalized(legacy) is True

    def test_refusal_carries_the_sentinel_prefix(self):
        message = attendance_locked_error("checking a member in")
        assert message.startswith(ATTENDANCE_LOCKED_PREFIX)
        assert "checking a member in" in message


class TestFinalizedEventRefusesAttendanceWrites:
    async def test_check_in_is_refused(self):
        svc = EventService(_mock_db(_one(_event())))
        rsvp, err = await svc.check_in_attendee("event-1", "user-1", "org-1")
        assert rsvp is None
        assert err.startswith(ATTENDANCE_LOCKED_PREFIX)

    async def test_add_attendee_is_refused(self):
        svc = EventService(_mock_db(_one(_event())))
        rsvp, err = await svc.manager_add_attendee(
            event_id="event-1",
            user_id="user-1",
            organization_id="org-1",
            manager_id="mgr-1",
        )
        assert rsvp is None
        assert err.startswith(ATTENDANCE_LOCKED_PREFIX)

    async def test_override_is_refused(self):
        svc = EventService(_mock_db(_one(_event())))
        rsvp, err = await svc.override_rsvp_attendance(
            event_id="event-1",
            user_id="user-1",
            organization_id="org-1",
            manager_id="mgr-1",
            override_data=SimpleNamespace(model_dump=lambda **_: {}),
        )
        assert rsvp is None
        assert err.startswith(ATTENDANCE_LOCKED_PREFIX)

    async def test_remove_attendee_is_refused(self):
        svc = EventService(_mock_db(_one(_event())))
        err = await svc.remove_attendee("event-1", "user-1", "org-1")
        assert err.startswith(ATTENDANCE_LOCKED_PREFIX)

    async def test_record_actual_times_is_refused(self):
        svc = EventService(_mock_db(_one(_event())))
        event, err = await svc.record_actual_times(
            event_id="event-1",
            organization_id="org-1",
            actual_start_time=None,
            actual_end_time=datetime.now(timezone.utc),
        )
        assert event is None
        assert err.startswith(ATTENDANCE_LOCKED_PREFIX)

    async def test_self_check_in_is_refused(self):
        svc = EventService(_mock_db(_one(_event())))
        rsvp, err, notice = await svc.self_check_in("event-1", "user-1", "org-1")
        assert rsvp is None
        assert notice is None
        assert err.startswith(ATTENDANCE_LOCKED_PREFIX)

    async def test_end_event_is_refused(self):
        svc = EventService(_mock_db(_one(_event())))
        event, count, err = await svc.end_event("event-1", "org-1")
        assert event is None
        assert count == 0
        assert err.startswith(ATTENDANCE_LOCKED_PREFIX)

    async def test_delete_is_refused(self):
        """Deleting cascades the RSVPs — the record the credited hours came
        from."""
        db = _mock_db(_one(_event()))
        svc = EventService(db)
        with pytest.raises(ValueError, match=ATTENDANCE_LOCKED_PREFIX) as excinfo:
            await svc.delete_event("event-1", "org-1")
        assert str(excinfo.value).startswith(ATTENDANCE_LOCKED_PREFIX)
        db.delete.assert_not_called()

    async def test_qr_payload_is_refused(self):
        svc = EventService(_mock_db(_one(_event())))
        data, err = await svc.get_qr_check_in_data("event-1", "org-1")
        assert data is None
        assert err.startswith(ATTENDANCE_LOCKED_PREFIX)

    async def test_waitlist_promotion_declines_quietly(self):
        """This one runs unattended from remove_attendee, so it returns None
        rather than an error string nobody would read."""
        svc = EventService(_mock_db(_one(_event(max_attendees=10))))
        assert await svc.promote_from_waitlist("event-1", "org-1") is None


class TestOpenEventStillAcceptsWrites:
    async def test_check_in_reaches_the_window_check_when_not_finalized(self):
        """The guard must key on the lock, not on the event being over."""
        event = _event(finalized=False)
        db = _mock_db(_one(event), _one(SimpleNamespace(timezone="UTC")))
        svc = EventService(db)
        rsvp, err = await svc.check_in_attendee("event-1", "user-1", "org-1")
        # Refused by the check-in window (the event ended two hours ago), which
        # is a different refusal — and specifically not the lock.
        assert rsvp is None
        assert not (err or "").startswith(ATTENDANCE_LOCKED_PREFIX)


class TestUpdateSplitsDescriptiveFromAttendanceSensitive:
    async def test_retitling_a_closed_event_is_allowed(self):
        event = _event(
            title="Old title",
            description=None,
            location_id=None,
            location=None,
            location_obj=None,
            is_draft=False,
            updated_by=None,
        )
        db = _mock_db(_one(event))
        svc = EventService(db)
        payload = SimpleNamespace(
            model_dump=lambda **_: {"title": "Monthly Drill (corrected)"}
        )

        result = await svc.update_event("event-1", "org-1", payload)

        assert result is event
        assert event.title == "Monthly Drill (corrected)"

    async def test_moving_the_clock_of_a_closed_event_is_refused(self):
        event = _event()
        svc = EventService(_mock_db(_one(event)))
        new_end = datetime.now(timezone.utc)
        payload = SimpleNamespace(model_dump=lambda **_: {"end_datetime": new_end})

        with pytest.raises(ValueError, match=ATTENDANCE_LOCKED_PREFIX) as excinfo:
            await svc.update_event("event-1", "org-1", payload)

        assert str(excinfo.value).startswith(ATTENDANCE_LOCKED_PREFIX)
        assert "end_datetime" in str(excinfo.value)
        assert event.end_datetime != new_end


class TestReopen:
    async def test_reopen_clears_the_lock_and_the_derived_durations(self):
        event = _event()
        derived = SimpleNamespace(attendance_duration_minutes=120)
        db = _mock_db(_one(event), _all([derived]))
        svc = EventService(db)

        result, err = await svc.reopen_event_attendance("event-1", "org-1")

        assert err is None
        assert result is event
        assert event.attendance_finalized_at is None
        assert event.attendance_finalized_by is None
        assert "attendance_finalized" not in event.custom_fields
        # Cleared so a corrected end time actually reflows: finalize only fills
        # a NULL duration.
        assert derived.attendance_duration_minutes is None
        db.commit.assert_awaited_once()

    async def test_reopen_clears_the_reminder_marker_too(self):
        """Otherwise the post-event validation task considers itself done and
        never prompts again for an event that is open once more."""
        event = _event(
            custom_fields={
                "attendance_finalized": True,
                "validation_notification_sent": True,
                "room_setup": "hall",
            }
        )
        db = _mock_db(_one(event), _all([]))
        svc = EventService(db)

        await svc.reopen_event_attendance("event-1", "org-1")

        assert "validation_notification_sent" not in event.custom_fields
        # Organizer configuration in the same column is left alone.
        assert event.custom_fields["room_setup"] == "hall"

    async def test_reopen_reassigns_a_deep_copy(self):
        """Pitfall #12: a shallow copy shares nested references with the
        committed state, and the write can be a silent no-op."""
        committed = {"attendance_finalized": True, "registration": {"limit": 5}}
        event = _event(custom_fields=committed)
        db = _mock_db(_one(event), _all([]))

        await EventService(db).reopen_event_attendance("event-1", "org-1")

        assert event.custom_fields is not committed
        assert event.custom_fields["registration"] is not committed["registration"]
        assert committed["attendance_finalized"] is True

    async def test_reopening_an_open_event_is_refused(self):
        svc = EventService(_mock_db(_one(_event(finalized=False))))
        result, err = await svc.reopen_event_attendance("event-1", "org-1")
        assert result is None
        assert err == "Attendance for this event is not finalized"

    async def test_missing_event_reports_not_found(self):
        svc = EventService(_mock_db(_one(None)))
        result, err = await svc.reopen_event_attendance("event-1", "org-1")
        assert result is None
        assert err == "Event not found"


class TestAdminHoursResync:
    """The bug the lock exists to prevent: a correction that never reaches the
    ledger because credit is idempotent per (RSVP, category)."""

    def _service_with_entry(self, entry):
        db = _mock_db(_one(entry))
        svc = AdminHoursService(db)
        svc.get_mappings_for_event = AsyncMock(
            return_value=[("cat-1", 100, SimpleNamespace())]
        )
        return svc, db

    def _entry(self, method=AdminHoursEntryMethod.EVENT_ATTENDANCE):
        return SimpleNamespace(
            id="entry-1",
            duration_minutes=120,
            clock_in_at=None,
            clock_out_at=None,
            description="Event attendance: Monthly Drill",
            entry_method=method,
        )

    async def _credit(self, svc, duration, resync):
        now = datetime.now(timezone.utc)
        return await svc.credit_event_attendance(
            organization_id="org-1",
            user_id="user-1",
            event_id="event-1",
            rsvp_id="rsvp-1",
            event_title="Monthly Drill",
            check_in_at=now - timedelta(minutes=duration),
            check_out_at=now,
            duration_minutes=duration,
            event_type="training",
            custom_category=None,
            resync=resync,
        )

    async def test_without_resync_an_existing_entry_is_left_alone(self):
        entry = self._entry()
        svc, _ = self._service_with_entry(entry)

        count = await self._credit(svc, 45, resync=False)

        assert count == 0
        assert entry.duration_minutes == 120

    async def test_resync_moves_the_credited_minutes(self):
        entry = self._entry()
        svc, db = self._service_with_entry(entry)

        count = await self._credit(svc, 45, resync=True)

        assert count == 1
        assert entry.duration_minutes == 45
        assert entry.clock_out_at is not None
        # Updated in place: the id, and with it the approval and audit trail,
        # survive the correction.
        db.add.assert_not_called()
        db.delete.assert_not_called()

    async def test_resync_leaves_a_hand_edited_entry_alone(self):
        """An entry a member or officer took over by hand is theirs, not a
        derivative of the RSVP."""
        entry = self._entry(method=AdminHoursEntryMethod.MANUAL)
        svc, _ = self._service_with_entry(entry)

        count = await self._credit(svc, 45, resync=True)

        assert count == 0
        assert entry.duration_minutes == 120


class TestRemovingAnAttendeeTakesTheHoursWithIt:
    async def test_entries_are_deleted_with_the_rsvp(self):
        """source_rsvp_id is ondelete=SET NULL, so without this the entry
        outlives the attendance that justified it."""
        event = _event(finalized=False)
        rsvp = SimpleNamespace(id="rsvp-1", status=None)
        db = _mock_db(_one(event), _one(rsvp))
        svc = EventService(db)

        with patch("app.services.event_service.AdminHoursService") as ahs_cls:
            delete_entries = AsyncMock(return_value=1)
            ahs_cls.return_value.delete_event_attendance_entries = delete_entries
            err = await svc.remove_attendee("event-1", "user-1", "org-1")

        assert err is None
        delete_entries.assert_awaited_once_with("rsvp-1")


class TestBackfillMigration:
    """The columns arrive with history already in the JSON marker."""

    REVISION = "c3f8a29d54e1"

    def _source(self):
        from pathlib import Path

        versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
        matches = [p for p in versions.glob("*.py") if self.REVISION in p.name]
        assert matches, f"no migration file for {self.REVISION}"
        return matches[0].read_text(encoding="utf-8")

    def test_add_column_is_guarded_so_a_re_run_changes_nothing(self):
        source = self._source()
        assert 'if "attendance_finalized_at" not in columns' in source
        assert 'if "attendance_finalized_by" not in columns' in source

    def test_existing_markers_are_backfilled(self):
        """Without this every historically finalized event comes back unlocked
        on deploy, and the whole fleet's past attendance reopens at once."""
        source = self._source()
        assert "attendance_finalized" in source
        assert "COALESCE(actual_end_time, end_datetime)" in source
        assert "attendance_finalized_at IS NULL" in source

    def test_backfill_is_skipped_on_a_dialect_without_json_extract(self):
        source = self._source()
        assert 'bind.dialect.name != "mysql"' in source

    def test_downgrade_drops_what_it_added(self):
        source = self._source()
        downgrade = source.split("def downgrade()", 1)[1]
        assert 'op.drop_column("events", "attendance_finalized_at")' in downgrade
        assert 'op.drop_column("events", "attendance_finalized_by")' in downgrade
        # The FK has to go first or MySQL refuses to drop the column.
        assert downgrade.index("drop_constraint") < downgrade.index(
            'op.drop_column("events", "attendance_finalized_by")'
        )


class TestReopenPermissionIsSeparate:
    def test_permission_exists_in_the_catalog(self):
        names = {p.name for p in ALL_PERMISSIONS}
        assert "events.reopen_attendance" in names

    def test_leadership_ranks_get_it_and_the_rest_do_not(self):
        """The point of the split: nine default roles hold events.manage, and
        the organizer who closed the event must not be able to reopen it."""
        for rank in ("fire_chief", "deputy_chief", "assistant_chief"):
            granted = OPERATIONAL_RANKS[rank]["default_permissions"]
            assert "events.reopen_attendance" in granted
            assert "events.manage" in granted

    def test_event_managing_officers_do_not_get_it(self):
        from app.core.permissions import DEFAULT_ROLES

        for role in ("public_outreach", "communications_officer", "secretary"):
            granted = DEFAULT_ROLES[role]["permissions"]
            assert "events.manage" in granted, role
            assert "events.reopen_attendance" not in granted, role

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
        # A resync first sweeps entries under categories the event no longer
        # maps to, then looks up the entry for each current mapping.
        db = _mock_db(_all([]), _one(entry))
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


class TestEveryAttendeeReachesTheLedger:
    """PR #1791 review, P1: the credit loop iterated only the rows finalize
    itself derived a duration for, so anyone who had checked out — normally, or
    via End Event's bulk checkout, which stamps checked_out_at on the whole
    crew before finalize runs — was skipped and never credited at all."""

    async def test_a_checked_out_attendee_is_still_credited(self):
        event = _event(finalized=False, event_type=None)
        checked_out = SimpleNamespace(
            id="rsvp-1",
            user_id="user-1",
            checked_in=True,
            checked_in_at=event.start_datetime,
            checked_out_at=event.end_datetime,
            override_duration_minutes=None,
            override_check_in_at=None,
            attendance_duration_minutes=90,
            early_check_in_minutes=None,
        )
        # derivable is empty (it has a check-out); attended still holds it.
        db = _mock_db(_one(event), _all([]), _all([checked_out]))
        svc = EventService(db)

        with patch("app.services.event_service.AdminHoursService") as ahs_cls, patch(
            "app.services.event_service.NotificationsService"
        ) as notif_cls:
            credit = AsyncMock(return_value=1)
            ahs_cls.return_value.credit_event_attendance = credit
            notif_cls.return_value.archive_related_notifications = AsyncMock()
            await svc.finalize_event_attendance("event-1", "org-1")

        credit.assert_awaited_once()
        assert credit.await_args.kwargs["rsvp_id"] == "rsvp-1"
        assert credit.await_args.kwargs["duration_minutes"] == 90

    async def test_end_event_records_a_duration_on_bulk_checkout(self):
        """Otherwise the rows it just checked out have no duration for the
        finalize that immediately follows to credit."""
        event = _event(finalized=False, actual_end_time=None)
        rsvp = SimpleNamespace(
            id="rsvp-1",
            user_id="user-1",
            checked_in=True,
            checked_in_at=event.start_datetime,
            checked_out_at=None,
            attendance_duration_minutes=None,
            override_duration_minutes=None,
            override_check_in_at=None,
            early_check_in_minutes=None,
            status=None,
        )
        db = _mock_db(_one(event), _all([rsvp]))
        svc = EventService(db)
        svc.finalize_event_attendance = AsyncMock(return_value=(1, None))

        result, count, err = await svc.end_event("event-1", "org-1")

        assert err is None
        assert count == 1
        assert rsvp.checked_out_at is not None
        assert rsvp.attendance_duration_minutes is not None
        assert rsvp.attendance_duration_minutes > 0


class TestSeriesPathsHonourTheLock:
    """PR #1791 review, P1: the single-event guards left the series endpoints
    as an open door to the same rows."""

    async def test_series_delete_is_refused_when_any_occurrence_is_closed(self):
        db = _mock_db(_all([_event(finalized=False), _event()]))
        svc = EventService(db)

        with pytest.raises(ValueError, match=ATTENDANCE_LOCKED_PREFIX):
            await svc.delete_event_series("parent-1", "org-1")

        db.delete.assert_not_called()

    async def test_series_delete_proceeds_when_all_are_open(self):
        events = [_event(finalized=False), _event(finalized=False)]
        db = _mock_db(_all(events))
        svc = EventService(db)

        deleted = await svc.delete_event_series("parent-1", "org-1")

        assert deleted == 2


class TestCustomFieldsCannotDropTheMarker:
    """PR #1791 review, P2: custom_fields is a whole-column replacement, so a
    payload without the lifecycle keys would strip the marker the post-event
    reminder reads while the column kept the event locked."""

    async def test_lifecycle_keys_survive_a_replacement(self):
        event = _event(
            custom_fields={"attendance_finalized": True, "room": "hall"},
            description=None,
            location_id=None,
            location=None,
            location_obj=None,
            is_draft=False,
            updated_by=None,
        )
        db = _mock_db(_one(event))
        payload = SimpleNamespace(
            model_dump=lambda **_: {"custom_fields": {"room": "bay"}}
        )

        await EventService(db).update_event("event-1", "org-1", payload)

        assert event.custom_fields["attendance_finalized"] is True
        assert event.custom_fields["room"] == "bay"


class TestLockIsAnAtomicTransition:
    """PR #1791 review, P1: the guard was check-then-act. Finalize read the
    event without a row lock and so did every writer, so a check-in could
    commit between finalize's roster snapshot and the close — leaving that
    member checked in, uncredited, and behind a lock with no way to see why."""

    def _locked(self, statement) -> bool:
        return (
            "for update"
            in str(statement.compile(compile_kwargs={"literal_binds": True})).lower()
        )

    async def test_finalize_takes_the_row_lock(self):
        db = _mock_db(_one(None))
        await EventService(db).finalize_event_attendance("event-1", "org-1")
        assert self._locked(db.execute.await_args.args[0])

    async def test_reopen_takes_the_row_lock(self):
        db = _mock_db(_one(None))
        await EventService(db).reopen_event_attendance("event-1", "org-1")
        assert self._locked(db.execute.await_args.args[0])

    async def test_every_attendance_writer_takes_it_too(self):
        """A writer that reads the lock and then writes has to hold the row, or
        it can act on a decision another transaction has already invalidated."""
        svc_calls = [
            ("check_in_attendee", lambda s: s.check_in_attendee("e", "u", "o")),
            (
                "manager_add_attendee",
                lambda s: s.manager_add_attendee(
                    event_id="e", user_id="u", organization_id="o", manager_id="m"
                ),
            ),
            (
                "override_rsvp_attendance",
                lambda s: s.override_rsvp_attendance(
                    event_id="e",
                    user_id="u",
                    organization_id="o",
                    manager_id="m",
                    override_data=SimpleNamespace(model_dump=lambda **_: {}),
                ),
            ),
            ("remove_attendee", lambda s: s.remove_attendee("e", "u", "o")),
            (
                "record_actual_times",
                lambda s: s.record_actual_times(
                    event_id="e",
                    organization_id="o",
                    actual_start_time=None,
                    actual_end_time=None,
                ),
            ),
            ("end_event", lambda s: s.end_event("e", "o")),
            ("self_check_in", lambda s: s.self_check_in("e", "u", "o")),
            ("delete_event", lambda s: s.delete_event("e", "o")),
        ]
        for name, call in svc_calls:
            db = _mock_db(_one(None))
            await call(EventService(db))
            assert self._locked(
                db.execute.await_args.args[0]
            ), f"{name} does not lock the event row"


class TestNewQueriesAreOrgScoped:
    """Pitfall #14: every by-id read filters organization_id, including the
    ones whose id came from a row that was already scoped."""

    def _compiled(self, statement):
        return str(statement.compile(compile_kwargs={"literal_binds": True})).lower()

    async def test_the_lock_precheck_scopes_its_event_fetch(self):
        db = _mock_db(_one(None))
        await EventService(db).attendance_lock_error_for(
            "event-1", "org-1", "adding attendees"
        )
        assert "organization_id" in self._compiled(db.execute.await_args.args[0])

    async def test_reopen_scopes_its_event_fetch(self):
        db = _mock_db(_one(None))
        await EventService(db).reopen_event_attendance("event-1", "org-1")
        assert "organization_id" in self._compiled(db.execute.await_args.args[0])

    async def test_the_finalizer_name_lookup_is_org_scoped(self):
        """The id is not client-supplied, but a bare by-id read on users is the
        exact shape the 2026-07 audit kept finding."""
        from pathlib import Path

        endpoint = (
            Path(__file__).resolve().parents[1]
            / "app"
            / "api"
            / "v1"
            / "endpoints"
            / "events.py"
        )
        source = endpoint.read_text(encoding="utf-8")
        lookup = source.split("attendance_finalized_by:", 1)[1][:500]
        assert "User.organization_id == current_user.organization_id" in lookup


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

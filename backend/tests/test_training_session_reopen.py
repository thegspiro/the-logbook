"""Reopening a finalized training session.

Finalizing a session was one-way: ``is_finalized`` refused a second finalize
and nothing ever cleared it, so a member left off the roster could never be
added and a wrong duration could never be fixed. That is the mirror image of
the event side's failure, which locked nothing at all — same feature, two
opposite bugs.

These tests cover the way back, and the one thing reopening must not leave
behind: an approval token already emailed to the training officers against
attendee data that is about to change.

DB is mocked; no MySQL.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest

from app.models.training import ApprovalStatus, EnrollmentStatus
from app.services.training_session_service import TrainingSessionService


@pytest.fixture(autouse=True)
def _utc_department(monkeypatch):
    """The service reads the department's zone; answer UTC so the dates the
    fixtures here are built from keep meaning what they say."""
    for module in ("app.services.training_session_service",):
        monkeypatch.setattr(
            f"{module}.resolve_scheduling_timezone",
            AsyncMock(return_value=ZoneInfo("UTC")),
        )


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _all(items):
    result = MagicMock()
    result.scalars.return_value.all.return_value = items
    return result


def _session(finalized=True):
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id="session-1",
        organization_id="org-1",
        event_id="event-1",
        is_finalized=finalized,
        finalized_at=now - timedelta(hours=1) if finalized else None,
        finalized_by="chief-1" if finalized else None,
        updated_at=now - timedelta(hours=1),
    )


def _approval(status=ApprovalStatus.PENDING):
    return SimpleNamespace(
        id="approval-1",
        status=status,
        token_expires_at=datetime.now(timezone.utc) + timedelta(days=30),
    )


def _db(*results):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=list(results))
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    return db


def _event(finalized=False):
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id="event-1",
        organization_id="org-1",
        custom_fields={"attendance_finalized": True} if finalized else {},
        attendance_finalized_at=now - timedelta(hours=1) if finalized else None,
    )


class TestReopenTrainingSession:
    """The session's flag follows its event's attendance lock. These cover a
    session the old finalize route closed on its own — its event's attendance
    was never closed — which is reopened alone, under the event's lock."""

    async def test_reopen_clears_the_finalized_state(self):
        session = _session()
        # The session read, the event lock, then the session and its pending
        # approvals locked again in the order every writer takes them.
        db = _db(_one(session), _one(_event()), _one(session), _all([]))

        result, err = await TrainingSessionService(db).reopen_training_session(
            "session-1", "org-1"
        )

        assert err is None
        assert result is session
        assert session.is_finalized is False
        assert session.finalized_at is None
        assert session.finalized_by is None
        db.commit.assert_awaited_once()

    async def test_pending_approval_token_is_expired(self):
        """It was emailed against attendee data the reopen is about to change,
        and re-finalizing issues a fresh one."""
        session = _session()
        approval = _approval()
        before = approval.token_expires_at
        db = _db(_one(session), _one(_event()), _one(session), _all([approval]))

        await TrainingSessionService(db).reopen_training_session("session-1", "org-1")

        assert approval.token_expires_at < before
        assert approval.token_expires_at <= datetime.now(timezone.utc)
        # Not marked rejected: no officer rejected anything.
        assert approval.status == ApprovalStatus.PENDING

    async def test_only_pending_approvals_are_queried(self):
        """An approved one keeps its record — re-finalizing updates the
        training records in place rather than duplicating them."""
        session = _session()
        db = _db(_one(session), _one(_event()), _one(session), _all([]))

        await TrainingSessionService(db).reopen_training_session("session-1", "org-1")

        approval_stmt = db.execute.await_args_list[3].args[0]
        compiled = str(
            approval_stmt.compile(compile_kwargs={"literal_binds": True})
        ).lower()
        assert "status" in compiled
        assert "pending" in compiled

    async def test_a_finalized_event_is_reopened_through_its_attendance(self):
        """Reopening only the session left the event locked while a second
        finalize could write credit behind that lock."""
        session = _session()
        db = _db(_one(session), _one(_event(finalized=True)))

        with patch(
            "app.services.training_session_service.EventService.reopen_event_attendance",
            AsyncMock(return_value=(SimpleNamespace(), None)),
        ) as reopen:
            result, err = await TrainingSessionService(db).reopen_training_session(
                "session-1", "org-1"
            )

        assert (result, err) == (session, None)
        reopen.assert_awaited_once_with("event-1", "org-1")

    async def test_reopening_an_open_session_is_refused(self):
        db = _db(_one(_session(finalized=False)))

        result, err = await TrainingSessionService(db).reopen_training_session(
            "session-1", "org-1"
        )

        assert result is None
        assert err == "Training session is not finalized"
        db.commit.assert_not_awaited()

    async def test_missing_session_reports_not_found(self):
        db = _db(_one(None))

        result, err = await TrainingSessionService(db).reopen_training_session(
            "session-1", "org-1"
        )

        assert result is None
        assert err == "Training session not found"


class TestRestatingCorrectedHours:
    """PR #1791 review, P1: the progress ledger is idempotent per
    (progress, source_type, source_id), so a re-finalize after a reopen applied
    no delta at all — the training record moved to the corrected hours while the
    pipeline kept the first finalize's figure. ``restate`` is the way through."""

    def _service(self, existing_units):
        from app.services.training_program_service import TrainingProgramService

        db = MagicMock()
        db.execute = AsyncMock()
        db.commit = AsyncMock()
        db.flush = AsyncMock()
        db.add = MagicMock()
        svc = TrainingProgramService(db)
        progress = SimpleNamespace(
            id="prog-1",
            enrollment_id="enr-1",
            enrollment=SimpleNamespace(user_id="user-1"),
            progress_value=existing_units,
            status="in_progress",
        )
        svc._get_org_scoped_progress = AsyncMock(return_value=progress)
        credit = SimpleNamespace(id="cred-1", units=existing_units)
        db.execute.return_value = _one(credit)
        svc.revoke_requirement_credit = AsyncMock(return_value=(progress, None))
        svc.update_requirement_progress = AsyncMock(return_value=(progress, None))
        return svc, progress

    async def _apply(self, svc, units, restate):
        from app.models.training import ProgressCreditSource

        return await svc.apply_requirement_credit(
            progress_id="prog-1",
            organization_id="org-1",
            source_type=ProgressCreditSource.TRAINING_SESSION,
            source_id="session-1",
            units=units,
            restate=restate,
        )

    async def test_without_restate_a_replay_stays_a_no_op(self):
        svc, _ = self._service(existing_units=3.0)
        await self._apply(svc, 5.0, restate=False)
        svc.revoke_requirement_credit.assert_not_awaited()
        svc.update_requirement_progress.assert_not_awaited()

    async def test_restate_reverses_then_reapplies_when_hours_change(self):
        svc, _ = self._service(existing_units=3.0)
        await self._apply(svc, 5.0, restate=True)
        svc.revoke_requirement_credit.assert_awaited_once()
        # Fell through to the normal apply path with the corrected figure.
        svc.update_requirement_progress.assert_awaited_once()

    async def test_restate_with_identical_hours_changes_nothing(self):
        """Re-finalizing without touching the times must stay a no-op — the
        reversal churns enrollment rollup and phase state for nothing."""
        svc, _ = self._service(existing_units=3.0)
        await self._apply(svc, 3.0, restate=True)
        svc.revoke_requirement_credit.assert_not_awaited()
        svc.update_requirement_progress.assert_not_awaited()


class TestReopenSerializesAgainstApproval:
    async def test_reopen_locks_event_then_session_then_approvals(self):
        """Event, session, approvals: the order finalize and approval submit
        take them in, so none of the three can deadlock against another."""
        session = _session()
        db = _db(_one(session), _one(_event()), _one(session), _all([]))
        await TrainingSessionService(db).reopen_training_session("session-1", "org-1")

        locked = [
            str(c.args[0].compile(compile_kwargs={"literal_binds": True})).lower()
            for c in db.execute.await_args_list[1:4]
        ]
        assert all("for update" in stmt for stmt in locked)
        assert [stmt.split("from ")[1].split()[0] for stmt in locked] == [
            "events",
            "training_sessions",
            "training_approvals",
        ]


class TestCompletedEnrollmentsAreNotSkipped:
    """PR #1798 review, P1: an ACTIVE-only enrollment lookup skips exactly the
    member whose credit carried them over 100% — completing the program moves
    the enrollment to COMPLETED, so neither the correction nor the revocation
    found anything to act on."""

    def _statuses_in(self, statement) -> str:
        return str(statement.compile(compile_kwargs={"literal_binds": True})).lower()

    async def test_revocation_reaches_every_enrollment(self):
        """Found by the session as the credit's source, joined through every
        enrollment the member holds — so a completed one is not skipped, and
        neither is a program the session has since been unlinked from."""
        program_service = MagicMock()
        program_service.reverse_credits_for_source = AsyncMock(return_value=1)
        session = _session()
        session.program_id = None

        await TrainingSessionService(_db())._revoke_pipeline_credit_for_user(
            program_service=program_service,
            user_id="user-1",
            training_session=session,
            organization_id="org-1",
            verified_by="chief-1",
            source_type=None,
        )

        program_service.reverse_credits_for_source.assert_awaited_once_with(
            organization_id="org-1",
            source_id="session-1",
            source_type=None,
            verified_by="chief-1",
            user_id="user-1",
        )

    async def test_correction_looks_past_active(self):
        db = _db(_all([]))
        svc = TrainingSessionService(db)

        await svc._apply_pipeline_progress(
            user_id="user-1",
            program_id="prog-1",
            requirement_id="req-1",
            hours_completed=4.0,
            organization_id="org-1",
            verified_by="chief-1",
            session_id="session-1",
        )

        sql = self._statuses_in(db.execute.await_args.args[0])
        assert "completed" in sql
        assert "active" in sql


class TestStaleDestinationsAreReconciled:
    """PR #1798 review, P1: restating only the current destinations left credit
    standing wherever the session used to point. A corrected linkage moves the
    credit to different requirement rows (different progress_id), and a member
    corrected to zero hours is never queued at all — both leave the old credit
    in place unless the sweep reverses it."""

    async def test_destinations_no_longer_fed_are_reversed(self):
        db = _db()
        svc = TrainingSessionService(db)
        svc._apply_pipeline_progress = AsyncMock(return_value=("progress-new", True))

        with patch(
            "app.services.training_program_service.TrainingProgramService"
        ) as tps_cls:
            sweep = AsyncMock(return_value=1)
            tps_cls.return_value.reverse_credits_for_source_except = sweep
            await svc._apply_pipeline_updates(
                [("user-1", "prog-1", "req-new", 4.0, "session-1")],
                "org-1",
                "chief-1",
                session_id="session-1",
            )

        sweep.assert_awaited_once()
        # Only the destination just credited is kept; the old one is reversed.
        assert sweep.await_args.kwargs["keep_progress_ids"] == {"progress-new"}
        assert sweep.await_args.kwargs["source_id"] == "session-1"

    async def test_an_all_zero_correction_still_sweeps(self):
        """The queue is gated on positive hours, so correcting everyone to zero
        queues nothing — and that is precisely when the old credit survives."""
        db = _db()
        svc = TrainingSessionService(db)

        with patch(
            "app.services.training_program_service.TrainingProgramService"
        ) as tps_cls:
            sweep = AsyncMock(return_value=1)
            tps_cls.return_value.reverse_credits_for_source_except = sweep
            await svc._apply_pipeline_updates(
                [], "org-1", "chief-1", session_id="session-1"
            )

        sweep.assert_awaited_once()
        assert sweep.await_args.kwargs["keep_progress_ids"] == set()

    async def test_nothing_happens_without_a_session_to_reconcile(self):
        db = _db()
        svc = TrainingSessionService(db)

        with patch(
            "app.services.training_program_service.TrainingProgramService"
        ) as tps_cls:
            sweep = AsyncMock()
            tps_cls.return_value.reverse_credits_for_source_except = sweep
            await svc._apply_pipeline_updates([], "org-1", "chief-1")

        sweep.assert_not_awaited()


class TestAFailedUpdateIsNotReadAsARevocation:
    """PR #1802 review, P1: the sweep reverses everything outside the set of
    destinations just credited, so an update that *failed* looked identical to
    one the session no longer feeds. An events.manage caller without
    training.manage hits that on every attendee they do not own, turning one
    refused correction into a wholesale revocation of credit already earned."""

    async def test_an_unresolved_update_aborts_the_sweep(self):
        db = _db()
        svc = TrainingSessionService(db)
        # (None, False) — the updater refused; the destination may still be fed.
        svc._apply_pipeline_progress = AsyncMock(return_value=(None, False))

        with patch(
            "app.services.training_program_service.TrainingProgramService"
        ) as tps_cls:
            sweep = AsyncMock(return_value=1)
            tps_cls.return_value.reverse_credits_for_source_except = sweep
            await svc._apply_pipeline_updates(
                [("user-1", "prog-1", "req-1", 4.0, "session-1")],
                "org-1",
                "chief-1",
                session_id="session-1",
            )

        sweep.assert_not_awaited()

    async def test_one_failure_protects_the_whole_session(self):
        """Partial knowledge is not partial safety: the keep set is incomplete
        for every destination once any one of them is unresolved."""
        db = _db()
        svc = TrainingSessionService(db)
        svc._apply_pipeline_progress = AsyncMock(
            side_effect=[("progress-ok", True), (None, False)]
        )

        with patch(
            "app.services.training_program_service.TrainingProgramService"
        ) as tps_cls:
            sweep = AsyncMock(return_value=1)
            tps_cls.return_value.reverse_credits_for_source_except = sweep
            await svc._apply_pipeline_updates(
                [
                    ("user-1", "prog-1", "req-1", 4.0, "session-1"),
                    ("user-2", "prog-1", "req-1", 4.0, "session-1"),
                ],
                "org-1",
                "chief-1",
                session_id="session-1",
            )

        sweep.assert_not_awaited()

    async def test_a_member_outside_the_pipeline_still_sweeps(self):
        """(None, True) is resolved, not failed — no enrollment means no
        destination to keep, which the sweep can act on safely. Conflating it
        with a failure would disable reconciliation for the whole session."""
        db = _db()
        svc = TrainingSessionService(db)
        svc._apply_pipeline_progress = AsyncMock(return_value=(None, True))

        with patch(
            "app.services.training_program_service.TrainingProgramService"
        ) as tps_cls:
            sweep = AsyncMock(return_value=1)
            tps_cls.return_value.reverse_credits_for_source_except = sweep
            await svc._apply_pipeline_updates(
                [("user-1", "prog-1", "req-1", 4.0, "session-1")],
                "org-1",
                "chief-1",
                session_id="session-1",
            )

        sweep.assert_awaited_once()
        assert sweep.await_args.kwargs["keep_progress_ids"] == set()


class TestReEnrollmentDoesNotStrandCredit:
    """PR #1802 review, P1: widening the enrollment lookup to COMPLETED made it
    ambiguous, because enroll_member rejects only an *active* enrollment. A
    member who finished a program and enrolled again holds both rows, and
    scalar_one_or_none() over the pair raises MultipleResultsFound — swallowed
    into 'unresolved', so the re-enrolled member silently stops being credited."""

    async def test_two_enrollments_do_not_raise(self):
        completed = SimpleNamespace(id="enr-old", status=EnrollmentStatus.COMPLETED)
        active = SimpleNamespace(id="enr-new", status=EnrollmentStatus.ACTIVE)
        # No prior credit for this session -> the active enrollment is chosen.
        db = _db(_all([completed, active]), MagicMock(all=MagicMock(return_value=[])))
        svc = TrainingSessionService(db)

        enrollment = await svc._resolve_pipeline_enrollment(
            user_id="user-1",
            program_id="prog-1",
            session_id="session-1",
            organization_id="org-1",
        )

        assert enrollment is active

    async def test_the_enrollment_already_credited_wins(self):
        """A re-finalize restates its own earlier figure, and that figure lives
        on the enrollment it was first applied to. Moving it to the newer
        enrollment would rewrite a completed program's history."""
        completed = SimpleNamespace(id="enr-old", status=EnrollmentStatus.COMPLETED)
        active = SimpleNamespace(id="enr-new", status=EnrollmentStatus.ACTIVE)
        db = _db(
            _all([completed, active]),
            MagicMock(all=MagicMock(return_value=[("enr-old",)])),
        )
        svc = TrainingSessionService(db)

        enrollment = await svc._resolve_pipeline_enrollment(
            user_id="user-1",
            program_id="prog-1",
            session_id="session-1",
            organization_id="org-1",
        )

        assert enrollment is completed

    async def test_a_single_enrollment_needs_no_credit_lookup(self):
        only = SimpleNamespace(id="enr-1", status=EnrollmentStatus.COMPLETED)
        db = _db(_all([only]))
        svc = TrainingSessionService(db)

        enrollment = await svc._resolve_pipeline_enrollment(
            user_id="user-1",
            program_id="prog-1",
            session_id="session-1",
            organization_id="org-1",
        )

        assert enrollment is only
        assert db.execute.await_count == 1


class TestAPendingConfirmationDoesNotSweep:
    """PR #1802 review, P1: passing the session id is what arms the sweep, and
    a confirmation-required finalize leaves ``pipeline_updates`` empty on
    purpose — the records are not approved yet. Sweeping against that empty set
    reverses every credit the *previous* approval earned, the moment a leader
    reopens the session and before anyone confirms what replaces it. If the
    officer never submits, the hours are simply gone.

    Held by ``record_event_attendance``, which every finalize now goes through.
    """

    async def _record(self, requires_confirmation: bool, prior=frozenset()):
        past = datetime.now(timezone.utc) - timedelta(hours=2)
        # AttendeeApprovalData parses user_id as a UUID.
        member_id = str(uuid4())
        rsvp = SimpleNamespace(
            user_id=member_id,
            checked_in=True,
            checked_in_at=past,
            checked_out_at=past + timedelta(hours=1),
            override_check_in_at=None,
            override_check_out_at=None,
            override_duration_minutes=None,
            attendance_duration_minutes=60,
            early_check_in_minutes=None,
        )
        event = SimpleNamespace(
            id="event-1",
            title="Pump Ops Drill",
            location=None,
            start_datetime=past,
            end_datetime=past + timedelta(hours=1),
            actual_end_time=None,
            check_in_window_type=None,
        )
        session = SimpleNamespace(
            id="session-1",
            organization_id="org-1",
            event_id="event-1",
            program_id="prog-1",
            course_name="Pump Ops",
            is_finalized=False,
            approval_deadline_days=14,
            require_completion_confirmation=requires_confirmation,
        )
        user = SimpleNamespace(
            id=member_id, first_name="Dana", last_name="Reyes", email="d@example.org"
        )
        db = _db(_all([user]))
        db.add = MagicMock()
        db.flush = AsyncMock()
        svc = TrainingSessionService(db)
        svc._prior_credit_user_ids = AsyncMock(return_value=set(prior))
        svc._hold_pending_records = AsyncMock()
        svc._finalize_training_records = AsyncMock(return_value=[])
        svc.void_event_records = AsyncMock()

        credit = await svc.record_event_attendance(
            event, session, [], [rsvp], past + timedelta(hours=1), "chief-1", "org-1"
        )
        return credit, member_id

    async def test_confirmation_required_withholds_the_session_id(self):
        credit, _ = await self._record(requires_confirmation=True)
        assert credit.sweep_session_id is None
        assert credit.approval_pending is True

    async def test_auto_approved_still_sweeps(self):
        """The deferral must not disarm reconciliation for sessions that do
        approve their records here — that is the corrected-to-zero case."""
        credit, _ = await self._record(requires_confirmation=False)
        assert credit.sweep_session_id == "session-1"

    async def test_a_member_dropped_from_the_roster_is_handed_back(self):
        """PR #1791 review, P1: re-finalizing wrote records for the current
        roster and said nothing about anyone dropped from it. The dropped
        member is named for the post-commit pipeline revocation, and every
        record this event wrote for anyone not credited now is voided."""
        credit, member_id = await self._record(
            requires_confirmation=False, prior={"removed-1"}
        )
        assert credit.removed_user_ids == {"removed-1"}


class TestTheOldFinalizeRouteFinalizesTheEvent:
    """The legacy route wrote credit on its own — no event lock, on an event
    whose attendance stayed open — and now runs the event's finalize."""

    async def test_it_finalizes_the_event_and_returns_that_approval(self):
        session = SimpleNamespace(id="session-1", event_id="event-1")
        approval = SimpleNamespace(id="approval-9", approval_deadline=None)
        db = _db(_one(session), _one(approval))
        outcome = SimpleNamespace(error=None, training_approval_id="approval-9")

        with patch(
            "app.services.training_session_service.EventService"
            ".finalize_event_attendance_detailed",
            AsyncMock(return_value=outcome),
        ) as finalize:
            result, error = await TrainingSessionService(db).finalize_training_session(
                "session-1", "org-1", "chief-1", can_manage_training=True
            )

        assert (result, error) == (approval, None)
        finalize.assert_awaited_once_with(
            "event-1",
            "org-1",
            finalized_by="chief-1",
            can_manage_training=True,
            require_training=True,
        )

    async def test_the_event_s_refusal_is_the_route_s(self):
        db = _db(_one(SimpleNamespace(id="session-1", event_id="event-1")))
        outcome = SimpleNamespace(
            error="Cannot finalize attendance for a cancelled event",
            training_approval_id=None,
        )

        with patch(
            "app.services.training_session_service.EventService"
            ".finalize_event_attendance_detailed",
            AsyncMock(return_value=outcome),
        ):
            result, error = await TrainingSessionService(db).finalize_training_session(
                "session-1", "org-1", "chief-1"
            )

        assert result is None
        assert error == "Cannot finalize attendance for a cancelled event"

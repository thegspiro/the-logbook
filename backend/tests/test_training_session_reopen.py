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

from app.models.training import ApprovalStatus
from app.services.training_session_service import TrainingSessionService


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


class TestReopenTrainingSession:
    async def test_reopen_clears_the_finalized_state(self):
        session = _session()
        db = _db(_one(session), _all([]))

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
        approval = _approval()
        before = approval.token_expires_at
        db = _db(_one(_session()), _all([approval]))

        await TrainingSessionService(db).reopen_training_session("session-1", "org-1")

        assert approval.token_expires_at < before
        assert approval.token_expires_at <= datetime.now(timezone.utc)
        # Not marked rejected: no officer rejected anything.
        assert approval.status == ApprovalStatus.PENDING

    async def test_only_pending_approvals_are_queried(self):
        """An approved one keeps its record — re-finalizing updates the
        training records in place rather than duplicating them."""
        db = _db(_one(_session()), _all([]))

        await TrainingSessionService(db).reopen_training_session("session-1", "org-1")

        approval_stmt = db.execute.await_args_list[1].args[0]
        compiled = str(
            approval_stmt.compile(compile_kwargs={"literal_binds": True})
        ).lower()
        assert "status" in compiled
        assert "pending" in compiled

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


class TestRemovedAttendeeLosesCredit:
    """PR #1791 review, P1: re-finalization wrote records for the current
    roster and said nothing about anyone dropped from it, so a member removed
    during a reopen kept the completed record and the pipeline credit."""

    def _session_with_program(self):
        session = _session()
        session.program_id = "prog-1"
        session.course_name = "Pump Ops"
        session.course_id = None
        session.category_id = None
        return session

    async def test_prior_roster_minus_current_is_reconciled(self):
        session = self._session_with_program()
        prior = SimpleNamespace(
            attendee_data=[{"user_id": "kept-1"}, {"user_id": "removed-1"}],
        )
        record = SimpleNamespace(
            hours_completed=4.0,
            completion_date="2026-08-24",
            status="completed",
            updated_at=None,
        )
        enrollment = SimpleNamespace(id="enr-1")
        progress = SimpleNamespace(id="prog-row-1")
        db = _db(
            _one(prior),  # newest prior approval
            _one(enrollment),  # removed member's enrollment
            _all([progress]),  # their requirement rows
            _one(record),  # their training record
        )
        # The record lookup uses .scalars().first()
        db.execute.side_effect = [
            _one(prior),
            _one(enrollment),
            _all([progress]),
            MagicMock(scalars=MagicMock(return_value=MagicMock(first=lambda: record))),
        ]
        svc = TrainingSessionService(db)

        with patch(
            "app.services.training_program_service.TrainingProgramService"
        ) as tps_cls:
            revoke = AsyncMock(return_value=(None, None))
            tps_cls.return_value.revoke_requirement_credit = revoke
            await svc._revoke_credit_for_removed_attendees(
                training_session=session,
                event=SimpleNamespace(start_datetime=datetime(2026, 8, 24)),
                current_user_ids={"kept-1"},
                organization_id="org-1",
                verified_by="chief-1",
            )

        revoke.assert_awaited_once()
        assert revoke.await_args.kwargs["source_id"] == "session-1"
        # The record is un-completed rather than deleted: nothing on
        # TrainingRecord says which session created it.
        assert record.hours_completed == 0
        assert record.completion_date is None
        assert record.status == "scheduled"

    async def test_a_first_finalize_has_nothing_to_reconcile(self):
        db = _db(_one(None))
        svc = TrainingSessionService(db)

        await svc._revoke_credit_for_removed_attendees(
            training_session=self._session_with_program(),
            event=SimpleNamespace(start_datetime=datetime(2026, 8, 24)),
            current_user_ids={"kept-1"},
            organization_id="org-1",
            verified_by="chief-1",
        )

        db.commit.assert_not_awaited()

    async def test_an_unchanged_roster_is_left_alone(self):
        prior = SimpleNamespace(attendee_data=[{"user_id": "kept-1"}])
        db = _db(_one(prior))
        svc = TrainingSessionService(db)

        await svc._revoke_credit_for_removed_attendees(
            training_session=self._session_with_program(),
            event=SimpleNamespace(start_datetime=datetime(2026, 8, 24)),
            current_user_ids={"kept-1"},
            organization_id="org-1",
            verified_by="chief-1",
        )

        db.commit.assert_not_awaited()


class TestReopenSerializesAgainstApproval:
    async def test_reopen_locks_the_session_row(self):
        db = _db(_one(_session()), _all([]))
        await TrainingSessionService(db).reopen_training_session("session-1", "org-1")

        stmt = str(
            db.execute.await_args_list[0]
            .args[0]
            .compile(compile_kwargs={"literal_binds": True})
        ).lower()
        assert "for update" in stmt

    async def test_reopen_locks_the_pending_approvals(self):
        db = _db(_one(_session()), _all([]))
        await TrainingSessionService(db).reopen_training_session("session-1", "org-1")

        stmt = str(
            db.execute.await_args_list[1]
            .args[0]
            .compile(compile_kwargs={"literal_binds": True})
        ).lower()
        assert "for update" in stmt


class TestCompletedEnrollmentsAreNotSkipped:
    """PR #1798 review, P1: an ACTIVE-only enrollment lookup skips exactly the
    member whose credit carried them over 100% — completing the program moves
    the enrollment to COMPLETED, so neither the correction nor the revocation
    found anything to act on."""

    def _statuses_in(self, statement) -> str:
        return str(statement.compile(compile_kwargs={"literal_binds": True})).lower()

    async def test_revocation_looks_past_active(self):
        session = _session()
        session.program_id = "prog-1"
        session.course_name = "Pump Ops"
        db = _db(_one(None))
        svc = TrainingSessionService(db)

        await svc._revoke_pipeline_credit_for_user(
            program_service=MagicMock(),
            user_id="user-1",
            training_session=session,
            organization_id="org-1",
            verified_by="chief-1",
            source_type=None,
        )

        sql = self._statuses_in(db.execute.await_args.args[0])
        assert "completed" in sql
        assert "active" in sql

    async def test_correction_looks_past_active(self):
        db = _db(_one(None))
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
        svc._apply_pipeline_progress = AsyncMock(return_value="progress-new")

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

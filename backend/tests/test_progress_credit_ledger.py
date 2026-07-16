"""
Idempotency ledger for pipeline progress credit (Batch 3).

apply_requirement_credit records one ledger row per (progress, source) and
accrues the units exactly once; a second application of the same source is a
no-op, so a single real training can never be double-credited across the feeds.
revoke_requirement_credit reverses one credit. DB + the shared updater mocked.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from sqlalchemy.exc import IntegrityError

from app.models.training import ProgressCreditSource, RequirementProgressCredit
from app.services.training_program_service import TrainingProgramService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


class RecordingSession:
    def __init__(self, results=None, flush_error=None):
        self._results = list(results or [])
        self.added = []
        self.deleted = []
        self._flush_error = flush_error
        self.commit = AsyncMock()
        self.refresh = AsyncMock()
        self.rollback = AsyncMock()

    async def execute(self, statement, *args, **kwargs):
        return self._results.pop(0) if self._results else MagicMock()

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        if self._flush_error is not None:
            raise self._flush_error

    async def delete(self, obj):
        self.deleted.append(obj)


def _progress(value=0.0):
    return SimpleNamespace(id=str(uuid4()), progress_value=value)


def _svc(db):
    svc = TrainingProgramService(db)
    # The real updater is exercised elsewhere; here we only care that the ledger
    # method routes the right accrual through it.
    svc.update_requirement_progress = AsyncMock(return_value=(MagicMock(), None))
    return svc


class TestApplyCredit:
    async def test_first_apply_records_ledger_and_accrues_units(self):
        progress = _progress(value=10.0)
        db = RecordingSession([_one(progress), _one(None)])
        svc = _svc(db)

        await svc.apply_requirement_credit(
            progress_id=progress.id,
            organization_id=uuid4(),
            source_type=ProgressCreditSource.TRAINING_SESSION,
            source_id="sess-1",
            units=5.0,
        )

        assert len(db.added) == 1
        ledger = db.added[0]
        assert isinstance(ledger, RequirementProgressCredit)
        assert ledger.source_id == "sess-1"
        assert ledger.units == 5.0
        svc.update_requirement_progress.assert_awaited_once()
        updates = svc.update_requirement_progress.await_args.kwargs["updates"]
        assert updates.progress_value == 15.0  # 10 existing + 5 accrued

    async def test_duplicate_source_is_noop(self):
        progress = _progress(value=10.0)
        existing = RequirementProgressCredit(
            progress_id=progress.id,
            source_type=ProgressCreditSource.TRAINING_SESSION,
            source_id="sess-1",
            units=5.0,
        )
        db = RecordingSession([_one(progress), _one(existing)])
        svc = _svc(db)

        result, error = await svc.apply_requirement_credit(
            progress_id=progress.id,
            organization_id=uuid4(),
            source_type=ProgressCreditSource.TRAINING_SESSION,
            source_id="sess-1",
            units=5.0,
        )

        assert error is None
        assert db.added == []  # no second ledger row
        svc.update_requirement_progress.assert_not_awaited()  # no double credit

    async def test_zero_units_is_noop(self):
        db = RecordingSession()
        svc = _svc(db)
        result, error = await svc.apply_requirement_credit(
            progress_id=uuid4(),
            organization_id=uuid4(),
            source_type=ProgressCreditSource.SHIFT_REPORT,
            source_id="r-1",
            units=0.0,
        )
        assert result is None and error is None
        svc.update_requirement_progress.assert_not_awaited()

    async def test_missing_progress_returns_error(self):
        db = RecordingSession([_one(None)])
        svc = _svc(db)
        result, error = await svc.apply_requirement_credit(
            progress_id=uuid4(),
            organization_id=uuid4(),
            source_type=ProgressCreditSource.SHIFT_REPORT,
            source_id="r-1",
            units=2.0,
        )
        assert result is None and "not found" in error
        svc.update_requirement_progress.assert_not_awaited()

    async def test_notes_and_in_progress_pass_through(self):
        progress = _progress(value=0.0)
        db = RecordingSession([_one(progress), _one(None)])
        svc = _svc(db)

        await svc.apply_requirement_credit(
            progress_id=progress.id,
            organization_id=uuid4(),
            source_type=ProgressCreditSource.SHIFT_REPORT,
            source_id="r-1",
            units=1.0,
            progress_notes={"call_type_totals": {"ems": 1}},
            mark_in_progress=True,
        )

        updates = svc.update_requirement_progress.await_args.kwargs["updates"]
        assert updates.status == "in_progress"
        assert updates.progress_notes == {"call_type_totals": {"ems": 1}}

    async def test_race_on_unique_constraint_is_noop(self):
        progress = _progress(value=10.0)
        db = RecordingSession(
            [_one(progress), _one(None)],
            flush_error=IntegrityError("insert", {}, Exception("dup")),
        )
        svc = _svc(db)

        result, error = await svc.apply_requirement_credit(
            progress_id=progress.id,
            organization_id=uuid4(),
            source_type=ProgressCreditSource.TRAINING_SESSION,
            source_id="sess-1",
            units=5.0,
        )

        assert error is None
        db.rollback.assert_awaited_once()
        svc.update_requirement_progress.assert_not_awaited()


class TestRevokeCredit:
    async def test_revoke_deletes_and_subtracts(self):
        progress = _progress(value=15.0)
        credit = RequirementProgressCredit(
            progress_id=progress.id,
            source_type=ProgressCreditSource.TRAINING_SESSION,
            source_id="sess-1",
            units=5.0,
        )
        db = RecordingSession([_one(progress), _one(credit)])
        svc = _svc(db)

        await svc.revoke_requirement_credit(
            progress_id=progress.id,
            organization_id=uuid4(),
            source_type=ProgressCreditSource.TRAINING_SESSION,
            source_id="sess-1",
        )

        assert db.deleted == [credit]
        updates = svc.update_requirement_progress.await_args.kwargs["updates"]
        assert updates.progress_value == 10.0  # 15 - 5

    async def test_revoke_floors_at_zero(self):
        progress = _progress(value=3.0)
        credit = RequirementProgressCredit(
            progress_id=progress.id,
            source_type=ProgressCreditSource.TRAINING_SESSION,
            source_id="sess-1",
            units=5.0,
        )
        db = RecordingSession([_one(progress), _one(credit)])
        svc = _svc(db)

        await svc.revoke_requirement_credit(
            progress_id=progress.id,
            organization_id=uuid4(),
            source_type=ProgressCreditSource.TRAINING_SESSION,
            source_id="sess-1",
        )

        updates = svc.update_requirement_progress.await_args.kwargs["updates"]
        assert updates.progress_value == 0.0

    async def test_revoke_missing_credit_is_noop(self):
        progress = _progress(value=10.0)
        db = RecordingSession([_one(progress), _one(None)])
        svc = _svc(db)

        result, error = await svc.revoke_requirement_credit(
            progress_id=progress.id,
            organization_id=uuid4(),
            source_type=ProgressCreditSource.TRAINING_SESSION,
            source_id="sess-1",
        )

        assert error is None
        assert db.deleted == []
        svc.update_requirement_progress.assert_not_awaited()

"""
Tests for the training-session -> pipeline progress feed
(app/services/training_session_service.py).

Approving a program-linked training session must advance the member's linked
pipeline requirement through the REAL updater, keyed on the session in the
idempotency ledger (TrainingProgramService.apply_requirement_credit) so
percentage, auto-completion, enrollment rollup, and phase advancement all run —
and re-approving the same session cannot double-credit the member's hours.

DB is mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.models.training import ProgressCreditSource
from app.services.training_program_service import TrainingProgramService
from app.services.training_session_service import TrainingSessionService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


class RecordingSession:
    def __init__(self, results=None):
        self._results = list(results or [])
        self.commit = AsyncMock()
        self.refresh = AsyncMock()
        self.rollback = AsyncMock()

    def add(self, obj):
        pass

    async def execute(self, *args, **kwargs):
        return self._results.pop(0) if self._results else MagicMock()


class TestResolveCategoryRequirementIds:
    async def test_returns_requirement_ids_in_category(self):
        db = RecordingSession(
            [MagicMock(all=MagicMock(return_value=[("r1",), ("r2",)]))]
        )
        svc = TrainingSessionService(db)
        ids = await svc._resolve_category_requirement_ids("prog-1", "cat-1")
        assert ids == ["r1", "r2"]

    async def test_empty_when_no_matches(self):
        db = RecordingSession([MagicMock(all=MagicMock(return_value=[]))])
        svc = TrainingSessionService(db)
        assert await svc._resolve_category_requirement_ids("prog-1", "cat-1") == []


class TestApplyPipelineProgress:
    async def test_routes_through_credit_ledger(self, monkeypatch):
        enrollment = SimpleNamespace(id="enr-1")
        progress = SimpleNamespace(id="rp-1", progress_value=5.0)
        db = RecordingSession([_one(enrollment), _one(progress)])
        svc = TrainingSessionService(db)

        mock_credit = AsyncMock(return_value=(SimpleNamespace(), None))
        monkeypatch.setattr(
            TrainingProgramService, "apply_requirement_credit", mock_credit
        )

        org, officer = uuid4(), uuid4()
        await svc._apply_pipeline_progress(
            user_id="u1",
            program_id="p1",
            requirement_id="r1",
            hours_completed=10.0,
            organization_id=org,
            verified_by=officer,
            session_id="sess-9",
        )

        mock_credit.assert_awaited_once()
        kwargs = mock_credit.await_args.kwargs
        assert kwargs["progress_id"] == "rp-1"
        assert kwargs["organization_id"] == org
        assert kwargs["verified_by"] == officer
        # Keyed on the session so a re-approval can't double-credit; hours are the
        # units, and the ledger routes them through the real updater.
        assert kwargs["source_type"] == ProgressCreditSource.TRAINING_SESSION
        assert kwargs["source_id"] == "sess-9"
        assert kwargs["units"] == 10.0

    async def test_noop_without_active_enrollment(self, monkeypatch):
        db = RecordingSession([_one(None)])
        svc = TrainingSessionService(db)
        mock_credit = AsyncMock()
        monkeypatch.setattr(
            TrainingProgramService, "apply_requirement_credit", mock_credit
        )

        await svc._apply_pipeline_progress(
            "u1", "p1", "r1", 10.0, uuid4(), uuid4(), "sess-9"
        )
        mock_credit.assert_not_awaited()

    async def test_noop_without_progress_row(self, monkeypatch):
        enrollment = SimpleNamespace(id="enr-1")
        db = RecordingSession([_one(enrollment), _one(None)])
        svc = TrainingSessionService(db)
        mock_credit = AsyncMock()
        monkeypatch.setattr(
            TrainingProgramService, "apply_requirement_credit", mock_credit
        )

        await svc._apply_pipeline_progress(
            "u1", "p1", "r1", 10.0, uuid4(), uuid4(), "sess-9"
        )
        mock_credit.assert_not_awaited()

    async def test_updater_failure_is_swallowed(self, monkeypatch):
        enrollment = SimpleNamespace(id="enr-1")
        progress = SimpleNamespace(id="rp-1", progress_value=0.0)
        db = RecordingSession([_one(enrollment), _one(progress)])
        svc = TrainingSessionService(db)
        monkeypatch.setattr(
            TrainingProgramService,
            "apply_requirement_credit",
            AsyncMock(side_effect=RuntimeError("boom")),
        )

        # Must not raise — records are already committed; feed failures are logged.
        await svc._apply_pipeline_progress(
            "u1", "p1", "r1", 10.0, uuid4(), uuid4(), "sess-9"
        )


class TestApplyPipelineUpdates:
    async def test_iterates_every_update(self):
        svc = TrainingSessionService(RecordingSession())
        svc._apply_pipeline_progress = AsyncMock()

        org, officer = uuid4(), uuid4()
        updates = [
            ("u1", "p1", "r1", 4.0, "sess-1"),
            ("u2", "p1", "r2", 8.0, "sess-1"),
        ]
        await svc._apply_pipeline_updates(updates, org, officer)

        assert svc._apply_pipeline_progress.await_count == 2
        first = svc._apply_pipeline_progress.await_args_list[0].kwargs
        assert first["user_id"] == "u1"
        assert first["hours_completed"] == 4.0
        assert first["organization_id"] == org
        assert first["verified_by"] == officer
        assert first["session_id"] == "sess-1"


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))

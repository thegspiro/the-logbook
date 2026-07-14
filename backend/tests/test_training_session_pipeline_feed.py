"""
Tests for the training-session -> pipeline progress feed
(app/services/training_session_service.py).

Approving a program-linked training session must advance the member's linked
pipeline requirement through the REAL updater
(TrainingProgramService.update_requirement_progress) so percentage,
auto-completion, enrollment rollup, and phase advancement all run — not the old
hand-mutation that left the pipeline stuck at 0%.

DB is mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

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


class TestApplyPipelineProgress:
    async def test_routes_through_update_requirement_progress(self, monkeypatch):
        enrollment = SimpleNamespace(id="enr-1")
        progress = SimpleNamespace(id="rp-1", progress_value=5.0)
        db = RecordingSession([_one(enrollment), _one(progress)])
        svc = TrainingSessionService(db)

        mock_update = AsyncMock(return_value=(SimpleNamespace(), None))
        monkeypatch.setattr(
            TrainingProgramService, "update_requirement_progress", mock_update
        )

        org, officer = uuid4(), uuid4()
        await svc._apply_pipeline_progress(
            user_id="u1",
            program_id="p1",
            requirement_id="r1",
            hours_completed=10.0,
            organization_id=org,
            verified_by=officer,
        )

        mock_update.assert_awaited_once()
        kwargs = mock_update.await_args.kwargs
        assert kwargs["progress_id"] == "rp-1"
        assert kwargs["organization_id"] == org
        assert kwargs["verified_by"] == officer
        # Hours accrue onto the existing value; the updater derives the percentage.
        assert kwargs["updates"].progress_value == 15.0

    async def test_noop_without_active_enrollment(self, monkeypatch):
        db = RecordingSession([_one(None)])
        svc = TrainingSessionService(db)
        mock_update = AsyncMock()
        monkeypatch.setattr(
            TrainingProgramService, "update_requirement_progress", mock_update
        )

        await svc._apply_pipeline_progress(
            "u1", "p1", "r1", 10.0, uuid4(), uuid4()
        )
        mock_update.assert_not_awaited()

    async def test_noop_without_progress_row(self, monkeypatch):
        enrollment = SimpleNamespace(id="enr-1")
        db = RecordingSession([_one(enrollment), _one(None)])
        svc = TrainingSessionService(db)
        mock_update = AsyncMock()
        monkeypatch.setattr(
            TrainingProgramService, "update_requirement_progress", mock_update
        )

        await svc._apply_pipeline_progress(
            "u1", "p1", "r1", 10.0, uuid4(), uuid4()
        )
        mock_update.assert_not_awaited()

    async def test_updater_failure_is_swallowed(self, monkeypatch):
        enrollment = SimpleNamespace(id="enr-1")
        progress = SimpleNamespace(id="rp-1", progress_value=0.0)
        db = RecordingSession([_one(enrollment), _one(progress)])
        svc = TrainingSessionService(db)
        monkeypatch.setattr(
            TrainingProgramService,
            "update_requirement_progress",
            AsyncMock(side_effect=RuntimeError("boom")),
        )

        # Must not raise — records are already committed; feed failures are logged.
        await svc._apply_pipeline_progress(
            "u1", "p1", "r1", 10.0, uuid4(), uuid4()
        )


class TestApplyPipelineUpdates:
    async def test_iterates_every_update(self):
        svc = TrainingSessionService(RecordingSession())
        svc._apply_pipeline_progress = AsyncMock()

        org, officer = uuid4(), uuid4()
        updates = [
            ("u1", "p1", "r1", 4.0),
            ("u2", "p1", "r2", 8.0),
        ]
        await svc._apply_pipeline_updates(updates, org, officer)

        assert svc._apply_pipeline_progress.await_count == 2
        first = svc._apply_pipeline_progress.await_args_list[0].kwargs
        assert first["user_id"] == "u1"
        assert first["hours_completed"] == 4.0
        assert first["organization_id"] == org
        assert first["verified_by"] == officer


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))

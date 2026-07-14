"""
Tests for the skills-test -> pipeline progress feed
(app/api/v1/endpoints/skills_testing.py :: _apply_test_pass_to_pipeline).

A passing, program-linked skills test marks its linked requirement complete on
each of the candidate's active enrollments, routing through the real updater
(TrainingProgramService.update_requirement_progress) so percentage,
auto-completion, enrollment rollup, and phase advancement all run.

DB is mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.services.skills_testing_service import apply_test_pass_to_pipeline
from app.services.training_program_service import TrainingProgramService


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


class RecordingSession:
    def __init__(self, results=None):
        self._results = list(results or [])

    async def execute(self, *args, **kwargs):
        return self._results.pop(0) if self._results else MagicMock()


class TestApplyTestPassToPipeline:
    async def test_marks_requirement_complete_on_each_enrollment(self, monkeypatch):
        progress_a = SimpleNamespace(id="rp-a")
        progress_b = SimpleNamespace(id="rp-b")
        db = RecordingSession([_scalars([progress_a, progress_b])])

        mock_update = AsyncMock(return_value=(SimpleNamespace(), None))
        monkeypatch.setattr(
            TrainingProgramService, "update_requirement_progress", mock_update
        )

        org, examiner = uuid4(), uuid4()
        await apply_test_pass_to_pipeline(
            db=db,
            candidate_id="cand-1",
            requirement_id="req-1",
            organization_id=org,
            verified_by=examiner,
        )

        assert mock_update.await_count == 2
        seen_ids = {c.kwargs["progress_id"] for c in mock_update.await_args_list}
        assert seen_ids == {"rp-a", "rp-b"}
        for call in mock_update.await_args_list:
            assert call.kwargs["updates"].status == "completed"
            assert call.kwargs["organization_id"] == org
            assert call.kwargs["verified_by"] == examiner

    async def test_noop_when_no_matching_progress(self, monkeypatch):
        db = RecordingSession([_scalars([])])
        mock_update = AsyncMock()
        monkeypatch.setattr(
            TrainingProgramService, "update_requirement_progress", mock_update
        )

        await apply_test_pass_to_pipeline(
            db=db,
            candidate_id="cand-1",
            requirement_id="req-1",
            organization_id=uuid4(),
            verified_by=uuid4(),
        )
        mock_update.assert_not_awaited()

    async def test_updater_failure_is_swallowed(self, monkeypatch):
        db = RecordingSession([_scalars([SimpleNamespace(id="rp-a")])])
        monkeypatch.setattr(
            TrainingProgramService,
            "update_requirement_progress",
            AsyncMock(side_effect=RuntimeError("boom")),
        )

        # Must not raise — the test result is already saved.
        await apply_test_pass_to_pipeline(
            db=db,
            candidate_id="cand-1",
            requirement_id="req-1",
            organization_id=uuid4(),
            verified_by=uuid4(),
        )


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))

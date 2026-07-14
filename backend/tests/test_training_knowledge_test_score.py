"""
Tests for officer-entered knowledge/skills test scores on requirement progress
(TrainingProgramService.update_requirement_progress with ``test_score``).

A score at/above the requirement's passing_score completes the requirement; a
lower score is recorded as a failed attempt without completing it. The raw score
and attempt history are kept in progress_notes.

DB is mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.models.training import RequirementProgressStatus
from app.services.training_program_service import (
    RequirementProgressUpdate,
    TrainingProgramService,
)


def _progress(passing_score=70.0):
    return SimpleNamespace(
        id="p1",
        enrollment_id="enr-1",
        enrollment=SimpleNamespace(user_id="u1", program=SimpleNamespace()),
        requirement=SimpleNamespace(passing_score=passing_score),
        status=RequirementProgressStatus.NOT_STARTED,
        progress_value=0.0,
        progress_percentage=0.0,
        progress_notes=None,
        started_at=None,
        completed_at=None,
        verified_by=None,
        verified_at=None,
        updated_at=None,
    )


def _db_with(progress):
    db = MagicMock()
    db.execute = AsyncMock(
        return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=progress))
    )
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    return db


class TestKnowledgeTestScore:
    async def test_passing_score_completes_requirement(self, monkeypatch):
        progress = _progress(passing_score=70.0)
        svc = TrainingProgramService(_db_with(progress))
        monkeypatch.setattr(svc, "_recalculate_enrollment_progress", AsyncMock())
        monkeypatch.setattr(svc, "_maybe_auto_advance_phase", AsyncMock())

        officer = uuid4()
        out, err = await svc.update_requirement_progress(
            progress_id="p1",
            organization_id="org-1",
            updates=RequirementProgressUpdate(test_score=85),
            verified_by=officer,
        )

        assert err is None
        assert out.status == RequirementProgressStatus.COMPLETED
        assert out.progress_percentage == 100.0
        assert out.completed_at is not None
        assert out.progress_notes["latest_score"] == 85
        assert out.progress_notes["passed"] is True
        assert len(out.progress_notes["test_attempts"]) == 1

    async def test_failing_score_records_attempt_without_completing(self, monkeypatch):
        progress = _progress(passing_score=70.0)
        svc = TrainingProgramService(_db_with(progress))
        monkeypatch.setattr(svc, "_recalculate_enrollment_progress", AsyncMock())
        monkeypatch.setattr(svc, "_maybe_auto_advance_phase", AsyncMock())

        out, err = await svc.update_requirement_progress(
            progress_id="p1",
            organization_id="org-1",
            updates=RequirementProgressUpdate(test_score=50),
            verified_by=uuid4(),
        )

        assert err is None
        assert out.status == RequirementProgressStatus.IN_PROGRESS
        assert out.completed_at is None
        assert out.progress_notes["passed"] is False
        assert out.progress_notes["latest_score"] == 50

    async def test_default_threshold_when_requirement_has_no_passing_score(
        self, monkeypatch
    ):
        # No passing_score on the requirement -> default 70; 72 passes.
        progress = _progress(passing_score=None)
        svc = TrainingProgramService(_db_with(progress))
        monkeypatch.setattr(svc, "_recalculate_enrollment_progress", AsyncMock())
        monkeypatch.setattr(svc, "_maybe_auto_advance_phase", AsyncMock())

        out, err = await svc.update_requirement_progress(
            progress_id="p1",
            organization_id="org-1",
            updates=RequirementProgressUpdate(test_score=72),
            verified_by=uuid4(),
        )

        assert err is None
        assert out.progress_notes["passing_score"] == 70.0
        assert out.status == RequirementProgressStatus.COMPLETED


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))

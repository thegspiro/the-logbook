"""
Tests for COURSES-type requirement progress
(TrainingProgramService.update_requirement_progress).

A COURSES requirement's progress_value is the count of required courses
completed; the percentage is that count over the number required, and it
auto-completes at 100%.

DB is mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.training import RequirementProgressStatus, RequirementType
from app.services.training_program_service import (
    RequirementProgressUpdate,
    TrainingProgramService,
)


def _progress(required_courses):
    return SimpleNamespace(
        id="p1",
        enrollment_id="enr-1",
        enrollment=SimpleNamespace(
            user_id="u1",
            enrolled_at=None,
            target_completion_date=None,
            program=SimpleNamespace(organization_id="org-1"),
        ),
        requirement=SimpleNamespace(
            id="req-1",
            requirement_type=RequirementType.COURSES,
            required_courses=required_courses,
            required_hours=None,
            required_shifts=None,
            required_calls=None,
        ),
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


def _svc(progress, monkeypatch):
    svc = TrainingProgramService(_db_with(progress))
    monkeypatch.setattr(svc, "_recalculate_enrollment_progress", AsyncMock())
    monkeypatch.setattr(svc, "_maybe_auto_advance_phase", AsyncMock())
    monkeypatch.setattr(
        "app.services.training_program_service.fetch_user_waivers",
        AsyncMock(return_value=[]),
    )
    return svc


class TestCoursesProgress:
    async def test_partial_courses_percentage(self, monkeypatch):
        progress = _progress(["c1", "c2", "c3", "c4"])
        svc = _svc(progress, monkeypatch)

        out, err = await svc.update_requirement_progress(
            progress_id="p1",
            organization_id="org-1",
            updates=RequirementProgressUpdate(progress_value=2),
        )

        assert err is None
        assert out.progress_percentage == 50.0
        assert out.status != RequirementProgressStatus.COMPLETED

    async def test_all_courses_completes(self, monkeypatch):
        progress = _progress(["c1", "c2", "c3", "c4"])
        svc = _svc(progress, monkeypatch)

        out, err = await svc.update_requirement_progress(
            progress_id="p1",
            organization_id="org-1",
            updates=RequirementProgressUpdate(progress_value=4),
        )

        assert err is None
        assert out.progress_percentage == 100.0
        assert out.status == RequirementProgressStatus.COMPLETED


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))

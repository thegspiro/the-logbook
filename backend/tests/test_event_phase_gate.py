"""
Tests for the soft training-pipeline phase gate on event RSVP / self check-in
(EventService._evaluate_session_phase_warning).

A program-linked training session whose phase is ahead of the member's current
enrollment phase returns a warning (which the endpoint turns into an overridable
409). Non-enrolled members and non-program sessions are never gated.

DB is mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.services.event_service import EventService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


class RecordingSession:
    def __init__(self, results):
        self._results = list(results)

    async def execute(self, *args, **kwargs):
        return self._results.pop(0) if self._results else MagicMock()


def _event():
    return SimpleNamespace(id="ev-1")


class TestSessionPhaseWarning:
    async def test_warns_when_session_ahead_of_current_phase(self):
        ts = SimpleNamespace(program_id="prog-1", phase_id="ph-2", event_id="ev-1")
        enrollment = SimpleNamespace(current_phase_id="ph-1")
        session_phase = SimpleNamespace(phase_number=2, name="Advanced")
        current_phase = SimpleNamespace(phase_number=1, name="Basics")
        db = RecordingSession(
            [_one(ts), _one(enrollment), _one(session_phase), _one(current_phase)]
        )

        warning = await EventService(db)._evaluate_session_phase_warning(
            _event(), uuid4()
        )
        assert warning is not None
        assert "Phase 2" in warning and "Basics" in warning

    async def test_no_warning_when_session_in_current_phase(self):
        ts = SimpleNamespace(program_id="prog-1", phase_id="ph-1", event_id="ev-1")
        enrollment = SimpleNamespace(current_phase_id="ph-1")
        session_phase = SimpleNamespace(phase_number=1, name="Basics")
        current_phase = SimpleNamespace(phase_number=1, name="Basics")
        db = RecordingSession(
            [_one(ts), _one(enrollment), _one(session_phase), _one(current_phase)]
        )

        assert (
            await EventService(db)._evaluate_session_phase_warning(_event(), uuid4())
            is None
        )

    async def test_no_warning_when_not_enrolled(self):
        ts = SimpleNamespace(program_id="prog-1", phase_id="ph-2", event_id="ev-1")
        db = RecordingSession([_one(ts), _one(None)])
        assert (
            await EventService(db)._evaluate_session_phase_warning(_event(), uuid4())
            is None
        )

    async def test_no_warning_for_non_program_session(self):
        ts = SimpleNamespace(program_id=None, phase_id=None, event_id="ev-1")
        db = RecordingSession([_one(ts)])
        assert (
            await EventService(db)._evaluate_session_phase_warning(_event(), uuid4())
            is None
        )

    async def test_no_warning_when_no_training_session(self):
        db = RecordingSession([_one(None)])
        assert (
            await EventService(db)._evaluate_session_phase_warning(_event(), uuid4())
            is None
        )


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))

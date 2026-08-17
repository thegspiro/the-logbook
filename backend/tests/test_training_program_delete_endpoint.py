"""Audit guarantees for the destructive training-program delete endpoint."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.api.v1.endpoints import training_programs


def _user():
    return SimpleNamespace(
        id="user-1",
        username="chief",
        organization_id="org-1",
    )


async def test_delete_training_program_records_audit_event(monkeypatch):
    program_id = uuid4()
    service = MagicMock()
    service.delete_training_program = AsyncMock(return_value=(True, None))
    monkeypatch.setattr(
        training_programs, "TrainingProgramService", lambda _db: service
    )
    audit = AsyncMock()
    monkeypatch.setattr(training_programs, "log_audit_event", audit)
    db = MagicMock()
    db.commit = AsyncMock()

    await training_programs.delete_training_program(program_id, db, _user())

    # The module logs every training-program mutation under one event_type
    # and discriminates with `action`; the delete is warning-severity rather
    # than info because it cascades to enrollments and member progress.
    # organization_id is not passed: create_log_entry resolves it from
    # user_id, so stamping it here would only duplicate that lookup.
    audit.assert_awaited_once_with(
        db=db,
        event_type="training_program_updated",
        event_category="training",
        severity="warning",
        event_data={"program_id": str(program_id), "action": "program_deleted"},
        user_id="user-1",
        username="chief",
    )
    db.commit.assert_awaited_once()


async def test_missing_training_program_is_not_audited(monkeypatch):
    service = MagicMock()
    service.delete_training_program = AsyncMock(
        return_value=(False, "Training program not found")
    )
    monkeypatch.setattr(
        training_programs, "TrainingProgramService", lambda _db: service
    )
    audit = AsyncMock()
    monkeypatch.setattr(training_programs, "log_audit_event", audit)
    db = MagicMock()
    db.commit = AsyncMock()

    with pytest.raises(training_programs.HTTPException) as exc:
        await training_programs.delete_training_program(uuid4(), db, _user())

    assert exc.value.status_code == 404
    audit.assert_not_awaited()
    db.commit.assert_not_awaited()

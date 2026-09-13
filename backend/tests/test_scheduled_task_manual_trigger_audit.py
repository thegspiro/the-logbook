"""Manually triggering a scheduled task must leave an audit trail.

`POST /scheduled/run-task` iterates **every** organization on the platform
and is gated to the wildcard "System Owner" permission (`system.run_tasks`)
for exactly that reason — but until this fix, calling it left no record
anywhere of who ran what task or when. `log_audit_event()` exists precisely
for audit-sensitive, privileged operations like this one (CLAUDE.md's
Backend Patterns section), and every other admin-triggered mutation in this
codebase logs one; this endpoint was the exception.

The commit placement matters as much as the call: `log_audit_event()` only
opens a nested SAVEPOINT, and `get_db`'s request-scoped session commits once
at the very end (`database.py`'s `get_session`) — or rolls back the whole
session, audit entry included, if the handler raises. A runner that fails
partway through must not erase the record that it was ever invoked, so the
fix commits the audit entry immediately, before the runner runs.
"""

import uuid

import pytest
from sqlalchemy import select
from starlette.requests import Request

import app.api.v1.endpoints.scheduled as scheduled_endpoint
from app.models.audit import AuditLog
from app.models.user import User

pytestmark = pytest.mark.integration


def _fake_request() -> Request:
    return Request({"type": "http", "client": ("127.0.0.1", 4711), "headers": []})


async def _manual_trigger_logs(db_session, task: str) -> list[AuditLog]:
    result = await db_session.execute(
        select(AuditLog)
        .where(AuditLog.event_type == "scheduled_task.manual_trigger")
        .order_by(AuditLog.id.desc())
    )
    return [
        row
        for row in result.scalars().all()
        if (row.event_data or {}).get("task") == task
    ]


class TestManualTriggerIsAudited:
    async def test_a_successful_run_is_logged_with_the_caller_and_task(
        self, db_session
    ):
        caller = User(id=str(uuid.uuid4()), username="chief.owner")
        task = "cert_expiration_alerts"

        await scheduled_endpoint.run_scheduled_task(
            request=_fake_request(),
            task=task,
            db=db_session,
            current_user=caller,
        )

        entries = await _manual_trigger_logs(db_session, task)
        assert len(entries) == 1
        assert entries[0].user_id == str(caller.id)
        assert entries[0].username == "chief.owner"
        assert entries[0].event_category == "administration"

    async def test_a_runner_that_raises_does_not_erase_the_audit_record(
        self, db_session, monkeypatch
    ):
        caller = User(id=str(uuid.uuid4()), username="chief.owner")
        task = "cert_expiration_alerts"

        async def _boom(db):
            raise RuntimeError("simulated runner failure")

        monkeypatch.setitem(scheduled_endpoint.TASK_RUNNERS, task, _boom)

        with pytest.raises(RuntimeError):
            await scheduled_endpoint.run_scheduled_task(
                request=_fake_request(),
                task=task,
                db=db_session,
                current_user=caller,
            )

        # Without the fix's `await db.commit()`, this entry only ever lived
        # in a nested SAVEPOINT that the request-scoped session would have
        # rolled back along with everything else once the handler's
        # exception propagated past `get_db` — silently discarding the one
        # record that the privileged action was ever attempted.
        entries = await _manual_trigger_logs(db_session, task)
        assert len(entries) == 1

    async def test_an_unknown_task_is_rejected_before_anything_is_logged(
        self, db_session
    ):
        caller = User(id=str(uuid.uuid4()), username="chief.owner")

        from fastapi import HTTPException

        with pytest.raises(HTTPException):
            await scheduled_endpoint.run_scheduled_task(
                request=_fake_request(),
                task="not-a-real-task",
                db=db_session,
                current_user=caller,
            )

        entries = await _manual_trigger_logs(db_session, "not-a-real-task")
        assert entries == []

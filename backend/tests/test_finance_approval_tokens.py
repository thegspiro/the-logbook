"""Security tests for single-use external finance approval tokens."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.dialects import mysql

from app.models.finance import ApprovalStepStatus
from app.services.finance_service import FinanceService


def _result(record):
    result = MagicMock()
    result.scalar_one_or_none.return_value = record
    return result


def _pending_record():
    record = MagicMock()
    record.status = ApprovalStepStatus.PENDING
    record.token_expires_at = None
    record.entity_type = MagicMock()
    record.entity_id = "entity-id"
    record.approval_token = "approval-token"
    return record


@pytest.mark.parametrize("action", ["approve_by_token", "deny_by_token"])
async def test_token_action_locks_and_consumes_token(action):
    record = _pending_record()
    db = MagicMock()
    db.execute = AsyncMock(return_value=_result(record))
    db.flush = AsyncMock()
    service = FinanceService(db)
    service._advance_notification_steps = AsyncMock()
    service._check_all_steps_complete = AsyncMock(return_value=False)
    service._finalize_denial = AsyncMock()

    await getattr(service, action)(record.approval_token, "reviewed")

    statement = db.execute.await_args.args[0]
    sql = str(statement.compile(dialect=mysql.dialect()))
    assert sql.rstrip().endswith("FOR UPDATE")
    assert record.approval_token is None
    assert record.notes == "reviewed"
    db.flush.assert_awaited_once()

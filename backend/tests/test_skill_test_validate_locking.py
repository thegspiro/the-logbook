"""Lock-acquisition order in validate_test.

Codex flagged two issues in the capacity-lock fix on PR #1901:

  P1  The lock was acquired on the candidate's RequirementProgress row, which
      only exists once they have an active enrollment — not guaranteed for
      every linked requirement — so it could sometimes lock nothing at all.
  P2  validate_test locks the specific SkillTest row being validated
      (_lock_test_for_transition) *before* the capacity check ran. Two
      officers validating different pending tests for the same
      candidate+requirement could each hold their own test row locked and
      then deadlock waiting on the capacity lock in the opposite order,
      because the attempt count's own locking read touches every test row
      for that candidate+requirement, including whichever one the other
      transaction is holding.

Fixed by locking TrainingRequirement (guaranteed to exist) instead, and by
having validate_test acquire that lock — via a non-locking peek at the test's
requirement_id — before it locks the test row itself. This test pins the
ordering half of that fix; the "which row" half is covered by
TestCapacityLocking in test_skill_test_attempt_limit.py.

DB is mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import skills_testing as endpoint


def _officer():
    return SimpleNamespace(id=uuid4(), organization_id=uuid4(), username="chief")


async def test_capacity_lock_is_acquired_before_the_test_row_lock():
    order = []
    requirement_id = str(uuid4())

    peek_result = MagicMock()
    peek_result.first.return_value = SimpleNamespace(requirement_id=requirement_id)

    lock_result = MagicMock()
    lock_result.scalar_one_or_none.return_value = SimpleNamespace(max_attempts=2)

    missing_test_result = MagicMock()
    missing_test_result.scalar_one_or_none.return_value = None

    async def execute(stmt, *_args, **_kwargs):
        compiled = str(stmt)
        has_lock = "FOR UPDATE" in compiled
        if "skill_tests" in compiled.lower() and not has_lock:
            order.append("peek")
            return peek_result
        if "training_requirements" in compiled.lower() and has_lock:
            order.append("capacity_lock")
            return lock_result
        if "skill_tests" in compiled.lower() and has_lock:
            order.append("test_row_lock")
            return missing_test_result
        raise AssertionError(f"unexpected query: {compiled}")

    db = MagicMock()
    db.execute = execute

    with pytest.raises(HTTPException) as exc:
        await endpoint.validate_test(test_id=uuid4(), db=db, current_user=_officer())

    assert exc.value.status_code == 404
    assert order == ["peek", "capacity_lock", "test_row_lock"]


async def test_no_capacity_lock_when_the_peek_finds_no_requirement():
    """An unlinked test has nothing to serialize on, so validate_test must not
    call lock_attempt_capacity at all — only the peek and the test-row lock."""
    order = []

    peek_result = MagicMock()
    peek_result.first.return_value = SimpleNamespace(requirement_id=None)

    missing_test_result = MagicMock()
    missing_test_result.scalar_one_or_none.return_value = None

    async def execute(stmt, *_args, **_kwargs):
        compiled = str(stmt)
        has_lock = "FOR UPDATE" in compiled
        if "skill_tests" in compiled.lower() and not has_lock:
            order.append("peek")
            return peek_result
        if "skill_tests" in compiled.lower() and has_lock:
            order.append("test_row_lock")
            return missing_test_result
        raise AssertionError(f"unexpected query: {compiled}")

    db = MagicMock()
    db.execute = execute

    with pytest.raises(HTTPException) as exc:
        await endpoint.validate_test(test_id=uuid4(), db=db, current_user=_officer())

    assert exc.value.status_code == 404
    assert order == ["peek", "test_row_lock"]

"""run_mark_overdue_dues marks fully-unpaid past-due dues as OVERDUE.

Nothing else in the codebase ever sets DuesStatus.OVERDUE, so before this task
the dues summary always reported zero overdue and a status="overdue" filter
returned nothing. This test pins the UPDATE the task issues (target table,
the PENDING -> OVERDUE transition, and the past-due / unpaid predicates) and
the count it returns, without a real database.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from sqlalchemy.dialects import mysql

from app.services.scheduled_tasks import run_mark_overdue_dues


async def test_marks_overdue_and_returns_count():
    captured = []

    async def cap(statement, *a, **k):
        captured.append(statement)
        return SimpleNamespace(rowcount=3)

    db = MagicMock()
    db.execute = AsyncMock(side_effect=cap)
    db.commit = AsyncMock()

    out = await run_mark_overdue_dues(db)

    assert out == {"task": "mark_overdue_dues", "marked_overdue": 3}
    db.commit.assert_awaited_once()

    sql = str(
        captured[0].compile(
            dialect=mysql.dialect(), compile_kwargs={"literal_binds": True}
        )
    ).lower()
    assert "update member_dues" in sql
    assert "overdue" in sql  # the value being set
    assert "pending" in sql  # only fully-unpaid records transition
    assert "amount_paid < member_dues.amount_due" in sql  # unpaid balance


async def test_zero_when_nothing_overdue():
    db = MagicMock()
    db.execute = AsyncMock(return_value=SimpleNamespace(rowcount=0))
    db.commit = AsyncMock()

    out = await run_mark_overdue_dues(db)
    assert out["marked_overdue"] == 0

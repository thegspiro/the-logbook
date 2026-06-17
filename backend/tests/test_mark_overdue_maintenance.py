"""run_mark_overdue_maintenance flips past-due incomplete maintenance to overdue.

is_overdue on apparatus/facility maintenance is stamped at create/update but
never recomputed as time passes, so a record entered with a future due date
stays is_overdue=False once the date passes — understating the overdue counts.
This test pins the per-table UPDATEs (target tables, the is_overdue value, and
the incomplete / past-due / not-yet-flagged predicates) and the total count,
without a real database.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from sqlalchemy.dialects import mysql

from app.services.scheduled_tasks import run_mark_overdue_maintenance


async def test_marks_apparatus_and_facility_overdue():
    captured = []

    async def cap(statement, *a, **k):
        captured.append(statement)
        return SimpleNamespace(rowcount=2)

    db = MagicMock()
    db.execute = AsyncMock(side_effect=cap)
    db.commit = AsyncMock()

    out = await run_mark_overdue_maintenance(db)

    # Two tables, two rows each.
    assert out == {"task": "mark_overdue_maintenance", "marked_overdue": 4}
    db.commit.assert_awaited_once()
    assert len(captured) == 2

    sqls = [
        str(
            s.compile(dialect=mysql.dialect(), compile_kwargs={"literal_binds": True})
        ).lower()
        for s in captured
    ]
    assert any("update apparatus_maintenance" in s for s in sqls)
    assert any("update facility_maintenance" in s for s in sqls)
    for s in sqls:
        assert "is_overdue" in s  # only past-due, not-yet-flagged rows


async def test_zero_when_nothing_overdue():
    db = MagicMock()
    db.execute = AsyncMock(return_value=SimpleNamespace(rowcount=0))
    db.commit = AsyncMock()
    out = await run_mark_overdue_maintenance(db)
    assert out["marked_overdue"] == 0

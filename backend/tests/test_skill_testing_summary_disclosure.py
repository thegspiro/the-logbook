"""The skills-testing summary keeps outcome figures to officers (SKT4-3).

Any member may read ``GET /training/skills-testing/summary``. With one
validated test in the department, its pass rate and average score are that
member's exact result, whatever the test's own disclosure settings say. Counts
stay visible to everyone; the outcome figures are computed only for a
``training.manage`` holder.

DB is mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.api.v1.endpoints import skills_testing
from app.api.v1.endpoints.skills_testing import get_testing_summary

pytestmark = pytest.mark.unit


def _db():
    """Every count answers 1 and the average answers 87.5."""
    result = MagicMock()
    result.scalar.return_value = 1
    avg = MagicMock()
    avg.scalar.return_value = 87.5

    async def execute(statement, *args, **kwargs):
        return avg if "avg(" in str(statement) else result

    db = MagicMock()
    db.execute = AsyncMock(side_effect=execute)
    return db


def _user():
    return SimpleNamespace(id="u1", organization_id="org-1")


async def test_a_member_sees_counts_but_no_outcome_figures(monkeypatch):
    monkeypatch.setattr(skills_testing, "_can_manage_tests", lambda user: False)
    db = _db()

    summary = await get_testing_summary(db=db, current_user=_user())

    assert summary.total_tests == 1
    assert summary.pass_rate is None
    assert summary.average_score is None
    assert summary.pending_validation == 0
    # Not merely hidden: never computed.
    assert not any("avg(" in str(c.args[0]) for c in db.execute.await_args_list)


async def test_an_officer_sees_the_outcome_figures(monkeypatch):
    monkeypatch.setattr(skills_testing, "_can_manage_tests", lambda user: True)

    summary = await get_testing_summary(db=_db(), current_user=_user())

    assert summary.pass_rate == 100.0
    assert summary.average_score == 87.5

"""
Tests for the grant service (app/services/grant_service.py).

Focus on the date-driven compliance-task generation (_generate_compliance_tasks)
— how many periodic performance reports are created for each reporting
frequency, the +90-day closeout report, and the equipment-inventory task —
plus the budget-item spent/remaining recompute. DB mocked; no MySQL.
"""

from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.services.grant_service import GrantService


def _scalar(value):
    return MagicMock(scalar=MagicMock(return_value=value))


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _application(
    freq="quarterly",
    start=date(2026, 1, 1),
    end=date(2026, 12, 31),
    category=None,
):
    return SimpleNamespace(
        id="app-1",
        reporting_frequency=SimpleNamespace(value=freq) if freq else None,
        grant_start_date=start,
        grant_end_date=end,
        opportunity=SimpleNamespace(category=category) if category else None,
    )


async def _generate(application):
    """Run the generator and return the objects added to the session."""
    db = MagicMock()
    db.add = MagicMock()
    await GrantService(db)._generate_compliance_tasks(application, "user-1")
    return [c.args[0] for c in db.add.call_args_list]


def _by_type(added, task_type):
    return [t for t in added if getattr(t, "task_type", None) == task_type]


class TestComplianceTaskGeneration:
    async def test_quarterly_creates_three_reports_plus_closeout(self):
        added = await _generate(_application(freq="quarterly"))
        reports = _by_type(added, "performance_report")
        assert [r.due_date for r in reports] == [
            date(2026, 4, 1),
            date(2026, 7, 1),
            date(2026, 10, 1),
        ]
        closeout = _by_type(added, "closeout_report")
        assert len(closeout) == 1
        # Closeout is 90 days after grant end.
        assert closeout[0].due_date == date(2027, 3, 31)

    async def test_monthly_creates_eleven_reports(self):
        added = await _generate(_application(freq="monthly"))
        assert len(_by_type(added, "performance_report")) == 11

    async def test_annual_creates_no_interior_reports(self):
        # start+1yr == 2027-01-01 which is past the 2026-12-31 end -> none.
        added = await _generate(_application(freq="annual"))
        assert len(_by_type(added, "performance_report")) == 0
        assert len(_by_type(added, "closeout_report")) == 1

    async def test_no_frequency_only_closeout(self):
        added = await _generate(_application(freq=None))
        assert len(_by_type(added, "performance_report")) == 0
        assert len(_by_type(added, "closeout_report")) == 1

    async def test_no_end_date_skips_reports_and_closeout(self):
        added = await _generate(_application(freq="quarterly", end=None))
        assert _by_type(added, "performance_report") == []
        assert _by_type(added, "closeout_report") == []

    async def test_equipment_grant_adds_inventory_task(self):
        added = await _generate(_application(category="equipment"))
        assert len(_by_type(added, "equipment_inventory")) == 1

    async def test_non_equipment_grant_has_no_inventory_task(self):
        added = await _generate(_application(category="training"))
        assert _by_type(added, "equipment_inventory") == []

    async def test_compliance_note_added_when_tasks_created(self):
        added = await _generate(_application(freq="quarterly"))
        notes = [t for t in added if getattr(t, "note_type", None) is not None]
        assert len(notes) == 1


class TestUpdateBudgetItemSpent:
    async def test_sets_spent_and_remaining(self):
        item = SimpleNamespace(
            id="b1", amount_budgeted=1000, amount_spent=0, amount_remaining=0
        )
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_scalar(300), _one(item)])
        await GrantService(db)._update_budget_item_spent("b1")
        assert item.amount_spent == 300
        assert item.amount_remaining == 700

    async def test_missing_item_is_noop(self):
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_scalar(300), _one(None)])
        # Should not raise when the budget item is gone.
        await GrantService(db)._update_budget_item_spent("b1")


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))

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

import pytest

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
    already_generated=False,
):
    return SimpleNamespace(
        id="app-1",
        reporting_frequency=SimpleNamespace(value=freq) if freq else None,
        grant_start_date=start,
        grant_end_date=end,
        opportunity=SimpleNamespace(category=category) if category else None,
        compliance_tasks_generated=already_generated,
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

    async def test_plain_string_frequency_renders_without_crash(self):
        # After a PUT sets reporting_frequency, the attribute is a plain str
        # (Literal schema field) until the row is refreshed from the DB —
        # reading `.value` off it used to raise AttributeError -> 500. The
        # report description must render the frequency via _status_value.
        app = _application(freq="quarterly")
        app.reporting_frequency = "quarterly"  # plain str, not enum-like
        added = await _generate(app)
        reports = _by_type(added, "performance_report")
        assert len(reports) == 3
        assert "quarterly" in reports[0].description

    async def test_skips_regeneration_on_a_second_award(self):
        # An awarded -> active -> awarded round-trip re-enters this method.
        # If it already ran for this application, it must add nothing
        # rather than appending a duplicate set.
        added = await _generate(
            _application(freq="quarterly", category="equipment", already_generated=True)
        )
        assert added == []

    async def test_manually_created_task_of_the_same_type_does_not_suppress_generation(
        self,
    ):
        # Codex (PR #1904 review): task_type is fully client-chosen on manual
        # creation, with no application-status restriction — an officer's
        # own pre-award "performance_report" task must not be mistaken for
        # a prior run of this method. Only the dedicated flag gates it.
        app = _application(freq="quarterly")
        added = await _generate(app)
        assert len(_by_type(added, "performance_report")) == 3

    async def test_sets_the_flag_after_generating(self):
        app = _application(freq="quarterly")
        await _generate(app)
        assert app.compliance_tasks_generated is True


class TestUpdateBudgetItemSpent:
    async def test_sets_spent_and_remaining(self):
        item = SimpleNamespace(
            id="b1", amount_budgeted=1000, amount_spent=0, amount_remaining=0
        )
        db = MagicMock()
        # Item lock happens first, then the (also locking) SUM read.
        db.execute = AsyncMock(side_effect=[_one(item), _scalar(300)])
        await GrantService(db)._update_budget_item_spent("b1", "org-1")
        assert item.amount_spent == 300
        assert item.amount_remaining == 700

    async def test_missing_or_out_of_org_item_is_noop(self):
        db = MagicMock()
        db.execute = AsyncMock(return_value=_one(None))
        # Should not raise, and must not attempt the SUM query.
        await GrantService(db)._update_budget_item_spent("b1", "org-1")
        db.execute.assert_awaited_once()


class TestExpenditureBudgetItemLockOrdering:
    """Codex (PR #1904 review): GrantExpenditure.budget_item_id is a FK
    column, so inserting/updating an expenditure before locking its budget
    item takes an implicit shared FK-check lock on the parent ahead of the
    exclusive FOR UPDATE lock the recompute takes — two concurrent
    expenditures against the same budget item deadlock. The budget item
    lock must happen before the expenditure is added to the session."""

    async def test_create_locks_budget_item_before_adding_expenditure(self):
        order = []

        async def execute(stmt, *_a, **_kw):
            order.append(("execute", str(stmt)))
            result = MagicMock()
            result.scalar_one_or_none.return_value = "ok"
            return result

        db = MagicMock()
        db.execute = execute
        db.add = MagicMock(side_effect=lambda obj: order.append(("add", obj)))
        db.flush = AsyncMock(side_effect=lambda: order.append(("flush", None)))
        db.refresh = AsyncMock()

        svc = GrantService(db)
        svc.get_application = AsyncMock(return_value=SimpleNamespace(id="app-1"))
        svc._budget_item_in_application = AsyncMock(return_value=True)
        svc._update_budget_item_spent = AsyncMock()

        await svc.create_expenditure(
            "app-1", "org-1", {"budget_item_id": "b1", "amount": 100}, "user-1"
        )

        add_index = next(i for i, (kind, _) in enumerate(order) if kind == "add")
        lock_calls = [stmt for kind, stmt in order[:add_index] if kind == "execute"]
        assert len(lock_calls) == 1
        assert "FOR UPDATE" in lock_calls[0]
        assert "grant_budget_items" in lock_calls[0].lower()

    async def test_update_locks_old_and_new_budget_items_before_flush(self):
        expenditure = SimpleNamespace(
            id="e1", application_id="app-1", budget_item_id="bOLD", amount=50
        )
        order = []

        async def execute(stmt, *_a, **_kw):
            order.append(str(stmt))
            result = MagicMock()
            result.scalar_one_or_none.return_value = expenditure
            return result

        db = MagicMock()
        db.execute = execute
        db.flush = AsyncMock(side_effect=lambda: order.append("FLUSH"))
        svc = GrantService(db)
        svc._budget_item_in_application = AsyncMock(return_value=True)
        svc._update_budget_item_spent = AsyncMock()

        await svc.update_expenditure("e1", {"budget_item_id": "bNEW"}, "org-1")

        flush_index = order.index("FLUSH")
        pre_flush = order[:flush_index]
        lock_stmts = [s for s in pre_flush if "FOR UPDATE" in s]
        assert len(lock_stmts) == 2
        assert all("grant_budget_items" in s.lower() for s in lock_stmts)


class TestSubresourceOrgScoping:
    """Budget items, expenditures, and compliance tasks are sub-resources of a
    grant application. The fundraising.manage permission is not org-specific,
    so their update/delete-by-id methods must scope to the caller's org via the
    parent application — otherwise a manager in org A can mutate org B's
    financial records by guessing a UUID (cross-org IDOR)."""

    @pytest.mark.parametrize(
        "make_call",
        [
            lambda s: s.update_budget_item("x", {"amount_budgeted": 1}, "org-A"),
            lambda s: s.delete_budget_item("x", "org-A"),
            lambda s: s.update_expenditure("x", {"amount": 1}, "org-A"),
            lambda s: s.delete_expenditure("x", "org-A"),
            lambda s: s.update_compliance_task("x", {"title": "t"}, "u1", "org-A"),
            lambda s: s.delete_compliance_task("x", "org-A"),
        ],
    )
    async def test_mutator_query_joins_application_and_filters_org(self, make_call):
        from sqlalchemy.dialects import mysql

        captured = []

        async def cap(stmt, *a, **k):
            captured.append(stmt)
            result = MagicMock()
            # No row matches once the org filter is applied → safe no-op.
            result.scalar_one_or_none.return_value = None
            return result

        db = MagicMock()
        db.execute = AsyncMock(side_effect=cap)
        db.flush = AsyncMock()
        db.delete = AsyncMock()

        out = await make_call(GrantService(db))
        assert out is None or out is False

        sql = str(captured[0].compile(dialect=mysql.dialect())).lower()
        assert "grant_applications" in sql  # scoped through the parent
        assert "organization_id" in sql

    async def test_list_notes_rejects_foreign_application(self):
        # get_application resolves nothing for this org -> reject, don't leak.
        db = MagicMock()
        db.execute = AsyncMock(return_value=_one(None))
        with pytest.raises(ValueError, match="Application not found"):
            await GrantService(db).list_notes("app-x", "org-A")

    async def test_create_note_rejects_foreign_application(self):
        db = MagicMock()
        db.execute = AsyncMock(return_value=_one(None))
        db.add = MagicMock()
        db.flush = AsyncMock()
        with pytest.raises(ValueError, match="Application not found"):
            await GrantService(db).create_note("app-x", {"content": "x"}, "u1", "org-A")


class TestApplicationFkValidation:
    """GF-6: linked_campaign_id / assigned_to / approved_by on an application
    must be in the caller's org (stored-only FKs — dangling/mis-attributed)."""

    async def test_create_rejects_foreign_assigned_to(self):
        # opportunity_id + linked_campaign_id absent (skipped); assigned_to
        # present -> its in-org lookup returns nothing -> reject.
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_one(None)])
        db.add = MagicMock()
        db.flush = AsyncMock()
        with pytest.raises(ValueError, match="Invalid Assigned user"):
            await GrantService(db).create_application(
                "org-1", {"assigned_to": "uFOREIGN"}, "u1"
            )

    async def test_create_rejects_foreign_linked_campaign(self):
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_one(None)])
        db.add = MagicMock()
        db.flush = AsyncMock()
        with pytest.raises(ValueError, match="Invalid Linked campaign"):
            await GrantService(db).create_application(
                "org-1", {"linked_campaign_id": "cFOREIGN"}, "u1"
            )


class TestUpdateComplianceTaskHardening:
    """B14 pass-2: update_compliance_task must validate a client-supplied
    assigned_to in-org (XC-1 — the create schema can't set it, but the update
    schema can), and must read task_type via _status_value so a plain-str
    Literal value doesn't 500 when a task is completed."""

    @staticmethod
    def _task():
        return SimpleNamespace(
            id="t1",
            application_id="app-1",
            title="Audit",
            task_type="audit",  # plain str (Literal schema field), not enum
            status="pending",
            completed_date=None,
        )

    async def test_rejects_foreign_assigned_to(self):
        task = self._task()
        db = MagicMock()
        # 1st execute: in-org task fetch. 2nd: assert_in_org lookup -> None.
        db.execute = AsyncMock(side_effect=[_one(task), _one(None)])
        db.add = MagicMock()
        db.flush = AsyncMock()
        with pytest.raises(ValueError, match="Invalid Assigned user"):
            await GrantService(db).update_compliance_task(
                "t1", {"assigned_to": "uFOREIGN"}, "u1", "org-A"
            )

    async def test_complete_with_plain_str_task_type_does_not_crash(self):
        task = self._task()
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_one(task)])  # assigned_to omitted
        db.add = MagicMock()
        db.flush = AsyncMock()
        out = await GrantService(db).update_compliance_task(
            "t1", {"status": "completed"}, "u1", "org-A"
        )
        assert out is task
        assert task.status == "completed"
        # Completion note added, task_type read safely off the plain str.
        notes = [c.args[0] for c in db.add.call_args_list]
        assert len(notes) == 1
        assert notes[0].note_metadata["task_type"] == "audit"


class TestListPagination:
    """GF-35: every list_* method applies skip/limit in SQL rather than
    fetching the whole org-wide table and slicing in Python (Checklist #6 —
    an unbounded list endpoint). A mocked session can't prove the *row
    count* is bounded, but it can prove the LIMIT/OFFSET clause the
    endpoint's `pagination.skip`/`pagination.limit` feed actually reaches
    the compiled statement, which is the part a regression would silently
    drop (e.g. reverting to `results[skip:skip+limit]` in Python)."""

    @staticmethod
    def _scalars(items):
        r = MagicMock()
        r.scalars.return_value.all.return_value = items
        r.scalars.return_value.unique.return_value.all.return_value = items
        return r

    @classmethod
    async def _compiled_sql(cls, coro):
        from sqlalchemy.dialects import mysql

        captured = []

        async def execute(stmt, *_a, **_kw):
            captured.append(stmt)
            return cls._scalars([])

        db = MagicMock()
        db.execute = execute
        await coro(db)
        assert captured, "list method never executed a query"
        return str(
            captured[-1].compile(
                dialect=mysql.dialect(), compile_kwargs={"literal_binds": True}
            )
        ).lower()

    # MySQL's dialect renders LIMIT/OFFSET as a single clause,
    # `LIMIT <offset>, <count>` — there is no separate "offset" keyword to
    # assert on.

    async def test_list_opportunities_applies_skip_and_limit(self):
        sql = await self._compiled_sql(
            lambda db: GrantService(db).list_opportunities("org-1", skip=10, limit=5)
        )
        assert "limit 10, 5" in sql

    async def test_list_applications_applies_skip_and_limit(self):
        sql = await self._compiled_sql(
            lambda db: GrantService(db).list_applications("org-1", skip=20, limit=7)
        )
        assert "limit 20, 7" in sql

    async def test_list_compliance_tasks_applies_skip_and_limit(self):
        sql = await self._compiled_sql(
            lambda db: GrantService(db).list_compliance_tasks("org-1", skip=3, limit=6)
        )
        assert "limit 3, 6" in sql

    async def test_list_opportunities_defaults_are_bounded(self):
        # No caller passes skip/limit explicitly except the endpoint layer —
        # the defaults themselves must still bound the query, not fetch
        # everything (an unbounded query would compile with no LIMIT clause
        # at all).
        sql = await self._compiled_sql(
            lambda db: GrantService(db).list_opportunities("org-1")
        )
        assert "limit 0, 100" in sql

    async def test_list_budget_items_applies_skip_and_limit(self):
        app = SimpleNamespace(id="app-1", organization_id="org-1")

        async def execute(stmt, *_a, **_kw):
            if not hasattr(execute, "calls"):
                execute.calls = 0
            execute.calls += 1
            if execute.calls == 1:
                # get_application, resolving the parent application in-org.
                return _one(app)
            execute.captured = stmt
            return self._scalars([])

        db = MagicMock()
        db.execute = execute
        await GrantService(db).list_budget_items("app-1", "org-1", skip=2, limit=4)
        from sqlalchemy.dialects import mysql

        sql = str(
            execute.captured.compile(
                dialect=mysql.dialect(), compile_kwargs={"literal_binds": True}
            )
        ).lower()
        assert "limit 2, 4" in sql


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))

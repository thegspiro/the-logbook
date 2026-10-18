"""Dues past their date read as overdue everywhere, not only after the task runs.

The dashboard counts unpaid dues past their due date as overdue straight from
the dates, while the dues list, its status filter and the dues summary read the
stored status column, which reaches OVERDUE only when the daily
mark_overdue_dues task persists it. Between runs the same record read
"Pending" on the dues screen and "overdue" on the dashboard (CLAUDE.md
Pitfall #29). These pin the shared definition on every read and on the ledger
recalculation that used to put a past-due record back to PENDING.

Unit tests: no database, the queries are captured and compiled.
"""

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.dialects import mysql

from app.api.dependencies import PaginationParams
from app.models.finance import DuesStatus, MemberDues
from app.services.finance_service import FinanceService, _apply_payment_totals

pytestmark = [pytest.mark.unit]

ORG_ID = str(uuid.uuid4())


def _dues(**overrides) -> MemberDues:
    now = datetime.now(timezone.utc)
    values = {
        "id": str(uuid.uuid4()),
        "organization_id": ORG_ID,
        "dues_schedule_id": str(uuid.uuid4()),
        "user_id": str(uuid.uuid4()),
        "amount_due": Decimal("100.00"),
        "amount_paid": Decimal("0.00"),
        "status": DuesStatus.PENDING,
        # MySQL DATETIME comes back naive, so the fixture does too.
        "due_date": (now - timedelta(days=3)).replace(tzinfo=None),
        "created_at": now,
        "updated_at": now,
    }
    values.update(overrides)
    return MemberDues(**values)


def _list_service(rows: list[MemberDues], captured: list) -> FinanceService:
    async def execute(statement, *a, **k):
        captured.append(statement)
        result = MagicMock()
        result.all = MagicMock(
            return_value=[(d, "Pat", "Doe", None, "pdoe") for d in rows]
        )
        return result

    db = MagicMock()
    db.execute = AsyncMock(side_effect=execute)
    return FinanceService(db)


def _sql(statement) -> str:
    return str(
        statement.compile(
            dialect=mysql.dialect(), compile_kwargs={"literal_binds": True}
        )
    ).lower()


class TestDuesList:
    async def test_past_due_pending_is_reported_overdue(self):
        future = (datetime.now(timezone.utc) + timedelta(days=3)).replace(tzinfo=None)
        rows = [
            _dues(),
            _dues(due_date=future),
            _dues(status=DuesStatus.PARTIAL, amount_paid=Decimal("40.00")),
        ]
        service = _list_service(rows, [])

        out = await service.list_member_dues(
            ORG_ID, PaginationParams(skip=0, limit=100)
        )

        assert [r["status"] for r in out] == [
            DuesStatus.OVERDUE,
            DuesStatus.PENDING,
            # Part-paid stays PARTIAL, as the task leaves it.
            DuesStatus.PARTIAL,
        ]

    async def test_overdue_filter_includes_past_due_pending(self):
        captured: list = []
        service = _list_service([], captured)

        await service.list_member_dues(
            ORG_ID, PaginationParams(skip=0, limit=100), status="overdue"
        )

        sql = _sql(captured[0])
        assert "member_dues.status = 'overdue'" in sql
        assert "member_dues.status = 'pending'" in sql
        assert "member_dues.due_date <" in sql
        assert "member_dues.amount_paid < member_dues.amount_due" in sql

    async def test_pending_filter_excludes_past_due(self):
        captured: list = []
        service = _list_service([], captured)

        await service.list_member_dues(
            ORG_ID, PaginationParams(skip=0, limit=100), status="pending"
        )

        sql = _sql(captured[0])
        assert "member_dues.status = 'pending'" in sql
        assert "not (" in sql
        assert "member_dues.due_date <" in sql


class TestDuesSummary:
    async def test_members_overdue_counts_past_due_pending(self):
        rows = [
            _dues(),
            _dues(status=DuesStatus.OVERDUE),
            _dues(
                due_date=(datetime.now(timezone.utc) + timedelta(days=3)).replace(
                    tzinfo=None
                )
            ),
        ]
        db = MagicMock()
        result = MagicMock()
        result.scalars.return_value.all.return_value = rows
        db.execute = AsyncMock(return_value=result)

        summary = await FinanceService(db).get_dues_summary(ORG_ID)

        assert summary["members_overdue"] == 2


class TestLedgerRecalculation:
    def test_nothing_paid_past_due_is_overdue_not_pending(self):
        # The unwaive path: a past-due record with an empty ledger.
        dues = _dues(status=DuesStatus.WAIVED)
        _apply_payment_totals(dues)
        assert dues.status == DuesStatus.OVERDUE

    def test_nothing_paid_before_due_date_is_pending(self):
        dues = _dues(due_date=datetime.now(timezone.utc) + timedelta(days=3))
        _apply_payment_totals(dues)
        assert dues.status == DuesStatus.PENDING

"""Dues generated against a due date already past start out overdue.

Workflow review W66: the treasurer created "2026 Annual Dues", due 1 March,
in October, and generated them. Every member read "Pending" and the Overdue
filter came back empty, because only the daily ``run_mark_overdue_dues``
moves a record to OVERDUE.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.finance import DuesStatus, MemberDues
from app.services.finance_service import FinanceService

pytestmark = [pytest.mark.unit]


def _service(due_date: datetime) -> tuple[FinanceService, list]:
    members = [SimpleNamespace(id="u-1"), SimpleNamespace(id="u-2")]
    users_result = MagicMock()
    users_result.scalars.return_value.all.return_value = members
    no_existing = MagicMock()
    no_existing.scalar_one_or_none.return_value = None

    db = MagicMock()
    db.execute = AsyncMock(side_effect=[users_result, no_existing, no_existing])
    db.flush = AsyncMock()
    added: list = []
    db.add = MagicMock(side_effect=added.append)

    service = FinanceService(db)
    schedule = SimpleNamespace(amount=Decimal("120.00"), due_date=due_date)
    service.get_dues_schedule = AsyncMock(return_value=schedule)
    return service, added


class TestGeneratedDuesStatus:
    async def test_a_past_due_date_generates_overdue_dues(self):
        service, added = _service(datetime.now(timezone.utc) - timedelta(days=200))

        assert await service.generate_member_dues("sched-1", "org-1") == 2
        assert [d.status for d in added if isinstance(d, MemberDues)] == [
            DuesStatus.OVERDUE,
            DuesStatus.OVERDUE,
        ]

    async def test_a_future_due_date_generates_pending_dues(self):
        service, added = _service(datetime.now(timezone.utc) + timedelta(days=30))

        await service.generate_member_dues("sched-1", "org-1")
        assert {d.status for d in added} == {DuesStatus.PENDING}

    async def test_a_naive_due_date_is_read_as_utc(self):
        # MySQL hands DateTime(timezone=True) back without tzinfo.
        past = (datetime.now(timezone.utc) - timedelta(days=1)).replace(tzinfo=None)
        service, added = _service(past)

        await service.generate_member_dues("sched-1", "org-1")
        assert {d.status for d in added} == {DuesStatus.OVERDUE}

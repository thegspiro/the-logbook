"""
_validate_finance_fks must scope a client-supplied ``station_id`` to the
caller's org (CLAUDE.md pitfall 14c).

The helper validated budget_id, category_id and fiscal_year_id but not
station_id, while BudgetCreate/BudgetUpdate both expose it as a free string.
A dangling cross-tenant reference here is worse than a skewed rollup: the
column is an ``ondelete="SET NULL"`` FK to facilities, so the *other* org
deleting that facility silently nulls this org's station attribution.

DB mocked; no MySQL.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.finance_service import FinanceService


def _found(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


class TestBudgetStationScoping:
    async def test_rejects_a_station_from_another_org(self):
        db = MagicMock()
        # The in-org facility lookup resolves nothing -> reject before any write.
        db.execute = AsyncMock(return_value=_found(None))
        svc = FinanceService(db)

        with pytest.raises(ValueError, match="Invalid Station"):
            await svc._validate_finance_fks("org-1", {"station_id": "fac-FOREIGN"})

    async def test_accepts_a_station_in_the_callers_org(self):
        db = MagicMock()
        db.execute = AsyncMock(return_value=_found("fac-1"))
        svc = FinanceService(db)

        await svc._validate_finance_fks("org-1", {"station_id": "fac-1"})

    async def test_an_absent_station_is_not_rejected(self):
        """Update paths pass exclude_unset dumps, so an omitted key means
        "leave it alone" and must not be treated as an invalid reference."""
        db = MagicMock()
        db.execute = AsyncMock(return_value=_found(None))
        svc = FinanceService(db)

        await svc._validate_finance_fks("org-1", {})
        await svc._validate_finance_fks("org-1", {"station_id": None})

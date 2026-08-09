"""
FIN-8 (pass 2): create/update_dues_schedule must run _validate_finance_fks so a
client-supplied fiscal_year_id is validated in-org before it is persisted — the
one create/update pair the pass-1 "all 7 finance FK paths" statement missed.
DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.finance_service import FinanceService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


class TestDuesScheduleFiscalYearScoping:
    async def test_create_rejects_foreign_fiscal_year(self):
        db = MagicMock()
        # _validate_finance_fks only queries for the fiscal_year_id key here;
        # the in-org lookup resolves nothing -> reject before any write.
        db.execute = AsyncMock(return_value=_one(None))
        db.add = MagicMock()
        db.flush = AsyncMock()
        svc = FinanceService(db)
        with pytest.raises(ValueError, match="Fiscal year not found"):
            await svc.create_dues_schedule(
                "org-1", "u1", fiscal_year_id="fy-FOREIGN", amount=100
            )
        db.add.assert_not_called()

    async def test_update_rejects_foreign_fiscal_year(self):
        schedule = SimpleNamespace(id="ds1", organization_id="org-1")
        db = MagicMock()
        # 1) get_dues_schedule (in-org, found), 2) fiscal-year lookup -> None.
        db.execute = AsyncMock(side_effect=[_one(schedule), _one(None)])
        db.flush = AsyncMock()
        svc = FinanceService(db)
        with pytest.raises(ValueError, match="Fiscal year not found"):
            await svc.update_dues_schedule("ds1", "org-1", fiscal_year_id="fy-FOREIGN")


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))

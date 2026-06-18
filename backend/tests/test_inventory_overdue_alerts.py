"""run_inventory_overdue_alerts must refresh the stored is_overdue flag.

mark_overdue_checkouts is the only thing that recomputes CheckOutRecord.is_overdue
(set False at checkout, used by inventory dashboard/summary counts), but it had
no caller. The daily overdue-alert task now invokes it per org so those counts
don't undercount as checkouts pass their expected return date. DB mocked.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.scheduled_tasks import run_inventory_overdue_alerts


async def test_refreshes_overdue_flag_per_org():
    org = SimpleNamespace(id="org-1", timezone="America/New_York", name="Dept")
    org_result = MagicMock()
    org_result.scalars.return_value.all.return_value = [org]
    db = MagicMock()
    db.execute = AsyncMock(return_value=org_result)

    with patch("app.services.inventory_service.InventoryService") as MockSvc:
        instance = MockSvc.return_value
        instance.mark_overdue_checkouts = AsyncMock(return_value=0)
        # No overdue items -> the alerting body short-circuits after the refresh.
        instance.get_overdue_checkouts_for_alerts = AsyncMock(return_value=[])

        await run_inventory_overdue_alerts(db)

    instance.mark_overdue_checkouts.assert_awaited_once_with("org-1")

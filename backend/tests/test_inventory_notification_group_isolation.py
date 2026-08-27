"""
Codex review on PR #1915 (CRON2-31-1's fix): InventoryNotificationService
.process_pending_notifications groups queue records by (org_id, user_id)
and commits/rolls back per group on a shared session.
await self.db.rollback() expires *every* persistent object in the session,
not just the failed group's — so once one group's rollback fires, every
later group's pre-fetched InventoryNotificationQueue rows are expired, and
reading one of their attributes (rec.action_type, rec.quantity, ...) would
raise MissingGreenlet under AsyncSession outside the greenlet bridge. The
fix refreshes each subsequent group's records before use once any prior
group has failed. DB mocked; no MySQL.
"""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

from app.models.inventory import InventoryActionType, InventoryNotificationQueue
from app.services.inventory_notification_service import InventoryNotificationService


def _record(org_id, user_id, item_id="item-1"):
    return InventoryNotificationQueue(
        id=f"rec-{org_id}-{user_id}",
        organization_id=org_id,
        user_id=user_id,
        item_id=item_id,
        item_name="Radio",
        item_serial_number=None,
        item_asset_tag=None,
        action_type=InventoryActionType.ASSIGNED,
        quantity=1,
        processed=False,
        created_at=datetime.now(timezone.utc),
    )


def _query_result(records):
    result = MagicMock()
    result.scalars.return_value.all.return_value = records
    return result


class TestGroupIsolationRefreshesAfterRollback:
    async def test_refresh_is_skipped_until_a_group_fails(self):
        """No failure yet -> no refresh calls at all (avoid the extra
        round-trip in the common, all-succeeds case)."""
        records = [_record("org-1", "user-a"), _record("org-2", "user-b")]
        db = MagicMock()
        db.execute = AsyncMock(return_value=_query_result(records))
        db.commit = AsyncMock()
        db.refresh = AsyncMock()

        svc = InventoryNotificationService(db)
        svc._get_user = AsyncMock(return_value=None)  # forces the "no email" skip path

        await svc.process_pending_notifications()

        db.refresh.assert_not_awaited()

    async def test_refreshes_later_groups_records_after_an_earlier_group_fails(self):
        """Once one group fails and rolls back, every later group's
        already-fetched records must be refreshed before their attributes
        are read again, or a real AsyncSession would raise MissingGreenlet
        on the expired attribute access inside _net_actions."""
        rec_a = _record("org-1", "user-a")
        rec_b = _record("org-2", "user-b")
        db = MagicMock()
        db.execute = AsyncMock(return_value=_query_result([rec_a, rec_b]))
        db.commit = AsyncMock()
        db.rollback = AsyncMock()
        db.refresh = AsyncMock()

        svc = InventoryNotificationService(db)

        call_count = 0
        real_net_actions = svc._net_actions

        def failing_first_group(records):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise RuntimeError("simulated failure for the first group")
            return real_net_actions(records)

        svc._net_actions = failing_first_group
        svc._get_user = AsyncMock(
            return_value=None
        )  # second group: "no email" skip path

        await svc.process_pending_notifications()

        # The second group's record must have been refreshed before its
        # attributes were read again, since the first group's failure
        # rolled back (and therefore expired) the whole session.
        db.refresh.assert_awaited_once_with(rec_b)
        db.rollback.assert_awaited_once()


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))

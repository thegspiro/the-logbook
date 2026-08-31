"""
run_external_training_auto_sync iterates ExternalTrainingProvider rows, not
Organization rows, so it fell outside the original CRON-1 org-loop sweep and
(unlike its sibling multi-provider/multi-org loops elsewhere in this file)
had no rollback in its per-provider except at all.
ExternalTrainingSyncService.sync_training_records commits its own outcome
internally, so an exception reaching this loop's except means something
failed *before* that internal try even started (its own sync_log insert +
flush) — the shared session is left in a failed transaction state, and
without a rollback every later provider's own sync_log insert raises
PendingRollbackError too (same class as CRON-1/CRON2-31-13). DB mocked; no
MySQL, no network.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services import scheduled_tasks

pytestmark = [pytest.mark.asyncio]


def _provider(id_, name):
    return SimpleNamespace(id=id_, name=name, organization_id="org1")


class TestExternalTrainingAutoSyncIsolation:
    async def test_one_providers_failure_does_not_abort_the_run(self):
        providers = [_provider("p1", "Vector A"), _provider("p2", "Vector B")]
        result = MagicMock()
        result.scalars.return_value.all.return_value = providers

        db = MagicMock()
        db.execute = AsyncMock(return_value=result)
        db.rollback = AsyncMock()
        db.refresh = AsyncMock()

        async def _sync(provider, sync_type="incremental"):
            if provider.id == "p1":
                raise RuntimeError("boom before the internal try")

        service = SimpleNamespace(
            sync_training_records=AsyncMock(side_effect=_sync),
            close=AsyncMock(),
        )
        with patch(
            "app.services.external_training_service.ExternalTrainingSyncService",
            return_value=service,
        ):
            out = await scheduled_tasks.run_external_training_auto_sync(db)

        # p2 still synced despite p1 failing.
        assert out["synced"] == 1
        assert out["failed"] == 1
        # The failed provider's poisoned session was rolled back so it
        # could not cascade into the provider after it.
        assert db.rollback.await_count == 1
        # HTTP client is always closed, success or failure.
        assert service.close.await_count == 2
        # CRON-31-6 addendum (Codex-caught): the rollback above expires
        # every persistent object pre-fetched into `providers`, not just
        # p1 — p2 must be refreshed before sync_training_records reads its
        # attributes, or it raises MissingGreenlet the same way an unrefreshed
        # message/parent does elsewhere in this file (real-connection proof
        # in test_message_delivery_service.py's commit-failure test).
        db.refresh.assert_awaited_once_with(providers[1])


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))

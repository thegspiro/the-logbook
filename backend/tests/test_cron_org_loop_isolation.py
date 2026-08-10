"""
CRON-1 (pass 2): the per-org scheduled runners must commit each org's work and
roll back a failed org, so one org's failure can't poison the shared session for
the orgs still to come (nor discard their already-done work). This pins the fix
on run_officer_directory_sync, one of the inline loops the pass-1 CRON-1 sweep
missed. DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services import scheduled_tasks


def _db_with_orgs(org_ids):
    result = MagicMock()
    result.scalars.return_value.all.return_value = list(org_ids)
    db = MagicMock()
    db.execute = AsyncMock(return_value=result)
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    return db


class TestOfficerDirectorySyncIsolation:
    async def test_one_orgs_failure_does_not_abort_the_run(self):
        db = _db_with_orgs(["A", "B", "C"])

        async def _sync(org_id):
            if org_id == "B":
                raise RuntimeError("boom on B")

        service = SimpleNamespace(sync_directory=AsyncMock(side_effect=_sync))
        with patch("app.services.officer_service.OfficerService", return_value=service):
            out = await scheduled_tasks.run_officer_directory_sync(db)

        # A and C synced despite B failing.
        assert out["organizations"] == 2
        # Each successful org committed its own work; the failed org rolled back
        # so it could not poison the session for the org after it.
        assert db.commit.await_count == 2
        assert db.rollback.await_count == 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))

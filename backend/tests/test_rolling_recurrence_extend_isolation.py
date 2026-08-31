"""
run_rolling_recurrence_extend iterates Event parents, not Organization rows,
so it falls outside every existing "select(Organization)" structural
org-loop check (test_scheduled_tasks_structure.py's
test_org_loops_roll_back_on_failure), and had a single trailing commit
deferring every parent's writes together instead of committing per parent.
That is the "worst" shape CRON2-31-1 found in run_shift_auto_checkout: a
later parent's failure discarded every earlier parent's already-generated
occurrences and recurrence_end_date update, on the eventual rollback. Fixed
to commit per parent and roll back a failed one, mirroring every other loop
in this file. DB mocked; no MySQL.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services import scheduled_tasks

pytestmark = [pytest.mark.asyncio]


def _parent(id_, pattern="weekly"):
    return SimpleNamespace(
        id=id_,
        organization_id="org1",
        created_by="creator",
        recurrence_pattern=SimpleNamespace(value=pattern),
        recurrence_custom_days=None,
        recurrence_weekday=None,
        recurrence_week_ordinal=None,
        recurrence_month=None,
        recurrence_exceptions=None,
        recurrence_end_date=None,
        custom_fields=None,
    )


class TestRollingRecurrenceExtendIsolation:
    async def test_one_parents_failure_does_not_lose_an_earlier_parents_commit(self):
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        latest_start = now + timedelta(days=1)
        latest_end = latest_start + timedelta(hours=2)

        parents = [_parent("A"), _parent("B"), _parent("C")]

        parents_result = MagicMock()
        parents_result.scalars.return_value.all.return_value = parents

        def _latest_result():
            r = MagicMock()
            r.first.return_value = (latest_start, latest_end)
            return r

        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                parents_result,
                _latest_result(),
                _latest_result(),
                _latest_result(),
            ]
        )
        db.add = MagicMock()
        db.commit = AsyncMock()
        db.rollback = AsyncMock()
        db.refresh = AsyncMock()

        call_count = {"n": 0}

        def _generate(**kwargs):
            call_count["n"] += 1
            if call_count["n"] == 2:  # parent B, the second one processed
                raise RuntimeError("boom on B")
            return [(latest_start + timedelta(days=7), latest_end + timedelta(days=7))]

        service = SimpleNamespace(_generate_recurrence_dates=_generate)
        with patch("app.services.event_service.EventService", return_value=service):
            result = await scheduled_tasks.run_rolling_recurrence_extend(db)

        # A and C extended despite B failing.
        assert result["series_extended"] == 2
        assert result["errors"] == [{"event_id": "B", "error": "boom on B"}]
        # Each successful parent committed its own work; the failed parent
        # rolled back so it could not poison the session for the parent
        # after it, and so its failure could not discard A's already-built
        # occurrences on a shared, still-pending transaction.
        assert db.commit.await_count == 2
        assert db.rollback.await_count == 1

    async def test_a_commit_failure_does_not_inflate_counts_or_crash_the_next_parent(
        self,
    ):
        """CRON-31-4/5 addendum (Codex-caught): the test above only exercises
        a failure in `_generate_recurrence_dates`, which happens *before*
        `total_created`/`series_extended` are touched and before
        `db.commit()` — it can't distinguish counting on success from
        counting unconditionally. This forces the failure at db.commit()
        itself, after the pre-fix code would already have incremented both
        counters, and checks two things the pre-fix code got wrong: (1) a
        failed parent's counts must not survive its own rollback, and
        (2) the parent processed right after it must be refreshed before
        its own attributes are read (a rollback expires every object
        pre-fetched into `parents`, not just the one that failed — see
        `test_a_commit_failure_on_one_message_does_not_abort_the_batch` in
        test_message_delivery_service.py for the real-connection proof that
        skipping this raises PendingRollbackError, not just MissingGreenlet,
        if it happens before the object is even touched again)."""
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        latest_start = now + timedelta(days=1)
        latest_end = latest_start + timedelta(hours=2)

        parents = [_parent("A"), _parent("B"), _parent("C")]

        parents_result = MagicMock()
        parents_result.scalars.return_value.all.return_value = parents

        def _latest_result():
            r = MagicMock()
            r.first.return_value = (latest_start, latest_end)
            return r

        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                parents_result,
                _latest_result(),
                _latest_result(),
                _latest_result(),
            ]
        )
        db.add = MagicMock()
        db.commit = AsyncMock(side_effect=[None, RuntimeError("boom on B"), None])
        db.rollback = AsyncMock()
        db.refresh = AsyncMock()

        service = SimpleNamespace(
            _generate_recurrence_dates=lambda **kwargs: [
                (latest_start + timedelta(days=7), latest_end + timedelta(days=7))
            ]
        )
        with patch("app.services.event_service.EventService", return_value=service):
            result = await scheduled_tasks.run_rolling_recurrence_extend(db)

        # A and C extended and counted; B's commit failed, so neither of its
        # counts (1 series, 1 occurrence) may appear in the totals.
        assert result["series_extended"] == 2
        assert result["total_created"] == 2
        assert result["errors"] == [{"event_id": "B", "error": "boom on B"}]
        # B's own id is still resolvable in the error (captured before the
        # failing commit, not read from a session already poisoned by it).
        # C, fetched in the same original batch as B, must be refreshed
        # before its own attributes are read again.
        db.refresh.assert_awaited_once_with(parents[2])


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))

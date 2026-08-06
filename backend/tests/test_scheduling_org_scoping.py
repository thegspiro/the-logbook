"""
Focused org-scoping tests for the scheduling service (SCH-6).

A client-supplied apparatus_id on a shift, and a manual-hours user_id at
finalization, must belong to the caller's org — otherwise a shift carries a
foreign apparatus reference or a foreign member is credited hours on this org's
shift. DB mocked; no MySQL.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.services.scheduling_service import SchedulingService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _all(items):
    r = MagicMock()
    r.all.return_value = items
    return r


class TestCreateShiftApparatusScoping:
    async def test_rejects_foreign_apparatus(self):
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_one(None)])  # is_in_org -> not found
        db.add = MagicMock()
        svc = SchedulingService(db)
        shift, err = await svc.create_shift("org-1", {"apparatus_id": "aFOREIGN"}, "u1")
        assert shift is None
        assert err == "Apparatus not found"
        db.add.assert_not_called()


class TestFinalizeManualHoursScoping:
    async def test_rejects_foreign_manual_hours_user(self):
        now = datetime.now(timezone.utc)
        shift = SimpleNamespace(
            id="s1",
            organization_id="org-1",
            is_finalized=False,
            end_time=now - timedelta(hours=1),  # ended
            start_time=now - timedelta(hours=9),
            settings=None,
        )
        org = SimpleNamespace(id="org-1", settings={})  # no end-of-shift checks
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _one(shift),  # get_shift_by_id
                _one(org),  # Organization settings lookup
                _all([]),  # existing attendance user_ids
                _one(None),  # _user_in_org -> foreign
            ]
        )
        db.add = MagicMock()
        db.flush = AsyncMock()
        svc = SchedulingService(db)
        result, err = await svc.finalize_shift(
            "s1",
            "org-1",
            finalized_by_user_id="officer-1",
            manual_hours=[{"user_id": "uFOREIGN", "hours": 8}],
        )
        assert result is None
        assert err == "One or more members are not in your organization"
        db.add.assert_not_called()

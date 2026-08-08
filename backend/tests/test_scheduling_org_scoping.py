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


def _scalars_first(obj):
    """Mock a result whose ``.scalars().first()`` yields ``obj``.

    ``apparatus_ref_exists`` queries both apparatus tables in turn, so a
    rejection needs two misses and an acceptance needs a hit in one of them.
    """
    r = MagicMock()
    r.scalars.return_value.first.return_value = obj
    return r


class TestCreateShiftApparatusScoping:
    async def test_rejects_foreign_apparatus(self):
        """Neither apparatus table has it, so it is rejected before any write."""
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _scalars_first(None),  # not a full Apparatus in this org
                _scalars_first(None),  # not a BasicApparatus in this org either
            ]
        )
        db.add = MagicMock()
        svc = SchedulingService(db)
        shift, err = await svc.create_shift("org-1", {"apparatus_id": "aFOREIGN"}, "u1")
        assert shift is None
        assert err == "Apparatus not found"
        db.add.assert_not_called()

    async def test_accepts_a_basic_apparatus_id(self):
        """The onboarding-only case: a shift's apparatus is a BasicApparatus."""
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _scalars_first(None),  # not a full Apparatus
                _scalars_first(SimpleNamespace(id="basic-1")),  # but a BasicApparatus
            ]
        )
        db.add = MagicMock()
        db.flush = AsyncMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        svc = SchedulingService(db)

        shift, err = await svc.create_shift("org-1", {"apparatus_id": "basic-1"}, "u1")

        assert err is None
        assert shift is not None
        db.add.assert_called_once()

    async def test_accepts_a_full_apparatus_id(self):
        """Regression: this used to fail with "Apparatus not found".

        ``GET /scheduling/apparatus-options`` serves full ``Apparatus`` ids
        whenever that module has records, but the validator checked
        ``BasicApparatus`` only — so a department on the Apparatus module could
        not assign an apparatus to a shift at all. It rejected the very ids it
        had just offered.
        """
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[_scalars_first(SimpleNamespace(id="app-1"))]
        )
        db.add = MagicMock()
        db.flush = AsyncMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        svc = SchedulingService(db)

        shift, err = await svc.create_shift("org-1", {"apparatus_id": "app-1"}, "u1")

        assert err is None
        assert shift is not None
        db.add.assert_called_once()


class TestUpdateShiftApparatusScoping:
    async def test_rejects_foreign_apparatus_on_update(self):
        """The update path carries the same guard as create."""
        existing = SimpleNamespace(
            id="s1",
            organization_id="org-1",
            shift_officer_id=None,
            is_finalized=False,
        )
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _one(existing),  # get_shift_by_id
                _scalars_first(None),  # not a full Apparatus
                _scalars_first(None),  # not a BasicApparatus
            ]
        )
        svc = SchedulingService(db)

        shift, err = await svc.update_shift("s1", "org-1", {"apparatus_id": "aFOREIGN"})

        assert shift is None
        assert err == "Apparatus not found"


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

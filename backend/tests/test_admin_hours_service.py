"""
Tests for the admin hours service (app/services/admin_hours_service.py).

This is a timeclock: QR clock-in/clock-out with duration math and an
approval policy. Covers _determine_post_clockout_status (the approve/pend
decision), clock_in guards (category missing/inactive, already-clocked-in,
busy-elsewhere), clock_out duration + status stamping, and create_manual_entry
validation (ordering, no future, minimum duration, overlap). DB mocked.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.admin_hours import AdminHoursEntryStatus
from app.services.admin_hours_service import AdminHoursService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _db(side_effect):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=side_effect)
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    return db


def _category(
    is_active=True, require_approval=False, auto_approve_under_hours=None, **kw
):
    return SimpleNamespace(
        id=kw.get("id", "cat-1"),
        organization_id="org-1",
        name="Station Duty",
        is_active=is_active,
        require_approval=require_approval,
        auto_approve_under_hours=auto_approve_under_hours,
        max_hours_per_session=kw.get("max_hours_per_session"),
    )


def _active_entry(category_id="cat-1", minutes_ago=90):
    return SimpleNamespace(
        id="entry-1",
        organization_id="org-1",
        user_id="u1",
        category_id=category_id,
        clock_in_at=datetime.now(timezone.utc) - timedelta(minutes=minutes_ago),
        clock_out_at=None,
        duration_minutes=None,
        status=AdminHoursEntryStatus.ACTIVE,
    )


class TestPostClockoutStatus:
    def test_no_category_is_approved(self):
        s = AdminHoursService._determine_post_clockout_status(None, 120)
        assert s == AdminHoursEntryStatus.APPROVED

    def test_no_approval_required_is_approved(self):
        cat = _category(require_approval=False)
        assert (
            AdminHoursService._determine_post_clockout_status(cat, 600)
            == AdminHoursEntryStatus.APPROVED
        )

    def test_auto_approves_under_threshold(self):
        cat = _category(require_approval=True, auto_approve_under_hours=2)
        # 90 min = 1.5h < 2h -> approved
        assert (
            AdminHoursService._determine_post_clockout_status(cat, 90)
            == AdminHoursEntryStatus.APPROVED
        )

    def test_pends_at_or_over_threshold(self):
        cat = _category(require_approval=True, auto_approve_under_hours=2)
        # 150 min = 2.5h >= 2h -> pending
        assert (
            AdminHoursService._determine_post_clockout_status(cat, 150)
            == AdminHoursEntryStatus.PENDING
        )

    def test_pends_when_no_auto_threshold(self):
        cat = _category(require_approval=True, auto_approve_under_hours=None)
        assert (
            AdminHoursService._determine_post_clockout_status(cat, 30)
            == AdminHoursEntryStatus.PENDING
        )


class TestClockIn:
    async def test_category_not_found(self):
        with pytest.raises(ValueError, match="Category not found"):
            await AdminHoursService(_db([_one(None)])).clock_in("cat-1", "u1", "org-1")

    async def test_inactive_category(self):
        with pytest.raises(ValueError, match="no longer active"):
            await AdminHoursService(_db([_one(_category(is_active=False))])).clock_in(
                "cat-1", "u1", "org-1"
            )

    async def test_already_clocked_in_same_category(self):
        db = _db([_one(_category()), _one(_active_entry(category_id="cat-1"))])
        with pytest.raises(ValueError, match="ALREADY_CLOCKED_IN"):
            await AdminHoursService(db).clock_in("cat-1", "u1", "org-1")

    async def test_busy_in_other_category(self):
        db = _db([_one(_category()), _one(_active_entry(category_id="other"))])
        with pytest.raises(ValueError, match="already have an active session"):
            await AdminHoursService(db).clock_in("cat-1", "u1", "org-1")

    async def test_clock_in_success(self):
        db = _db([_one(_category()), _one(None)])  # no active session
        entry = await AdminHoursService(db).clock_in("cat-1", "u1", "org-1")
        assert entry.category_id == "cat-1"
        assert entry.status == AdminHoursEntryStatus.ACTIVE
        db.add.assert_called_once()


class TestClockOut:
    async def test_no_active_session(self):
        with pytest.raises(ValueError, match="No active session"):
            await AdminHoursService(_db([_one(None)])).clock_out("entry-1", "u1")

    async def test_stamps_duration_and_status(self):
        entry = _active_entry(minutes_ago=90)
        # clock_out lookup -> entry, then get_category -> category
        db = _db([_one(entry), _one(_category(require_approval=False))])
        out = await AdminHoursService(db).clock_out("entry-1", "u1")
        assert out.clock_out_at is not None
        assert out.duration_minutes == 90
        assert out.status == AdminHoursEntryStatus.APPROVED


class TestCreateManualEntry:
    def _svc(self, category, overlap=None):
        svc = AdminHoursService(_db([_one(category)]))
        svc._check_overlap = AsyncMock(return_value=overlap)
        return svc

    async def test_clock_out_not_after_clock_in(self):
        now = datetime.now(timezone.utc)
        svc = self._svc(_category())
        with pytest.raises(ValueError, match="must be after"):
            await svc.create_manual_entry(
                "org-1",
                "u1",
                "cat-1",
                now - timedelta(hours=1),
                now - timedelta(hours=2),
            )

    async def test_future_clock_in_rejected(self):
        now = datetime.now(timezone.utc)
        svc = self._svc(_category())
        with pytest.raises(ValueError, match="future"):
            await svc.create_manual_entry(
                "org-1",
                "u1",
                "cat-1",
                now + timedelta(hours=1),
                now + timedelta(hours=2),
            )

    async def test_minimum_duration(self):
        now = datetime.now(timezone.utc)
        svc = self._svc(_category())
        with pytest.raises(ValueError, match="at least 1 minute"):
            await svc.create_manual_entry(
                "org-1",
                "u1",
                "cat-1",
                now - timedelta(minutes=10),
                now - timedelta(minutes=10, seconds=-30),  # 30s span
            )

    async def test_overlap_rejected(self):
        now = datetime.now(timezone.utc)
        svc = self._svc(_category(), overlap=SimpleNamespace(id="existing"))
        with pytest.raises(ValueError, match="overlaps"):
            await svc.create_manual_entry(
                "org-1",
                "u1",
                "cat-1",
                now - timedelta(hours=2),
                now - timedelta(hours=1),
            )

    async def test_success_computes_duration(self):
        now = datetime.now(timezone.utc)
        svc = self._svc(_category(require_approval=False), overlap=None)
        entry = await svc.create_manual_entry(
            "org-1", "u1", "cat-1", now - timedelta(hours=2), now - timedelta(hours=1)
        )
        assert entry.duration_minutes == 60
        assert entry.status == AdminHoursEntryStatus.APPROVED


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))

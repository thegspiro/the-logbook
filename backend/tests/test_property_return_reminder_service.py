"""
Tests for the property return reminder service
(app/services/property_return_reminder_service.py).

Covers the timezone helper, outstanding-item gathering (count + value from
assignments and checkouts), and the reminder orchestration: threshold
firing (30/90 day), per-type dedup, the no-items skip, and the overdue
listing. The email/send machinery is patched out. DB mocked; no MySQL.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from zoneinfo import ZoneInfo

from app.models.user import UserStatus
from app.services.property_return_reminder_service import PropertyReturnReminderService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


def _db(side_effect):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=side_effect)
    db.add = MagicMock()
    db.commit = AsyncMock()
    return db


def _member(days_ago=95, status=UserStatus.DROPPED_VOLUNTARY):
    return SimpleNamespace(
        id="u1",
        full_name="Jane Smith",
        email="jane@x.org",
        status=status,
        status_changed_at=datetime.now(timezone.utc) - timedelta(days=days_ago),
    )


def _org():
    return SimpleNamespace(id="org-1", name="FCFD", timezone="America/New_York")


def _item(name="Helmet", value=100.0):
    return SimpleNamespace(
        name=name,
        serial_number="SN1",
        asset_tag="AT1",
        current_value=value,
        purchase_price=None,
    )


class TestToLocal:
    def test_naive_treated_as_utc(self):
        dt = datetime(2026, 6, 1, 12, 0, 0)  # naive
        out = PropertyReturnReminderService._to_local(dt, "America/New_York")
        assert out.tzinfo == ZoneInfo("America/New_York")
        # noon UTC -> 08:00 EDT in June
        assert out.hour == 8

    def test_aware_converted(self):
        dt = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        out = PropertyReturnReminderService._to_local(dt, "America/New_York")
        assert out.hour == 7  # EST in January


class TestOutstandingItems:
    async def test_counts_and_sums_assignments_and_checkouts(self):
        assignment = SimpleNamespace(item=_item("Helmet", 100.0))
        checkout = SimpleNamespace(item=_item("Radio", 250.0))
        db = _db([_scalars([assignment]), _scalars([checkout])])
        out = await PropertyReturnReminderService(db)._get_outstanding_items(
            "u1", "org-1"
        )
        assert out["count"] == 2
        assert out["total_value"] == 350.0
        assert {i["type"] for i in out["items"]} == {"assigned", "checked_out"}

    async def test_empty_when_nothing_outstanding(self):
        db = _db([_scalars([]), _scalars([])])
        out = await PropertyReturnReminderService(db)._get_outstanding_items(
            "u1", "org-1"
        )
        assert out == {"count": 0, "total_value": 0.0, "items": []}


class TestProcessReminders:
    def _svc(self, db, monkeypatch, items_count=2, send=None):
        svc = PropertyReturnReminderService(db)
        monkeypatch.setattr(
            svc,
            "_get_outstanding_items",
            AsyncMock(
                return_value={
                    "count": items_count,
                    "total_value": 350.0,
                    "items": [],
                }
            ),
        )
        monkeypatch.setattr(
            svc,
            "_send_reminder",
            AsyncMock(return_value=(send or {"reminder_type": "x"})),
        )
        return svc

    async def test_fires_both_thresholds_for_old_drop(self, monkeypatch):
        # 95 days out, neither reminder sent -> both 30 and 90 fire.
        db = _db(
            [
                _scalars([_member(days_ago=95)]),
                _one(_org()),
                _one(None),  # existing 30-day -> none
                _one(None),  # existing 90-day -> none
            ]
        )
        svc = self._svc(db, monkeypatch)
        out = await svc.process_reminders("org-1")
        assert out["reminders_sent"] == 2
        assert svc._send_reminder.await_count == 2

    async def test_skips_when_below_threshold(self, monkeypatch):
        db = _db([_scalars([_member(days_ago=10)]), _one(_org())])
        svc = self._svc(db, monkeypatch)
        out = await svc.process_reminders("org-1")
        assert out["reminders_sent"] == 0
        svc._send_reminder.assert_not_awaited()

    async def test_skips_already_sent(self, monkeypatch):
        # 45 days out: 30-day already sent, 90 not yet due.
        db = _db(
            [
                _scalars([_member(days_ago=45)]),
                _one(_org()),
                _one(SimpleNamespace(id="r1")),  # existing 30-day -> sent
            ]
        )
        svc = self._svc(db, monkeypatch)
        out = await svc.process_reminders("org-1")
        assert out["reminders_sent"] == 0

    async def test_skips_when_no_items(self, monkeypatch):
        db = _db(
            [
                _scalars([_member(days_ago=45)]),
                _one(_org()),
                _one(None),  # existing 30-day -> none
            ]
        )
        svc = self._svc(db, monkeypatch, items_count=0)
        out = await svc.process_reminders("org-1")
        assert out["reminders_sent"] == 0
        svc._send_reminder.assert_not_awaited()


class TestOverdueReturns:
    async def test_lists_members_with_items(self, monkeypatch):
        member = _member(days_ago=40)
        db = _db(
            [
                _one(_org()),  # org/timezone
                _scalars([member]),  # dropped members
                _scalars([SimpleNamespace(reminder_type="30_day")]),  # sent reminders
            ]
        )
        svc = PropertyReturnReminderService(db)
        monkeypatch.setattr(
            svc,
            "_get_outstanding_items",
            AsyncMock(
                return_value={
                    "count": 1,
                    "total_value": 100.0,
                    "items": [{"name": "X"}],
                }
            ),
        )
        out = await svc.get_overdue_returns("org-1")
        assert len(out) == 1
        row = out[0]
        assert row["items_outstanding"] == 1
        assert row["days_since_drop"] == 40
        assert row["reminders_sent"] == ["30_day"]

    async def test_skips_members_without_items(self, monkeypatch):
        db = _db([_one(_org()), _scalars([_member(days_ago=40)])])
        svc = PropertyReturnReminderService(db)
        monkeypatch.setattr(
            svc,
            "_get_outstanding_items",
            AsyncMock(return_value={"count": 0, "total_value": 0.0, "items": []}),
        )
        assert await svc.get_overdue_returns("org-1") == []


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))

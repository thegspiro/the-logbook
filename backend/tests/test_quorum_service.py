"""
Tests for the quorum service (app/services/quorum_service.py).

Covers config resolution (per-meeting override vs org default vs disabled),
count- and percentage-based quorum, and the ceil-rounding rule for percentage
thresholds — a threshold is a floor that must be met or exceeded, so the
required head-count rounds UP, never to nearest (a supermajority must not pass
below its threshold). DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.quorum_service import QuorumService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _scalar(value):
    return MagicMock(scalar=MagicMock(return_value=value))


def _minutes(**kw):
    return SimpleNamespace(
        id=kw.get("id", "min-1"),
        organization_id=kw.get("organization_id", "org-1"),
        quorum_type=kw.get("quorum_type"),
        quorum_threshold=kw.get("quorum_threshold"),
        attendees=kw.get("attendees", []),
        quorum_met=None,
        quorum_count=None,
    )


def _attendees(present, absent=0):
    return [{"present": True}] * present + [{"present": False}] * absent


def _db(side_effect):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=side_effect)
    db.commit = AsyncMock()
    return db


class TestConfigResolution:
    async def test_meeting_not_found(self):
        db = _db([_one(None)])
        out = await QuorumService(db).calculate_quorum("min-x", "org-1")
        assert out == (False, 0, 0, "Meeting not found")
        db.commit.assert_not_awaited()

    async def test_quorum_disabled_passes_through(self):
        # No per-meeting override and org config disabled -> always "met".
        minutes = _minutes(attendees=_attendees(0))
        org = SimpleNamespace(settings={"quorum_config": {"enabled": False}})
        out = await QuorumService(_db([_one(minutes), _one(org)])).calculate_quorum(
            "min-1", "org-1"
        )
        assert out == (True, 0, 0, "Quorum checking not enabled")

    async def test_missing_org_returns_disabled(self):
        minutes = _minutes(attendees=_attendees(3))
        out = await QuorumService(_db([_one(minutes), _one(None)])).calculate_quorum(
            "min-1", "org-1"
        )
        assert out[0] is True
        assert out[3] == "Quorum checking not enabled"


class TestCountQuorum:
    async def test_count_override_met(self):
        minutes = _minutes(
            quorum_type="count", quorum_threshold=5, attendees=_attendees(5)
        )
        db = _db([_one(minutes)])
        met, present, required, _ = await QuorumService(db).calculate_quorum(
            "min-1", "org-1"
        )
        assert (met, present, required) == (True, 5, 5)
        assert minutes.quorum_met is True
        assert minutes.quorum_count == 5
        db.commit.assert_awaited()

    async def test_count_override_not_met(self):
        minutes = _minutes(
            quorum_type="count", quorum_threshold=8, attendees=_attendees(5, absent=2)
        )
        met, present, required, _ = await QuorumService(
            _db([_one(minutes)])
        ).calculate_quorum("min-1", "org-1")
        assert (met, present, required) == (False, 5, 8)


class TestPercentageQuorum:
    def _db_for_percent(self, minutes, active):
        # Per-meeting percentage override: minutes lookup, then active count.
        return _db([_one(minutes), _scalar(active)])

    async def test_simple_majority_even(self):
        # 50% of 10 = 5.0 exactly -> required 5 (epsilon must not push to 6).
        minutes = _minutes(
            quorum_type="percentage", quorum_threshold=50.0, attendees=_attendees(5)
        )
        met, present, required, _ = await QuorumService(
            self._db_for_percent(minutes, 10)
        ).calculate_quorum("min-1", "org-1")
        assert (met, present, required) == (True, 5, 5)

    async def test_supermajority_rounds_up_not_nearest(self):
        # 67% of 9 = 6.03 -> required 7 (ceil), NOT 6 (round). 6/9 = 66.7% < 67%.
        minutes = _minutes(
            quorum_type="percentage",
            quorum_threshold=67.0,
            attendees=_attendees(6, absent=3),
        )
        met, present, required, _ = await QuorumService(
            self._db_for_percent(minutes, 9)
        ).calculate_quorum("min-1", "org-1")
        assert required == 7
        assert met is False

    async def test_small_fraction_rounds_up(self):
        # 21% of 10 = 2.1 -> required 3, not 2 (2 would be only 20%).
        minutes = _minutes(
            quorum_type="percentage", quorum_threshold=21.0, attendees=_attendees(2)
        )
        _, _, required, _ = await QuorumService(
            self._db_for_percent(minutes, 10)
        ).calculate_quorum("min-1", "org-1")
        assert required == 3

    async def test_required_is_at_least_one(self):
        # Tiny percentage of a small body still requires a present body.
        minutes = _minutes(
            quorum_type="percentage", quorum_threshold=1.0, attendees=_attendees(1)
        )
        _, _, required, _ = await QuorumService(
            self._db_for_percent(minutes, 1)
        ).calculate_quorum("min-1", "org-1")
        assert required == 1

    async def test_percentage_from_org_default(self):
        # No per-meeting override -> org default config drives it.
        minutes = _minutes(attendees=_attendees(6))
        org = SimpleNamespace(
            settings={
                "quorum_config": {
                    "enabled": True,
                    "type": "percentage",
                    "threshold": 50.0,
                }
            }
        )
        db = _db([_one(minutes), _one(org), _scalar(10)])
        met, present, required, _ = await QuorumService(db).calculate_quorum(
            "min-1", "org-1"
        )
        assert (met, present, required) == (True, 6, 5)


class TestUpdateOnCheckin:
    async def test_returns_status_dict(self):
        minutes = _minutes(
            quorum_type="count", quorum_threshold=3, attendees=_attendees(4)
        )
        out = await QuorumService(_db([_one(minutes)])).update_quorum_on_checkin(
            "min-1", "org-1"
        )
        assert out == {
            "quorum_met": True,
            "present_count": 4,
            "required_count": 3,
            "description": "3 members required",
        }


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))

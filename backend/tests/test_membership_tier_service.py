"""
Tests for the membership tier service
(app/services/membership_tier_service.py).

Covers the pure tier-resolution helpers (years of service, highest-qualifying
tier, tier lookup, settings loading) and the meeting-attendance percentage —
including the permanent-leave (end_date NULL) regression that previously
raised TypeError and broke voting-eligibility checks. DB mocked; no MySQL.
"""

from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.services.membership_tier_service import MembershipTierService

TIERS = [
    {"id": "probationary", "years_required": 0, "sort_order": 0},
    {"id": "active", "years_required": 1, "sort_order": 1},
    {"id": "senior", "years_required": 10, "sort_order": 2},
    {"id": "life", "years_required": 20, "sort_order": 3},
]


class TestYearsOfService:
    def test_no_hire_date(self):
        assert MembershipTierService.years_of_service(None) == 0

    def test_exact_anniversary_counts(self):
        ten_years_ago = date.today().replace(year=date.today().year - 10)
        assert MembershipTierService.years_of_service(ten_years_ago) == 10

    def test_day_before_anniversary_does_not_count(self):
        almost = date.today().replace(year=date.today().year - 10) + timedelta(days=1)
        assert MembershipTierService.years_of_service(almost) == 9


class TestResolveTier:
    def _svc(self):
        return MembershipTierService(MagicMock())

    def test_returns_highest_qualifying_tier(self):
        assert self._svc().resolve_tier(TIERS, 12)["id"] == "senior"
        assert self._svc().resolve_tier(TIERS, 25)["id"] == "life"
        assert self._svc().resolve_tier(TIERS, 0)["id"] == "probationary"

    def test_no_tiers(self):
        assert self._svc().resolve_tier([], 5) is None

    def test_get_tier_by_id(self):
        assert self._svc().get_tier_by_id(TIERS, "senior")["years_required"] == 10
        assert self._svc().get_tier_by_id(TIERS, "missing") is None

    def test_load_tiers_sorts_by_sort_order(self):
        org = SimpleNamespace(
            settings={
                "membership_tiers": {
                    "tiers": [
                        {"id": "b", "sort_order": 2},
                        {"id": "a", "sort_order": 1},
                    ]
                }
            }
        )
        tiers = MembershipTierService._load_tiers(org)
        assert [t["id"] for t in tiers] == ["a", "b"]

    def test_load_tiers_handles_missing_settings(self):
        assert MembershipTierService._load_tiers(SimpleNamespace(settings=None)) == []


class TestMeetingAttendancePct:
    def _scalar(self, value):
        return MagicMock(scalar=MagicMock(return_value=value))

    def _scalars(self, items):
        r = MagicMock()
        r.scalars.return_value.all.return_value = items
        return r

    def _rows(self, rows):
        return MagicMock(all=MagicMock(return_value=rows))

    async def test_no_meetings_returns_100(self):
        db = MagicMock()
        db.execute = AsyncMock(return_value=self._scalar(0))
        pct = await MembershipTierService(db).get_meeting_attendance_pct("u", "o")
        assert pct == 100.0

    async def test_simple_percentage(self):
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                self._scalar(4),  # total meetings
                self._scalar(0),  # waived
                self._scalars([]),  # no leaves
                self._scalar(3),  # attended
            ]
        )
        pct = await MembershipTierService(db).get_meeting_attendance_pct("u", "o")
        assert pct == 75.0

    async def test_permanent_leave_excludes_meetings_not_crashes(self):
        # Regression: a permanent leave (end_date=None) previously raised
        # TypeError (date <= None) and broke eligibility checks.
        leave = SimpleNamespace(start_date=date(2026, 5, 1), end_date=None)
        meeting_dates = [(date(2026, 6, 1),), (date(2026, 4, 1),)]
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                self._scalar(2),  # total meetings
                self._scalar(0),  # waived
                self._scalars([leave]),
                self._rows(meeting_dates),
                self._scalar(1),  # attended the April meeting
            ]
        )
        pct = await MembershipTierService(db).get_meeting_attendance_pct("u", "o")
        # The June meeting falls inside the open-ended leave: 1 eligible, 1 attended.
        assert pct == 100.0

    async def test_all_meetings_on_leave_returns_100(self):
        leave = SimpleNamespace(start_date=date(2026, 1, 1), end_date=None)
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                self._scalar(2),
                self._scalar(0),
                self._scalars([leave]),
                self._rows([(date(2026, 2, 1),), (date(2026, 3, 1),)]),
            ]
        )
        pct = await MembershipTierService(db).get_meeting_attendance_pct("u", "o")
        assert pct == 100.0

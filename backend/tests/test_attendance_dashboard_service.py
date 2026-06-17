"""
Tests for the attendance dashboard service
(app/services/attendance_dashboard_service.py).

Covers the per-member attendance math (attended / waived / on-leave /
eligible / percentage), the permanent-leave (end_date=None) regression that
previously raised TypeError and crashed the whole dashboard, tier-driven
voting eligibility, and the waiver grant/list paths. DB mocked; no MySQL.
"""

from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.services.attendance_dashboard_service import AttendanceDashboardService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


def _org(tiers=None):
    settings = {"membership_tiers": {"tiers": tiers or []}}
    return SimpleNamespace(id="org-1", settings=settings)


def _member(uid="u1", membership_type="active"):
    return SimpleNamespace(
        id=uid,
        full_name="Jane Smith",
        membership_type=membership_type,
        hire_date=None,
        last_name="Smith",
        first_name="Jane",
    )


def _meeting(mid, d, mtype="business"):
    return SimpleNamespace(
        id=mid, meeting_date=d, meeting_type=mtype, organization_id="org-1"
    )


def _att(uid, mid, present=False, waiver_reason=None):
    return SimpleNamespace(
        id=f"att-{uid}-{mid}",
        user_id=uid,
        meeting_id=mid,
        present=present,
        waiver_reason=waiver_reason,
    )


def _leave(uid, start, end):
    return SimpleNamespace(user_id=uid, start_date=start, end_date=end)


def _dash_db(org, members, meetings, attendance, leaves):
    # Mirrors get_dashboard's execute order: org, members, meetings,
    # attendance (only if meetings), leaves.
    seq = [_one(org), _scalars(members), _scalars(meetings)]
    if meetings:
        seq.append(_scalars(attendance))
    seq.append(_scalars(leaves))
    db = MagicMock()
    db.execute = AsyncMock(side_effect=seq)
    return db


class TestDashboardMath:
    async def test_basic_percentage_and_counts(self):
        meetings = [_meeting("m1", date(2026, 1, 1)), _meeting("m2", date(2026, 2, 1))]
        attendance = [_att("u1", "m1", present=True), _att("u1", "m2", present=False)]
        db = _dash_db(_org(), [_member()], meetings, attendance, [])
        out = await AttendanceDashboardService(db).get_dashboard("org-1")
        row = out["members"][0]
        assert row["total_meetings"] == 2
        assert row["meetings_attended"] == 1
        assert row["eligible_meetings"] == 2
        assert row["attendance_pct"] == 50.0
        assert row["meetings_absent"] == 1

    async def test_waiver_excluded_from_denominator(self):
        meetings = [_meeting("m1", date(2026, 1, 1)), _meeting("m2", date(2026, 2, 1))]
        attendance = [
            _att("u1", "m1", present=True),
            _att("u1", "m2", waiver_reason="sick"),
        ]
        db = _dash_db(_org(), [_member()], meetings, attendance, [])
        row = (await AttendanceDashboardService(db).get_dashboard("org-1"))["members"][
            0
        ]
        assert row["meetings_waived"] == 1
        assert row["eligible_meetings"] == 1
        assert row["attendance_pct"] == 100.0

    async def test_no_meetings_defaults_to_100(self):
        db = _dash_db(_org(), [_member()], [], [], [])
        row = (await AttendanceDashboardService(db).get_dashboard("org-1"))["members"][
            0
        ]
        assert row["attendance_pct"] == 100.0
        assert row["total_meetings"] == 0

    async def test_waived_and_on_leave_meeting_excluded_only_once(self):
        # m1 is both waived AND inside the leave. Subtracting waived and
        # on-leave separately removed it twice, shrinking the denominator and
        # inflating the percentage (the old code returned 100.0 here, not 50.0).
        meetings = [
            _meeting("m1", date(2026, 6, 1)),
            _meeting("m2", date(2026, 7, 1)),
            _meeting("m3", date(2026, 8, 1)),
        ]
        attendance = [
            _att("u1", "m1", waiver_reason="sick"),
            _att("u1", "m2", present=True),
        ]
        leaves = [_leave("u1", date(2026, 6, 1), date(2026, 6, 30))]  # covers m1
        db = _dash_db(_org(), [_member()], meetings, attendance, leaves)
        row = (await AttendanceDashboardService(db).get_dashboard("org-1"))["members"][
            0
        ]
        # excluded = {m1}; eligible = {m2, m3}; attended within eligible = {m2}.
        assert row["eligible_meetings"] == 2
        assert row["attendance_pct"] == 50.0

    async def test_attendance_during_leave_cannot_exceed_100(self):
        # Present at a meeting that fell during the leave must not count in the
        # numerator while it is excluded from the denominator (old code: 200%).
        meetings = [_meeting("m1", date(2026, 6, 1)), _meeting("m2", date(2026, 7, 1))]
        attendance = [
            _att("u1", "m1", present=True),
            _att("u1", "m2", present=True),
        ]
        leaves = [_leave("u1", date(2026, 6, 1), date(2026, 6, 30))]  # covers m1
        db = _dash_db(_org(), [_member()], meetings, attendance, leaves)
        row = (await AttendanceDashboardService(db).get_dashboard("org-1"))["members"][
            0
        ]
        assert row["eligible_meetings"] == 1
        assert row["attendance_pct"] == 100.0


class TestLeaveOfAbsence:
    async def test_permanent_leave_does_not_crash(self):
        # Regression: end_date=None previously raised TypeError (date <= None).
        meetings = [_meeting("m1", date(2026, 6, 1)), _meeting("m2", date(2026, 1, 1))]
        leaves = [_leave("u1", date(2026, 5, 1), None)]  # open-ended
        db = _dash_db(_org(), [_member()], meetings, [], leaves)
        row = (await AttendanceDashboardService(db).get_dashboard("org-1"))["members"][
            0
        ]
        # June meeting falls inside the open-ended leave; January does not.
        assert row["meetings_on_leave"] == 1
        assert row["eligible_meetings"] == 1

    async def test_bounded_leave_excludes_in_range_meetings(self):
        meetings = [_meeting("m1", date(2026, 6, 1)), _meeting("m2", date(2026, 1, 1))]
        leaves = [_leave("u1", date(2026, 5, 1), date(2026, 7, 1))]
        db = _dash_db(_org(), [_member()], meetings, [], leaves)
        row = (await AttendanceDashboardService(db).get_dashboard("org-1"))["members"][
            0
        ]
        assert row["meetings_on_leave"] == 1


class TestVotingEligibility:
    async def test_tier_blocks_voting(self):
        tiers = [{"id": "social", "benefits": {"voting_eligible": False}}]
        db = _dash_db(_org(tiers), [_member(membership_type="social")], [], [], [])
        row = (await AttendanceDashboardService(db).get_dashboard("org-1"))["members"][
            0
        ]
        assert row["voting_eligible"] is False
        assert "not eligible to vote" in row["voting_blocked_reason"]

    async def test_attendance_threshold_blocks_voting(self):
        tiers = [
            {
                "id": "active",
                "benefits": {
                    "voting_requires_meeting_attendance": True,
                    "voting_min_attendance_pct": 75.0,
                },
            }
        ]
        meetings = [_meeting("m1", date(2026, 1, 1)), _meeting("m2", date(2026, 2, 1))]
        attendance = [
            _att("u1", "m1", present=True),
            _att("u1", "m2", present=False),
        ]  # 50%
        db = _dash_db(_org(tiers), [_member()], meetings, attendance, [])
        row = (await AttendanceDashboardService(db).get_dashboard("org-1"))["members"][
            0
        ]
        assert row["voting_eligible"] is False
        assert "below minimum" in row["voting_blocked_reason"]

    async def test_summary_aggregates(self):
        meetings = [_meeting("m1", date(2026, 1, 1))]
        attendance = [_att("u1", "m1", present=True)]
        db = _dash_db(_org(), [_member()], meetings, attendance, [])
        out = await AttendanceDashboardService(db).get_dashboard("org-1")
        assert out["summary"]["total_members"] == 1
        assert out["summary"]["avg_attendance_pct"] == 100.0
        assert out["summary"]["voting_eligible_count"] == 1


class TestWaivers:
    async def test_grant_creates_record_when_absent(self):
        db = MagicMock()
        db.execute = AsyncMock(return_value=_one(None))  # no existing attendee
        db.add = MagicMock()
        db.commit = AsyncMock()
        out = await AttendanceDashboardService(db).grant_waiver(
            "m1", "u1", "org-1", "admin", "Out of town"
        )
        assert out["waiver_reason"] == "Out of town"
        db.add.assert_called_once()
        db.commit.assert_awaited()

    async def test_grant_updates_existing_record(self):
        existing = SimpleNamespace(
            id="att1",
            excused=False,
            waiver_reason=None,
            waiver_granted_by=None,
            waiver_granted_at=None,
        )
        db = MagicMock()
        db.execute = AsyncMock(return_value=_one(existing))
        db.add = MagicMock()
        db.commit = AsyncMock()
        await AttendanceDashboardService(db).grant_waiver(
            "m1", "u1", "org-1", "admin", "Sick"
        )
        assert existing.waiver_reason == "Sick"
        assert existing.excused is True
        db.add.assert_not_called()

    async def test_list_waivers_resolves_names(self):
        waiver = SimpleNamespace(
            id="att1",
            user_id="u1",
            waiver_reason="Sick",
            waiver_granted_by="admin",
            waiver_granted_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        )
        member = SimpleNamespace(full_name="Jane Smith")
        grantor = SimpleNamespace(full_name="Bob Admin")
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[_scalars([waiver]), _one(member), _one(grantor)]
        )
        out = await AttendanceDashboardService(db).list_waivers("m1", "org-1")
        assert out[0]["member_name"] == "Jane Smith"
        assert out[0]["granted_by_name"] == "Bob Admin"


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))

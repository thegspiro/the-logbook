"""Report date ranges are the department's calendar days, not UTC's (GF-24a).

Owner decision: use the organization's timezone through the org_timezone
helpers, falling back to UTC — not to scheduling's America/New_York default —
when the organization has none.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from app.utils.org_timezone import local_range_utc, reporting_timezone

# ---------------------------------------------------------------------------
# Helpers (no database)
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestReportingTimezone:
    def test_uses_the_department_s_timezone(self):
        org = SimpleNamespace(timezone="America/Los_Angeles")
        assert reporting_timezone(org) == ZoneInfo("America/Los_Angeles")

    @pytest.mark.parametrize("value", [None, "", "Mars/Olympus_Mons"])
    def test_falls_back_to_utc_not_to_new_york(self, value):
        assert reporting_timezone(SimpleNamespace(timezone=value)) == ZoneInfo("UTC")

    def test_no_organization_is_utc(self):
        assert reporting_timezone(None) == ZoneInfo("UTC")


@pytest.mark.unit
class TestLocalRangeUtc:
    def test_bounds_are_local_midnights_end_exclusive(self):
        start, end = local_range_utc(
            date(2026, 6, 15), date(2026, 6, 15), ZoneInfo("America/New_York")
        )
        assert start == datetime(2026, 6, 15, 4, 0, tzinfo=timezone.utc)
        assert end == datetime(2026, 6, 16, 4, 0, tzinfo=timezone.utc)

    def test_a_dst_change_day_is_bounded_by_the_calendar(self):
        # 2026-11-01 is 25 hours long in New York.
        start, end = local_range_utc(
            date(2026, 11, 1), date(2026, 11, 1), ZoneInfo("America/New_York")
        )
        assert end - start == timedelta(hours=25)

    def test_an_open_side_is_none(self):
        tz = ZoneInfo("UTC")
        assert local_range_utc(None, date(2026, 1, 1), tz)[0] is None
        assert local_range_utc(date(2026, 1, 1), None, tz)[1] is None


# ---------------------------------------------------------------------------
# Against a real database: the WHERE clause is what matters
# ---------------------------------------------------------------------------


async def _make_org(db, tz):
    from app.models.user import Organization

    org = Organization(
        name="Range TZ FD", slug=f"rangetz-{uuid.uuid4().hex[:8]}", timezone=tz
    )
    db.add(org)
    await db.flush()
    return org


# 2026-06-15 in Los Angeles runs 07:00Z Jun 15 to 07:00Z Jun 16.
LATE_EVENING_LOCAL = datetime(2026, 6, 16, 5, 30, tzinfo=timezone.utc)  # 22:30 PDT
EARLY_NEXT_DAY_LOCAL = datetime(2026, 6, 16, 8, 0, tzinfo=timezone.utc)  # 01:00 PDT
LATE_PREVIOUS_DAY_LOCAL = datetime(2026, 6, 15, 6, 0, tzinfo=timezone.utc)  # 23:00


@pytest.mark.integration
class TestGrantAndFundraisingRanges:
    async def test_grant_report_counts_the_department_s_day(self, db_session):
        from app.models.grant import GrantApplication
        from app.services.grant_service import GrantService

        org = await _make_org(db_session, "America/Los_Angeles")
        for name, at in [
            ("in", LATE_EVENING_LOCAL),
            ("after", EARLY_NEXT_DAY_LOCAL),
            ("before", LATE_PREVIOUS_DAY_LOCAL),
        ]:
            db_session.add(
                GrantApplication(
                    organization_id=org.id,
                    grant_program_name=name,
                    amount_requested=100,
                    created_at=at,
                )
            )
        await db_session.flush()

        report = await GrantService(db_session).get_grant_report(
            org.id, start_date=date(2026, 6, 15), end_date=date(2026, 6, 15)
        )

        assert report["total_applications"] == 1

    async def test_fundraising_report_counts_the_department_s_day(self, db_session):
        from app.models.grant import Donation, PaymentMethod, PaymentStatus
        from app.services.fundraising_service import FundraisingService

        org = await _make_org(db_session, "America/Los_Angeles")
        for amount, at in [
            (100, LATE_EVENING_LOCAL),
            (7, EARLY_NEXT_DAY_LOCAL),
            (9, LATE_PREVIOUS_DAY_LOCAL),
        ]:
            db_session.add(
                Donation(
                    organization_id=org.id,
                    amount=amount,
                    payment_method=PaymentMethod.CASH.value,
                    payment_status=PaymentStatus.COMPLETED.value,
                    donation_date=at,
                )
            )
        await db_session.flush()

        service = FundraisingService(db_session)
        report = await service.get_fundraising_report(
            org.id, start_date=date(2026, 6, 15), end_date=date(2026, 6, 15)
        )
        listed = await service.list_donations(
            org.id, start_date=date(2026, 6, 15), end_date=date(2026, 6, 15)
        )

        assert report["total_donations"] == 100.0
        assert [float(d.amount) for d in listed] == [100.0]

    async def test_no_timezone_falls_back_to_utc_days(self, db_session):
        from app.models.grant import GrantApplication
        from app.services.grant_service import GrantService

        org = await _make_org(db_session, None)
        org.timezone = None
        await db_session.flush()
        # 23:30 UTC on the 15th is the 15th under UTC, the 15th in New York
        # too; 02:00 UTC on the 16th is the 16th under UTC but still the 15th
        # in New York — so it separates the two fallbacks.
        for name, at in [
            ("in", datetime(2026, 6, 15, 23, 30, tzinfo=timezone.utc)),
            ("out", datetime(2026, 6, 16, 2, 0, tzinfo=timezone.utc)),
        ]:
            db_session.add(
                GrantApplication(
                    organization_id=org.id,
                    grant_program_name=name,
                    amount_requested=1,
                    created_at=at,
                )
            )
        await db_session.flush()

        report = await GrantService(db_session).get_grant_report(
            org.id, start_date=date(2026, 6, 15), end_date=date(2026, 6, 15)
        )

        assert report["total_applications"] == 1


@pytest.mark.integration
class TestDepartmentOverviewEventRange:
    async def test_events_are_counted_on_the_department_s_day(self, db_session):
        from app.models.event import Event
        from app.services.reports_service import ReportsService

        org = await _make_org(db_session, "America/Los_Angeles")
        for title, at in [
            ("in", LATE_EVENING_LOCAL),
            ("after", EARLY_NEXT_DAY_LOCAL),
            ("before", LATE_PREVIOUS_DAY_LOCAL),
        ]:
            db_session.add(
                Event(
                    organization_id=org.id,
                    title=title,
                    start_datetime=at,
                    end_datetime=at + timedelta(hours=1),
                )
            )
        await db_session.flush()

        report = await ReportsService(db_session)._generate_department_overview(
            org.id, date(2026, 6, 15), date(2026, 6, 15)
        )

        assert report["events"]["total_events"] == 1

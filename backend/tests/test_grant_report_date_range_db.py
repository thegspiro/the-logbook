"""
Database-backed tests for the grant/fundraising report end-date boundary.

`GrantApplication.created_at` and `Donation.donation_date` are both
`DateTime(timezone=True)` columns, but `get_grant_report`/`get_fundraising_report`
(and `FundraisingService.list_donations`) accept a plain `date` for `end_date`
from the report UI. Before the fix, `<= end_date` sent a bare date straight
into the comparison; MySQL coerces it to midnight (00:00:00) of that day, so
the filter silently excluded every record created later the same day —
understating totals whenever "today" (or any day with an afternoon/evening
entry) falls inside the selected range, which is the default/common case.

A mocked-session test (`test_grant_service.py` / `test_fundraising_service.py`)
cannot catch this at all: the mock hands back canned rows regardless of what
WHERE clause was actually built. This needs a real database.
"""

import uuid
from datetime import date, datetime, timezone

import pytest

from app.models.grant import Donation, GrantApplication, PaymentMethod, PaymentStatus
from app.models.user import Organization
from app.services.fundraising_service import FundraisingService
from app.services.grant_service import GrantService

pytestmark = pytest.mark.integration


async def _make_org(db, name="Grants FD"):
    org = Organization(name=name, slug=f"grants-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def test_grant_report_end_date_includes_records_created_later_that_day(
    db_session,
):
    org = await _make_org(db_session)
    report_day = date(2026, 6, 15)

    morning = GrantApplication(
        organization_id=org.id,
        grant_program_name="Morning Application",
        amount_requested=1000,
        created_at=datetime(
            report_day.year, report_day.month, report_day.day, 8, 0, tzinfo=timezone.utc
        ),
    )
    evening = GrantApplication(
        organization_id=org.id,
        grant_program_name="Evening Application",
        amount_requested=2000,
        created_at=datetime(
            report_day.year,
            report_day.month,
            report_day.day,
            23,
            30,
            tzinfo=timezone.utc,
        ),
    )
    db_session.add_all([morning, evening])
    await db_session.flush()

    report = await GrantService(db_session).get_grant_report(
        org.id, start_date=report_day, end_date=report_day
    )

    assert report["total_applications"] == 2
    assert report["total_requested"] == 3000.0


async def test_fundraising_report_end_date_includes_donations_later_that_day(
    db_session,
):
    org = await _make_org(db_session)
    report_day = date(2026, 6, 15)

    morning = Donation(
        organization_id=org.id,
        amount=100,
        payment_method=PaymentMethod.CASH.value,
        payment_status=PaymentStatus.COMPLETED.value,
        donation_date=datetime(
            report_day.year, report_day.month, report_day.day, 8, 0, tzinfo=timezone.utc
        ),
    )
    evening = Donation(
        organization_id=org.id,
        amount=250,
        payment_method=PaymentMethod.CHECK.value,
        payment_status=PaymentStatus.COMPLETED.value,
        donation_date=datetime(
            report_day.year,
            report_day.month,
            report_day.day,
            23,
            30,
            tzinfo=timezone.utc,
        ),
    )
    db_session.add_all([morning, evening])
    await db_session.flush()

    report = await FundraisingService(db_session).get_fundraising_report(
        org.id, start_date=report_day, end_date=report_day
    )

    assert report["donation_count"] == 2
    assert report["total_donations"] == 350.0


async def test_list_donations_end_date_includes_donations_later_that_day(db_session):
    org = await _make_org(db_session)
    report_day = date(2026, 6, 15)

    evening = Donation(
        organization_id=org.id,
        amount=75,
        payment_method=PaymentMethod.CASH.value,
        payment_status=PaymentStatus.COMPLETED.value,
        donation_date=datetime(
            report_day.year,
            report_day.month,
            report_day.day,
            23,
            30,
            tzinfo=timezone.utc,
        ),
    )
    db_session.add(evening)
    await db_session.flush()

    donations = await FundraisingService(db_session).list_donations(
        org.id, start_date=report_day, end_date=report_day
    )

    assert len(donations) == 1

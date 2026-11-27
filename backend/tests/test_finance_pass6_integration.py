"""Finance (app-review B20 pass 6).

- Two "Generate dues" runs at once no longer bill a member twice.
- A waiver counts only what it forgave, so dues paid before a waiver no
  longer take the outstanding total below zero, here or in the
  delinquency report.
- A fiscal year cannot end before it starts.
- A resubmitted dues payment reference is reported as a duplicate, so the
  endpoint does not audit a payment that was not made.
"""

import asyncio
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import database_manager
from app.models.finance import DuesSchedule, DuesStatus, MemberDues
from app.services.finance_service import FinanceService
from tests.test_finance_quickbooks_export import _user, make_books

pytestmark = [pytest.mark.integration]


async def _seed():
    org_id, user_id = str(uuid.uuid4()), str(uuid.uuid4())
    async with database_manager.engine.connect() as conn:
        async with conn.begin():
            await conn.execute(
                text(
                    "INSERT INTO organizations "
                    "(id, name, organization_type, slug, timezone, active) "
                    "VALUES (:id, 'Dues Race', 'fire_department', :slug, 'UTC', 1)"
                ),
                {"id": org_id, "slug": f"dues-race-{org_id[:8]}"},
            )
            await conn.execute(
                text(
                    "INSERT INTO users (id, organization_id, username, first_name, "
                    "last_name, email, password_hash, status) VALUES (:id, :org, "
                    ":un, 'D', 'R', :em, 'hashed', 'active')"
                ),
                {
                    "id": user_id,
                    "org": org_id,
                    "un": f"dues-race-{user_id[:8]}",
                    "em": f"dues-race-{user_id[:8]}@test.com",
                },
            )
        session = AsyncSession(bind=conn, expire_on_commit=False)
        sched = await FinanceService(session).create_dues_schedule(
            org_id,
            user_id,
            name="Race dues",
            amount=Decimal("50.00"),
            frequency="annual",
            due_date=datetime(2027, 6, 1, tzinfo=timezone.utc),
        )
        await session.commit()
        await session.close()
    return org_id, sched.id


async def _cleanup(org_id):
    async with database_manager.engine.connect() as conn:
        async with conn.begin():
            for s in (
                "DELETE FROM member_dues WHERE organization_id = :o",
                "DELETE FROM dues_schedules WHERE organization_id = :o",
                "DELETE FROM users WHERE organization_id = :o",
                "DELETE FROM organizations WHERE id = :o",
            ):
                await conn.execute(text(s), {"o": org_id})


async def _count(org_id):
    async with database_manager.engine.connect() as conn:
        return (
            await conn.execute(
                text("SELECT COUNT(*) FROM member_dues WHERE organization_id = :o"),
                {"o": org_id},
            )
        ).scalar_one()


@pytest.mark.usefixtures("_initialize_database")
async def test_two_generate_runs_at_once_bill_a_member_once():
    org_id, schedule_id = await _seed()
    first_flushed = asyncio.Event()

    async def run(wait):
        if wait:
            await first_flushed.wait()
        async with database_manager.engine.connect() as conn:
            session = AsyncSession(bind=conn, expire_on_commit=False)
            try:
                n = await FinanceService(session).generate_member_dues(
                    schedule_id, org_id
                )
                if not wait:
                    first_flushed.set()
                    await asyncio.sleep(0.3)
                await session.commit()
                return n
            finally:
                first_flushed.set()
                await session.close()

    try:
        results = await asyncio.gather(run(False), run(True))
        rows = await _count(org_id)
    finally:
        await _cleanup(org_id)

    assert rows == 1
    assert sorted(results) == [0, 1]


async def _schedule_with_two_members(db):
    books = await make_books(db)
    org = books["org_id"]
    treasurer = books["user_id"]
    schedule = DuesSchedule(
        organization_id=org,
        name="2027 dues",
        amount=Decimal("100.00"),
        frequency="annual",
        due_date=datetime(2027, 1, 1, tzinfo=timezone.utc),
        created_by=treasurer,
    )
    db.add(schedule)
    await db.flush()
    dues = []
    for _ in range(2):
        row = MemberDues(
            organization_id=org,
            dues_schedule_id=schedule.id,
            user_id=await _user(db, org),
            amount_due=Decimal("100.00"),
            amount_paid=Decimal("0"),
            due_date=schedule.due_date,
            status=DuesStatus.PENDING,
        )
        db.add(row)
        dues.append(row)
    await db.flush()
    return org, treasurer, schedule, dues


async def test_a_waiver_after_part_payment_counts_only_what_it_forgave(db_session):
    org, treasurer, schedule, (partly, unpaid) = await _schedule_with_two_members(
        db_session
    )
    svc = FinanceService(db_session)
    await svc.record_dues_payment(
        partly.id, org, recorded_by=treasurer, amount_paid=Decimal("40.00")
    )
    await svc.waive_dues(partly.id, org, treasurer, "hardship")

    summary = await svc.get_dues_summary(org, schedule.id)

    assert summary["total_waived"] == Decimal("60.00")
    assert summary["total_collected"] == Decimal("40.00")
    # Only the second member's $100 is still owed.
    assert summary["total_outstanding"] == Decimal("100.00")


async def test_a_backwards_fiscal_year_is_refused(db_session):
    books = await make_books(db_session)
    svc = FinanceService(db_session)

    with pytest.raises(ValueError, match="end date cannot be before"):
        await svc.create_fiscal_year(
            books["org_id"],
            books["user_id"],
            name="Backwards",
            start_date=datetime(2027, 12, 31, tzinfo=timezone.utc),
            end_date=datetime(2027, 1, 1, tzinfo=timezone.utc),
        )

    fy = await svc.create_fiscal_year(
        books["org_id"],
        books["user_id"],
        name="FY2027",
        start_date=datetime(2027, 1, 1, tzinfo=timezone.utc),
        end_date=datetime(2027, 12, 31, tzinfo=timezone.utc),
    )
    with pytest.raises(ValueError, match="end date cannot be before"):
        await svc.update_fiscal_year(
            fy.id, books["org_id"], end_date=datetime(2026, 6, 30, tzinfo=timezone.utc)
        )


async def test_a_resubmitted_payment_reference_is_reported_as_a_duplicate(
    db_session,
):
    org, treasurer, _, (dues, _other) = await _schedule_with_two_members(db_session)
    first = FinanceService(db_session)
    await first.record_dues_payment(
        dues.id,
        org,
        recorded_by=treasurer,
        amount_paid=Decimal("25.00"),
        transaction_reference="CHK-1001",
    )
    assert first.dues_payment_was_duplicate is False

    again = FinanceService(db_session)
    record = await again.record_dues_payment(
        dues.id,
        org,
        recorded_by=treasurer,
        amount_paid=Decimal("25.00"),
        transaction_reference="CHK-1001",
    )

    assert again.dues_payment_was_duplicate is True
    assert record.amount_paid == Decimal("25.00")

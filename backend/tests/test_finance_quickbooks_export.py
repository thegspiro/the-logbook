"""The finance export as a QuickBooks Online journal-entry import.

QuickBooks rejects a journal entry with no account on a line, or whose debits
and credits differ. These tests run the real export against the database and
check the file it would be asked to import: every transaction balanced across
the category's account and its offset, and an export that cannot be given both
refused before anything is written.
"""

import csv
import io
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import (
    Budget,
    BudgetCategory,
    CheckRequest,
    CheckRequestStatus,
    ExpenseLineItem,
    ExpenseReport,
    ExpenseReportStatus,
    ExportLog,
    ExportMapping,
    ExportMappingType,
    FiscalYear,
    FiscalYearStatus,
    PurchaseRequest,
    PurchaseRequestStatus,
)
from app.services.finance_service import FinanceService

pytestmark = [pytest.mark.integration]

PAID = datetime(2026, 3, 10, 15, 0, tzinfo=timezone.utc)
RANGE = (
    datetime(2026, 3, 1, tzinfo=timezone.utc),
    datetime(2026, 3, 31, tzinfo=timezone.utc),
)


async def _org(db: AsyncSession) -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'QB Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"qb-{org_id[:8]}"},
    )
    return org_id


async def _user(db: AsyncSession, org_id: str) -> str:
    user_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Tess', 'Treasurer', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"tess-{user_id[:8]}",
            "em": f"tess-{user_id[:8]}@test.example",
        },
    )
    return user_id


@pytest.fixture
async def books(db_session: AsyncSession):
    """A department with two budget lines and one paid transaction of each type."""
    org_id = await _org(db_session)
    user_id = await _user(db_session, org_id)
    fy = FiscalYear(
        organization_id=org_id,
        name="FY2026",
        start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
        end_date=datetime(2026, 12, 31, tzinfo=timezone.utc),
        status=FiscalYearStatus.ACTIVE,
        created_by=user_id,
    )
    # Training names its own QuickBooks account; Fuel relies on its mapping.
    training = BudgetCategory(
        organization_id=org_id, name="Training", qb_account_name="Training Expense"
    )
    fuel = BudgetCategory(organization_id=org_id, name="Fuel")
    db_session.add_all([fy, training, fuel])
    await db_session.flush()

    training_line = Budget(
        organization_id=org_id,
        fiscal_year_id=fy.id,
        category_id=training.id,
        amount_budgeted=Decimal("1000.00"),
        created_by=user_id,
    )
    fuel_line = Budget(
        organization_id=org_id,
        fiscal_year_id=fy.id,
        category_id=fuel.id,
        amount_budgeted=Decimal("500.00"),
        created_by=user_id,
    )
    db_session.add_all([training_line, fuel_line])
    await db_session.flush()

    purchase = PurchaseRequest(
        organization_id=org_id,
        request_number="PR-2026-0001",
        fiscal_year_id=fy.id,
        budget_id=training_line.id,
        requested_by=user_id,
        title="CPR instructor",
        vendor="Red Cross",
        estimated_amount=Decimal("250"),
        actual_amount=Decimal("240.5"),
        status=PurchaseRequestStatus.PAID,
        paid_at=PAID,
    )
    check = CheckRequest(
        organization_id=org_id,
        request_number="CR-2026-0001",
        requested_by=user_id,
        fiscal_year_id=fy.id,
        budget_id=fuel_line.id,
        payee_name="County Fuel Depot",
        amount=Decimal("80.00"),
        purpose="March diesel",
        check_number="1042",
        status=CheckRequestStatus.ISSUED,
        check_date=PAID,
    )
    report = ExpenseReport(
        organization_id=org_id,
        report_number="ER-2026-0001",
        submitted_by=user_id,
        fiscal_year_id=fy.id,
        title="Conference travel",
        total_amount=Decimal("35.00"),
        status=ExpenseReportStatus.PAID,
        paid_at=PAID,
    )
    db_session.add_all([purchase, check, report])
    await db_session.flush()
    db_session.add_all(
        [
            ExpenseLineItem(
                expense_report_id=report.id,
                budget_id=training_line.id,
                description="Registration",
                amount=Decimal("20.00"),
                date_incurred=PAID,
            ),
            ExpenseLineItem(
                expense_report_id=report.id,
                budget_id=fuel_line.id,
                description="Gas",
                merchant="Shell",
                amount=Decimal("15.00"),
                date_incurred=PAID,
            ),
        ]
    )
    training_map = ExportMapping(
        organization_id=org_id,
        internal_category="training",
        qb_account_name="Ignored, the category names its own",
        qb_offset_account_name="Operating Checking",
        mapping_type=ExportMappingType.EXPENSE,
    )
    fuel_map = ExportMapping(
        organization_id=org_id,
        internal_category="Fuel",
        qb_account_name="Vehicle Expense:Fuel",
        qb_offset_account_name="Operating Checking",
        mapping_type=ExportMappingType.EXPENSE,
    )
    db_session.add_all([training_map, fuel_map])
    await db_session.flush()
    return {
        "org_id": org_id,
        "user_id": user_id,
        "purchase": purchase,
        "training": training,
        "training_map": training_map,
        "fuel_map": fuel_map,
    }


async def _export(db: AsyncSession, books) -> list[list[str]]:
    stream = await FinanceService(db).generate_export(
        books["org_id"], books["user_id"], *RANGE
    )
    content = "".join([chunk async for chunk in stream])
    return list(csv.reader(io.StringIO(content)))


def _entry(number, memo, account, amount, description) -> list[list[str]]:
    """The debit and its balancing credit, both dated the payment day."""
    day = "03/10/2026"
    return [
        [number, day, memo, account, amount, "", description],
        [number, day, memo, "Operating Checking", "", amount, description],
    ]


async def _logs(db: AsyncSession, org_id: str) -> list[ExportLog]:
    result = await db.execute(
        select(ExportLog).where(ExportLog.organization_id == org_id)
    )
    return list(result.scalars())


class TestBalancedJournalEntries:
    async def test_every_transaction_posts_to_its_account_and_offset(
        self, db_session, books
    ):
        rows = await _export(db_session, books)

        assert rows[0] == [
            "Journal No",
            "Journal Date",
            "Memo",
            "Account Name",
            "Debits",
            "Credits",
            "Description",
        ]
        assert rows[1:] == [
            # The category's own account wins over its mapping's.
            *_entry(
                "PR-2026-0001",
                "CPR instructor",
                "Training Expense",
                "240.50",
                "Red Cross",
            ),
            *_entry(
                "CR-2026-0001",
                "March diesel",
                "Vehicle Expense:Fuel",
                "80.00",
                "County Fuel Depot (check 1042)",
            ),
            # One report is one entry, its lines charged to their own budget
            # lines.
            *_entry(
                "ER-2026-0001",
                "Conference travel",
                "Training Expense",
                "20.00",
                "Registration",
            ),
            *_entry(
                "ER-2026-0001",
                "Conference travel",
                "Vehicle Expense:Fuel",
                "15.00",
                "Shell: Gas",
            ),
        ]

        (log,) = await _logs(db_session, books["org_id"])
        assert (log.status, log.record_count) == ("successful", 4)

    async def test_each_journal_number_balances(self, db_session, books):
        rows = await _export(db_session, books)

        totals: dict[str, Decimal] = {}
        for number, _, _, account, debit, credit, _ in rows[1:]:
            assert account, "QuickBooks rejects a line without an account"
            totals[number] = (
                totals.get(number, Decimal(0))
                + Decimal(debit or 0)
                - Decimal(credit or 0)
            )
        assert set(totals.values()) == {Decimal(0)}

    async def test_the_mapping_supplies_the_account_when_the_category_has_none(
        self, db_session, books
    ):
        books["training"].qb_account_name = None
        await db_session.flush()

        rows = await _export(db_session, books)

        assert rows[1][3] == "Ignored, the category names its own"

    async def test_an_empty_range_is_a_header_and_nothing_else(self, db_session, books):
        stream = await FinanceService(db_session).generate_export(
            books["org_id"],
            books["user_id"],
            datetime(2025, 1, 1, tzinfo=timezone.utc),
            datetime(2025, 1, 31, tzinfo=timezone.utc),
        )
        content = "".join([chunk async for chunk in stream])

        assert len(list(csv.reader(io.StringIO(content)))) == 1


class TestRefusedWhenAnAccountIsMissing:
    async def _refusal(self, db_session, books) -> str:
        with pytest.raises(ValueError, match="Set QuickBooks accounts") as caught:
            await FinanceService(db_session).generate_export(
                books["org_id"], books["user_id"], *RANGE
            )
        assert await _logs(db_session, books["org_id"]) == []
        message = str(caught.value)
        # safe_error_detail swaps anything longer for a generic error.
        assert len(message) <= 300
        return message

    async def test_a_transaction_without_a_budget_line(self, db_session, books):
        books["purchase"].budget_id = None
        await db_session.flush()

        message = await self._refusal(db_session, books)

        assert "1 transactions with no budget line (PR-2026-0001)" in message

    async def test_a_category_with_no_offset_account(self, db_session, books):
        books["fuel_map"].qb_offset_account_name = "  "
        await db_session.flush()

        assert "'Fuel' has no offset account" in await self._refusal(db_session, books)

    async def test_a_category_with_no_mapping_at_all(self, db_session, books):
        await db_session.delete(books["fuel_map"])
        await db_session.flush()

        assert "'Fuel' has no account" in await self._refusal(db_session, books)

    async def test_a_category_mapped_twice(self, db_session, books):
        db_session.add(
            ExportMapping(
                organization_id=books["org_id"],
                internal_category="FUEL",
                qb_account_name="Fuel Two",
                qb_offset_account_name="Savings",
                mapping_type=ExportMappingType.EXPENSE,
            )
        )
        await db_session.flush()

        assert "'Fuel' has 2 mappings" in await self._refusal(db_session, books)

    async def test_another_departments_mapping_is_not_used(self, db_session, books):
        other_org = await _org(db_session)
        books["fuel_map"].organization_id = other_org
        await db_session.flush()

        assert "'Fuel' has no account" in await self._refusal(db_session, books)

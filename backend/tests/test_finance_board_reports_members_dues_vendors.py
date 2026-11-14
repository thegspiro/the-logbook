"""The three board reports the original plan left unbuilt.

Owner decision of 2026-11-01 (docs/KNOWN_LIMITATIONS.md, "Finance — Board
Reports: What They Do Not Cover", "Build them"):

* **Expense summary by member** -- the payments register's reimbursements for
  a period, totalled by member, so the two reports agree to the cent.
* **Dues delinquency** -- the collection totals for the dues falling due in a
  period, and each member with a record there that is overdue by the dues
  code's own rule (``dues_overdue_clause``): a partly paid record is not.
* **Purchases by vendor** -- a fiscal year's approved and paid purchase
  requests, grouped by vendor ignoring case and spacing.

Each takes the same filters as its neighbours, downloads as CSV through
``SafeCsvWriter``, and is ``finance.view``.
"""

import csv
import io
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest

from app.models.finance import (
    DuesFrequency,
    DuesSchedule,
    DuesStatus,
    ExpenseLineItem,
    ExpenseReport,
    ExpenseReportStatus,
    FiscalYearStatus,
    MemberDues,
    PurchaseRequest,
    PurchaseRequestStatus,
)
from app.services.finance_report_service import FinanceReportService
from tests.test_finance_budget_owners import _client, _org, _position, _user, _year

pytestmark = pytest.mark.integration

OCTOBER = (date(2026, 10, 1), date(2026, 10, 31))


def _at(day: int, month: int = 10) -> datetime:
    return datetime(2026, month, day, 15, tzinfo=timezone.utc)


@pytest.fixture
async def dept(db_session):
    org_id = await _org(db_session, "board")
    other_org = await _org(db_session, "board-else")
    member_pos = await _position(db_session, org_id, "Member", ["finance.request"])
    treasurer_pos = await _position(db_session, org_id, "Treasurer", ["finance.view"])
    people = {
        "alice": await _user(db_session, org_id, "alice", [member_pos]),
        "bob": await _user(db_session, org_id, "bob", [member_pos]),
        "carol": await _user(db_session, org_id, "carol", [member_pos]),
        "dave": await _user(db_session, org_id, "dave", [member_pos]),
        "treasurer": await _user(db_session, org_id, "treasurer", [treasurer_pos]),
        "foreign": await _user(db_session, other_org, "foreign", [member_pos]),
    }
    year = _year(org_id, "FY2026", FiscalYearStatus.ACTIVE, people["alice"].id, 2026)
    last_year = _year(
        org_id, "FY2025", FiscalYearStatus.CLOSED, people["alice"].id, 2025
    )
    foreign_year = _year(
        other_org, "FY2026", FiscalYearStatus.ACTIVE, people["foreign"].id, 2026
    )
    db_session.add_all([year, last_year, foreign_year])
    await db_session.flush()
    return {
        "org_id": org_id,
        "other_org": other_org,
        "fy_id": year.id,
        "last_fy_id": last_year.id,
        "foreign_fy_id": foreign_year.id,
        **people,
    }


async def _paid_report(db, org_id, fy_id, member, amounts, paid_at):
    report = ExpenseReport(
        organization_id=org_id,
        report_number=f"ER-{uuid.uuid4().hex[:6]}",
        submitted_by=member.id,
        fiscal_year_id=fy_id,
        title="Conference",
        total_amount=sum(amounts, Decimal("0")),
        status=ExpenseReportStatus.PAID,
        paid_at=paid_at,
    )
    db.add(report)
    await db.flush()
    for amount in amounts:
        db.add(
            ExpenseLineItem(
                expense_report_id=report.id,
                description="Line",
                amount=amount,
                date_incurred=_at(1, 9),
                receipt_document_id=None,
            )
        )
    await db.flush()
    return report


async def _csv(db, user, path) -> tuple[int, list[list[str]]]:
    async with _client(db, user) as client:
        resp = await client.get(path)
    if resp.status_code != 200:
        return resp.status_code, []
    return resp.status_code, list(csv.reader(io.StringIO(resp.text)))


# ============================================
# Expense summary by member
# ============================================


class TestExpenseSummaryByMember:
    async def _reports(self, db, dept):
        org, fy = dept["org_id"], dept["fy_id"]
        await _paid_report(
            db, org, fy, dept["alice"], [Decimal("15.00"), Decimal("25.00")], _at(3)
        )
        await _paid_report(db, org, fy, dept["alice"], [Decimal("60.00")], _at(20))
        await _paid_report(db, org, fy, dept["bob"], [Decimal("25.50")], _at(9))
        # Paid before the period, and another department's: neither counts.
        await _paid_report(db, org, fy, dept["bob"], [Decimal("99.00")], _at(28, 9))
        await _paid_report(
            db,
            dept["other_org"],
            dept["foreign_fy_id"],
            dept["foreign"],
            [Decimal("500.00")],
            _at(10),
        )

    async def test_each_member_is_totalled_from_the_register(self, db_session, dept):
        await self._reports(db_session, dept)
        service = FinanceReportService(db_session)

        report = await service.expense_summary_by_member(dept["org_id"], *OCTOBER)

        assert [
            (r["member_name"], r["report_count"], r["amount"]) for r in report["rows"]
        ] == [
            ("alice Test", 2, Decimal("100.00")),
            ("bob Test", 1, Decimal("25.50")),
        ]
        assert report["total"] == Decimal("125.50")
        register = await service.payments_register(dept["org_id"], *OCTOBER)
        reimbursed = sum(
            (r["amount"] for r in register["rows"] if r["kind"] == "expense_report"),
            Decimal("0"),
        )
        assert report["total"] == reimbursed

    async def test_the_csv_carries_the_same_rows(self, db_session, dept):
        await self._reports(db_session, dept)

        status, rows = await _csv(
            db_session,
            dept["treasurer"],
            "/finance/reports/expense-summary-by-member"
            "?start=2026-10-01&end=2026-10-31&format=csv",
        )

        assert status == 200
        assert rows == [
            ["Member", "Reports paid", "Checks voided", "Reimbursed"],
            ["alice Test", "2", "0", "100.00"],
            ["bob Test", "1", "0", "25.50"],
            ["Total", "", "", "125.50"],
        ]

    async def test_a_period_over_a_year_is_refused(self, db_session, dept):
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await client.get(
                "/finance/reports/expense-summary-by-member"
                "?start=2025-01-01&end=2026-10-31"
            )
        assert resp.status_code == 400


# ============================================
# Dues delinquency
# ============================================


class TestDuesDelinquency:
    async def _dues(self, db, dept):
        org = dept["org_id"]
        schedule = DuesSchedule(
            organization_id=org,
            name="2026 dues",
            amount=Decimal("100.00"),
            frequency=DuesFrequency.ANNUAL,
            due_date=datetime(2026, 10, 1, tzinfo=timezone.utc),
            created_by=dept["treasurer"].id,
        )
        foreign = DuesSchedule(
            organization_id=dept["other_org"],
            name="Theirs",
            amount=Decimal("100.00"),
            frequency=DuesFrequency.ANNUAL,
            due_date=datetime(2026, 10, 1, tzinfo=timezone.utc),
            created_by=dept["foreign"].id,
        )
        db.add_all([schedule, foreign])
        await db.flush()

        def record(member, amount_due, amount_paid, status, due, **extra):
            return MemberDues(
                organization_id=member.organization_id,
                dues_schedule_id=(
                    foreign.id if member is dept["foreign"] else schedule.id
                ),
                user_id=member.id,
                amount_due=Decimal(amount_due),
                amount_paid=Decimal(amount_paid),
                status=status,
                due_date=due,
                **extra,
            )

        oct1 = datetime(2026, 10, 1, tzinfo=timezone.utc)
        db.add_all(
            [
                # Stored PENDING but past due and unpaid: overdue by the
                # dues code's rule even before the daily task marks it. The
                # late fee the task charged is already in the amount due.
                record(
                    dept["alice"],
                    "110.00",
                    "0.00",
                    DuesStatus.PENDING,
                    oct1,
                    late_fee_applied=Decimal("10.00"),
                ),
                # Partly paid stays PARTIAL, not overdue.
                record(dept["bob"], "100.00", "20.00", DuesStatus.PARTIAL, oct1),
                record(dept["carol"], "100.00", "100.00", DuesStatus.PAID, oct1),
                record(dept["dave"], "100.00", "0.00", DuesStatus.WAIVED, oct1),
                # Falls due outside the period.
                record(
                    dept["carol"],
                    "100.00",
                    "0.00",
                    DuesStatus.OVERDUE,
                    datetime(2026, 9, 1, tzinfo=timezone.utc),
                ),
                record(dept["foreign"], "100.00", "0.00", DuesStatus.OVERDUE, oct1),
            ]
        )
        await db.flush()

    async def test_overdue_members_and_the_collection_totals(self, db_session, dept):
        await self._dues(db_session, dept)

        report = await FinanceReportService(db_session).dues_delinquency(
            dept["org_id"], *OCTOBER
        )

        assert (
            report["expected"],
            report["collected"],
            report["waived"],
            report["outstanding"],
        ) == (
            Decimal("410.00"),
            Decimal("120.00"),
            Decimal("100.00"),
            Decimal("190.00"),
        )
        assert report["members_overdue"] == 1
        (row,) = report["rows"]
        today = datetime.now(timezone.utc).date()
        assert row["member_name"] == "alice Test"
        assert row["overdue_records"] == 1
        assert row["amount_overdue"] == Decimal("110.00")
        assert row["late_fees"] == Decimal("10.00")
        assert row["oldest_due"] == date(2026, 10, 1)
        assert row["days_overdue"] == (today - date(2026, 10, 1)).days
        assert report["total_overdue"] == Decimal("110.00")

    async def test_the_csv_lists_the_members(self, db_session, dept):
        await self._dues(db_session, dept)

        status, rows = await _csv(
            db_session,
            dept["treasurer"],
            "/finance/reports/dues-delinquency"
            "?start=2026-10-01&end=2026-10-31&format=csv",
        )

        assert status == 200
        assert rows[0] == [
            "Member",
            "Overdue records",
            "Oldest due",
            "Days overdue",
            "Late fees",
            "Amount overdue",
        ]
        assert rows[1][:3] == ["alice Test", "1", "2026-10-01"]
        assert rows[1][4:] == ["10.00", "110.00"]
        assert rows[-1] == ["Total", "", "", "", "", "110.00"]


# ============================================
# Purchases by vendor
# ============================================


class TestPurchasesByVendor:
    async def _purchases(self, db, dept):
        def pr(vendor, status, estimated, actual=None, fy=None, org=None, by=None):
            return PurchaseRequest(
                organization_id=org or dept["org_id"],
                request_number=f"PR-{uuid.uuid4().hex[:6]}",
                fiscal_year_id=fy or dept["fy_id"],
                requested_by=(by or dept["alice"]).id,
                title="Supplies",
                vendor=vendor,
                estimated_amount=Decimal(estimated),
                actual_amount=Decimal(actual) if actual else None,
                status=status,
            )

        db.add_all(
            [
                pr("Acme Supply", PurchaseRequestStatus.APPROVED, "100.00"),
                pr("  acme   supply ", PurchaseRequestStatus.PAID, "90.00", "80.00"),
                pr("Acme Supply", PurchaseRequestStatus.ORDERED, "50.00"),
                pr("Bolt Co", PurchaseRequestStatus.REIMBURSED, "30.00"),
                pr("=HYPERLINK(1)", PurchaseRequestStatus.RECEIVED, "5.00"),
                pr(None, PurchaseRequestStatus.PAID, "20.00", "20.00"),
                # Nothing agreed to, another year, another department.
                pr("Bolt Co", PurchaseRequestStatus.DRAFT, "999.00"),
                pr("Bolt Co", PurchaseRequestStatus.DENIED, "999.00"),
                pr("Bolt Co", PurchaseRequestStatus.CANCELLED, "999.00"),
                pr(
                    "Acme Supply",
                    PurchaseRequestStatus.PAID,
                    "999.00",
                    fy=dept["last_fy_id"],
                ),
                pr(
                    "Acme Supply",
                    PurchaseRequestStatus.PAID,
                    "999.00",
                    fy=dept["foreign_fy_id"],
                    org=dept["other_org"],
                    by=dept["foreign"],
                ),
            ]
        )
        await db.flush()

    async def test_vendors_are_grouped_and_totalled(self, db_session, dept):
        await self._purchases(db_session, dept)

        report = await FinanceReportService(db_session).purchases_by_vendor(
            dept["org_id"], dept["fy_id"]
        )

        assert [
            (r["vendor"], r["orders"], r["open"], r["paid"], r["total"])
            for r in report["rows"]
        ] == [
            ("Acme Supply", 3, Decimal("150.00"), Decimal("80.00"), Decimal("230.00")),
            ("Bolt Co", 1, Decimal("0.00"), Decimal("30.00"), Decimal("30.00")),
            (None, 1, Decimal("0.00"), Decimal("20.00"), Decimal("20.00")),
            ("=HYPERLINK(1)", 1, Decimal("5.00"), Decimal("0.00"), Decimal("5.00")),
        ]
        assert (report["total_open"], report["total_paid"], report["total"]) == (
            Decimal("155.00"),
            Decimal("130.00"),
            Decimal("285.00"),
        )

    async def test_another_departments_year_is_not_found(self, db_session, dept):
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await client.get(
                "/finance/reports/purchases-by-vendor"
                f"?fiscal_year_id={dept['foreign_fy_id']}"
            )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Fiscal year not found"

    async def test_the_csv_cannot_carry_a_formula(self, db_session, dept):
        await self._purchases(db_session, dept)

        status, rows = await _csv(
            db_session,
            dept["treasurer"],
            "/finance/reports/purchases-by-vendor"
            f"?fiscal_year_id={dept['fy_id']}&format=csv",
        )

        assert status == 200
        assert rows[0] == ["Vendor", "Requests", "Open", "Paid", "Total"]
        assert ["No vendor named", "1", "0.00", "20.00", "20.00"] in rows
        vendors = [row[0] for row in rows]
        assert "=HYPERLINK(1)" not in vendors
        assert any(
            v.endswith("=HYPERLINK(1)") and v != "=HYPERLINK(1)" for v in vendors
        )
        assert rows[-1] == ["Total", "", "155.00", "130.00", "285.00"]


class TestWhoReadsThem:
    @pytest.mark.parametrize(
        "path",
        [
            "/finance/reports/expense-summary-by-member?start=2026-10-01&end=2026-10-31",
            "/finance/reports/dues-delinquency?start=2026-10-01&end=2026-10-31",
            "/finance/reports/purchases-by-vendor?fiscal_year_id=x",
        ],
    )
    async def test_a_member_without_finance_view_is_refused(
        self, db_session, dept, path
    ):
        async with _client(db_session, dept["alice"]) as client:
            resp = await client.get(path)
        assert resp.status_code == 403

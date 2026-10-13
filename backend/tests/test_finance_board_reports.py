"""Board reports: budget vs actual, the amendment log, the payments register.

One department, on New York time, with a year's worth of dated activity:

* Gear: budgeted 1,000.00, amended +200.00 (confirmed March 15) and +50.00
  (still pending); a purchase paid March 10 (150.00); a check issued March 12
  (80.00) and voided April 2; an expense line paid March 20 (20.00).
* Fuel: budgeted 500.00; an expense line on the same report (15.00) and a
  check issued April 5 (40.00).

Spent through a date is summed from the payments dated through it, so the
budget-vs-actual report for a period reconciles with the payments register
for the same period.
"""

import csv
import io
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import text

from app.models.finance import (
    Budget,
    BudgetAmendment,
    BudgetAmendmentStatus,
    BudgetCategory,
    CheckRequest,
    CheckRequestStatus,
    ExpenseLineItem,
    ExpenseReport,
    ExpenseReportStatus,
    FiscalYearStatus,
    PurchaseRequest,
    PurchaseRequestStatus,
)
from app.services.finance_report_service import FinanceReportService
from tests.test_finance_budget_owners import _client, _position, _user, _year

pytestmark = [pytest.mark.integration]


def utc(*args) -> datetime:
    return datetime(*args, tzinfo=timezone.utc)


async def _org(db, label: str, tz: str = "America/New_York") -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, :tz)"
        ),
        {
            "id": org_id,
            "name": f"{label} Dept",
            "slug": f"{label}-{org_id[:8]}",
            "tz": tz,
        },
    )
    return org_id


@pytest.fixture
async def books(db_session):
    org_id = await _org(db_session, "board")
    other_org = await _org(db_session, "else")
    treasurer_pos = await _position(
        db_session, org_id, "Treasurer", ["finance.view", "finance.manage"]
    )
    member_pos = await _position(db_session, org_id, "Member", ["finance.request"])
    foreign_pos = await _position(db_session, other_org, "Treasurer", ["finance.view"])
    treasurer = await _user(db_session, org_id, "treasurer", [treasurer_pos])
    president = await _user(db_session, org_id, "president", [treasurer_pos])
    member = await _user(db_session, org_id, "member", [member_pos])
    outsider = await _user(db_session, other_org, "outsider", [foreign_pos])

    year = _year(org_id, "FY2026", FiscalYearStatus.ACTIVE, treasurer.id, 2026)
    gear_cat = BudgetCategory(organization_id=org_id, name="Gear")
    fuel_cat = BudgetCategory(organization_id=org_id, name="Fuel")
    db_session.add_all([year, gear_cat, fuel_cat])
    await db_session.flush()
    # The running totals as the payments left them (the void took 80 back).
    gear = Budget(
        organization_id=org_id,
        fiscal_year_id=year.id,
        category_id=gear_cat.id,
        amount_budgeted=Decimal("1200.00"),
        amount_spent=Decimal("170.00"),
        amount_encumbered=Decimal("60.00"),
        created_by=treasurer.id,
    )
    fuel = Budget(
        organization_id=org_id,
        fiscal_year_id=year.id,
        category_id=fuel_cat.id,
        amount_budgeted=Decimal("500.00"),
        amount_spent=Decimal("55.00"),
        created_by=treasurer.id,
    )
    db_session.add_all([gear, fuel])
    await db_session.flush()

    common = {"organization_id": org_id, "fiscal_year_id": year.id}
    db_session.add_all(
        [
            BudgetAmendment(
                organization_id=org_id,
                budget_id=gear.id,
                amount=Decimal("200.00"),
                reason="New hose",
                approved_by="Board vote 3/14",
                approved_on=date(2026, 3, 14),
                created_by=treasurer.id,
                created_at=utc(2026, 3, 14, 18),
                status=BudgetAmendmentStatus.CONFIRMED,
                decided_by=president.id,
                decided_at=utc(2026, 3, 15, 16),
            ),
            BudgetAmendment(
                organization_id=org_id,
                budget_id=gear.id,
                amount=Decimal("50.00"),
                reason="Gloves",
                approved_by="Chief",
                approved_on=date(2026, 9, 1),
                created_by=treasurer.id,
                created_at=utc(2026, 9, 1, 18),
                status=BudgetAmendmentStatus.PENDING,
            ),
            PurchaseRequest(
                **common,
                request_number="PR-2026-0001",
                budget_id=gear.id,
                requested_by=member.id,
                title="Nozzles",
                vendor="Hose Supply Co",
                estimated_amount=Decimal("160.00"),
                actual_amount=Decimal("150.00"),
                status=PurchaseRequestStatus.PAID,
                paid_at=utc(2026, 3, 10, 15),
            ),
            CheckRequest(
                **common,
                request_number="CR-2026-0001",
                budget_id=gear.id,
                requested_by=member.id,
                payee_name="Glove Depot",
                amount=Decimal("80.00"),
                memo="Gloves",
                check_number="1001",
                status=CheckRequestStatus.VOIDED,
                check_date=utc(2026, 3, 12, 15),
                voided_at=utc(2026, 4, 2, 15),
            ),
            CheckRequest(
                **common,
                request_number="CR-2026-0002",
                budget_id=fuel.id,
                requested_by=member.id,
                payee_name="County Fuel",
                amount=Decimal("40.00"),
                purpose="Diesel",
                check_number="1002",
                status=CheckRequestStatus.ISSUED,
                check_date=utc(2026, 4, 5, 15),
            ),
        ]
    )
    report = ExpenseReport(
        **common,
        report_number="ER-2026-0001",
        submitted_by=member.id,
        title="Conference",
        total_amount=Decimal("35.00"),
        status=ExpenseReportStatus.PAID,
        paid_at=utc(2026, 3, 20, 15),
    )
    db_session.add(report)
    await db_session.flush()
    db_session.add_all(
        [
            ExpenseLineItem(
                expense_report_id=report.id,
                budget_id=gear.id,
                description="Registration",
                amount=Decimal("20.00"),
                date_incurred=utc(2026, 3, 1),
            ),
            ExpenseLineItem(
                expense_report_id=report.id,
                budget_id=fuel.id,
                description="Gas",
                amount=Decimal("15.00"),
                date_incurred=utc(2026, 3, 1),
            ),
        ]
    )
    await db_session.flush()
    return {
        "org_id": org_id,
        "fy_id": year.id,
        "gear": gear.id,
        "fuel": fuel.id,
        "treasurer": treasurer,
        "member": member,
        "outsider": outsider,
    }


def _by_line(report) -> dict:
    return {row["category_name"]: row for row in report["rows"]}


# ============================================
# Budget vs actual
# ============================================


class TestBudgetVsActual:
    async def test_through_the_end_of_march(self, db_session, books):
        report = await FinanceReportService(db_session).budget_vs_actual(
            books["org_id"], books["fy_id"], date(2026, 3, 31)
        )

        gear, fuel = _by_line(report)["Gear"], _by_line(report)["Fuel"]
        assert gear["original_budget"] == Decimal("1000.00")
        assert gear["amendments"] == Decimal("200.00")
        assert gear["budget"] == Decimal("1200.00")
        # The check was not voided until April.
        assert gear["spent"] == Decimal("250.00")
        assert gear["remaining"] == Decimal("950.00")
        assert fuel["spent"] == Decimal("15.00")
        assert report["includes_committed"] is False
        assert gear["committed"] is None
        assert gear["running_spent"] is None
        assert report["totals"]["spent"] == Decimal("265.00")
        assert report["totals"]["committed"] is None

    async def test_before_the_amendment_took_effect(self, db_session, books):
        report = await FinanceReportService(db_session).budget_vs_actual(
            books["org_id"], books["fy_id"], date(2026, 3, 14)
        )

        gear = _by_line(report)["Gear"]
        assert gear["budget"] == Decimal("1000.00")
        assert gear["amendments"] == Decimal("0.00")
        assert gear["spent"] == Decimal("230.00")

    async def test_a_void_comes_off_from_its_date(self, db_session, books):
        report = await FinanceReportService(db_session).budget_vs_actual(
            books["org_id"], books["fy_id"], date(2026, 4, 30)
        )

        assert _by_line(report)["Gear"]["spent"] == Decimal("170.00")
        assert _by_line(report)["Fuel"]["spent"] == Decimal("55.00")

    async def test_today_adds_commitments_and_checks_the_running_totals(
        self, db_session, books
    ):
        fuel = await db_session.get(Budget, books["fuel"])
        fuel.amount_spent = Decimal("99.00")
        await db_session.flush()

        report = await FinanceReportService(db_session).budget_vs_actual(
            books["org_id"], books["fy_id"]
        )

        gear, fuel_row = _by_line(report)["Gear"], _by_line(report)["Fuel"]
        assert report["includes_committed"] is True
        assert gear["committed"] == Decimal("60.00")
        assert gear["remaining"] == Decimal("1200.00") - Decimal("170.00") - Decimal(
            "60.00"
        )
        assert gear["running_spent_differs"] is False
        assert fuel_row["running_spent"] == Decimal("99.00")
        assert fuel_row["running_spent_differs"] is True

    async def test_over_http_and_as_csv(self, db_session, books):
        async with _client(db_session, books["treasurer"]) as client:
            body = (
                await client.get(
                    "/finance/reports/budget-vs-actual",
                    params={"fiscal_year_id": books["fy_id"], "as_of": "2026-03-31"},
                )
            ).json()
            resp = await client.get(
                "/finance/reports/budget-vs-actual",
                params={
                    "fiscal_year_id": books["fy_id"],
                    "as_of": "2026-03-31",
                    "format": "csv",
                },
            )

        assert body["asOf"] == "2026-03-31"
        assert {r["categoryName"] for r in body["rows"]} == {"Gear", "Fuel"}
        assert resp.status_code == 200, resp.text
        assert resp.headers["content-type"].startswith("text/csv")
        assert "budget-vs-actual" in resp.headers["content-disposition"]
        rows = list(csv.reader(io.StringIO(resp.text)))
        assert rows[0][:3] == ["Budget line", "Station", "Original budget"]
        assert rows[-1][0] == "Total"
        assert rows[-1][5] == "265.00"

    async def test_another_departments_year_is_not_found(self, db_session, books):
        async with _client(db_session, books["outsider"]) as client:
            resp = await client.get(
                "/finance/reports/budget-vs-actual",
                params={"fiscal_year_id": books["fy_id"]},
            )

        assert resp.status_code == 404

    async def test_a_member_without_finance_view_cannot_run_it(self, db_session, books):
        async with _client(db_session, books["member"]) as client:
            resp = await client.get(
                "/finance/reports/budget-vs-actual",
                params={"fiscal_year_id": books["fy_id"]},
            )

        assert resp.status_code == 403


# ============================================
# Amendment log
# ============================================


class TestAmendmentLog:
    async def test_every_amendment_with_who_approved_entered_and_decided(
        self, db_session, books
    ):
        report = await FinanceReportService(db_session).amendment_log(
            books["org_id"], books["fy_id"]
        )

        confirmed, pending = report["rows"]
        assert confirmed["reason"] == "New hose"
        assert confirmed["status"] == "confirmed"
        assert confirmed["entered_by_name"] == "treasurer Test"
        assert confirmed["decided_by_name"] == "president Test"
        assert pending["status"] == "pending"
        assert pending["decided_by_name"] is None
        assert report["confirmed_net"] == Decimal("200.00")

    async def test_as_csv(self, db_session, books):
        async with _client(db_session, books["treasurer"]) as client:
            resp = await client.get(
                "/finance/reports/amendment-log",
                params={"fiscal_year_id": books["fy_id"], "format": "csv"},
            )

        assert resp.status_code == 200, resp.text
        rows = list(csv.reader(io.StringIO(resp.text)))
        assert rows[0][0] == "Entered"
        assert [r[9] for r in rows[1:]] == ["confirmed", "pending"]
        # Entered at 18:00 UTC on March 14: still March 14 in New York.
        assert rows[1][0] == "2026-03-14"


# ============================================
# Payments register
# ============================================


class TestPaymentsRegister:
    async def test_march(self, db_session, books):
        report = await FinanceReportService(db_session).payments_register(
            books["org_id"], date(2026, 3, 1), date(2026, 3, 31)
        )

        assert [(r["number"], r["amount"]) for r in report["rows"]] == [
            ("PR-2026-0001", Decimal("150.00")),
            ("CR-2026-0001", Decimal("80.00")),
            ("ER-2026-0001", Decimal("35.00")),
        ]
        assert report["total"] == Decimal("265.00")
        purchase = report["rows"][0]
        assert purchase["payee"] == "Hose Supply Co"
        assert purchase["budget_line"] == "Gear, FY2026"
        assert report["rows"][2]["budget_line"] == "Fuel, FY2026, Gear, FY2026"

    async def test_april_shows_the_void_as_a_negative_row(self, db_session, books):
        report = await FinanceReportService(db_session).payments_register(
            books["org_id"], date(2026, 4, 1), date(2026, 4, 30)
        )

        assert [(r["kind"], r["amount"]) for r in report["rows"]] == [
            ("check_void", Decimal("-80.00")),
            ("check_request", Decimal("40.00")),
        ]
        assert report["total"] == Decimal("-40.00")

    async def test_it_reconciles_with_budget_vs_actual(self, db_session, books):
        service = FinanceReportService(db_session)
        register = await service.payments_register(
            books["org_id"], date(2026, 1, 1), date(2026, 4, 30)
        )
        report = await service.budget_vs_actual(
            books["org_id"], books["fy_id"], date(2026, 4, 30)
        )

        assert register["total"] == report["totals"]["spent"]

    async def test_a_late_evening_payment_is_on_the_departments_day(
        self, db_session, books
    ):
        pr = await db_session.get(
            PurchaseRequest,
            (
                await db_session.execute(
                    text("SELECT id FROM purchase_requests WHERE request_number = :n"),
                    {"n": "PR-2026-0001"},
                )
            ).scalar_one(),
        )
        # 10 PM on March 31 in New York.
        pr.paid_at = utc(2026, 4, 1, 2)
        await db_session.flush()

        march = await FinanceReportService(db_session).payments_register(
            books["org_id"], date(2026, 3, 1), date(2026, 3, 31)
        )

        assert march["rows"][-1]["number"] == "PR-2026-0001"
        assert march["rows"][-1]["paid_on"] == date(2026, 3, 31)

    @pytest.mark.parametrize(
        ("start", "end", "message"),
        [
            ("2026-03-31", "2026-03-01", "on or after"),
            ("2025-01-01", "2026-03-01", "at most 366 days"),
        ],
    )
    async def test_a_bad_period_is_refused(
        self, db_session, books, start, end, message
    ):
        async with _client(db_session, books["treasurer"]) as client:
            resp = await client.get(
                "/finance/reports/payments-register",
                params={"start": start, "end": end},
            )

        assert resp.status_code == 400
        assert message in resp.json()["detail"]

    async def test_as_csv_with_a_total(self, db_session, books):
        async with _client(db_session, books["treasurer"]) as client:
            resp = await client.get(
                "/finance/reports/payments-register",
                params={"start": "2026-04-01", "end": "2026-04-30", "format": "csv"},
            )

        assert resp.status_code == 200, resp.text
        rows = list(csv.reader(io.StringIO(resp.text)))
        assert rows[1][1] == "Check voided"
        assert rows[-1][-2:] == ["Total", "-40.00"]

    async def test_another_departments_payments_are_not_listed(self, db_session, books):
        async with _client(db_session, books["outsider"]) as client:
            resp = await client.get(
                "/finance/reports/payments-register",
                params={"start": "2026-03-01", "end": "2026-04-30"},
            )

        assert resp.status_code == 200
        assert resp.json()["rows"] == []

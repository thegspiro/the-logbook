"""Functional expense classification: program, management & general, fundraising.

Owner decision, 2026-10-13: a budget category carries the default class for
payments against its lines (a subcategory with none inherits its parent's),
and the finance office can override it on one purchase, check or expense
line. Functional expenses reports a period's payments by class, then by
category — the same payments as the payments register, so the totals agree.

The department, all paid in March 2026 unless noted:

* Operations (program) > Turnout gear (inherits program): a 100.00 purchase,
  and a 15.00 expense line overridden to fundraising.
* Insurance (management & general): a 50.00 check.
* Raffle (fundraising): a 30.00 check, voided in the same month.
* Supplies (no class): a 20.00 expense line — unclassified.
* A 10.00 purchase with no budget line — unclassified, no category.
"""

import csv
import io
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.models.finance import (
    Budget,
    BudgetCategory,
    CheckRequest,
    CheckRequestStatus,
    ExpenseLineItem,
    ExpenseReport,
    ExpenseReportStatus,
    FiscalYearStatus,
    FunctionalClass,
    PurchaseRequest,
    PurchaseRequestStatus,
)
from app.schemas.finance import FunctionalClassUpdate
from app.services.finance_report_service import FinanceReportService
from app.services.functional_expenses import FunctionalClassifier, _Category
from tests.test_finance_budget_owners import _client, _org, _position, _user, _year

FC = FunctionalClass
MARCH = (date(2026, 3, 1), date(2026, 3, 31))


def utc(*args) -> datetime:
    return datetime(*args, tzinfo=timezone.utc)


# ============================================
# The resolver, no database
# ============================================


@pytest.mark.unit
class TestResolving:
    classifier = FunctionalClassifier(
        {
            "ops": _Category("Operations", FC.PROGRAM, None),
            "gear": _Category("Turnout gear", None, "ops"),
            "boots": _Category("Boots", None, "gear"),
            "misc": _Category("Supplies", None, None),
            "loop-a": _Category("A", None, "loop-b"),
            "loop-b": _Category("B", None, "loop-a"),
        },
        {"line-boots": "boots", "line-misc": "misc", "line-loop": "loop-a"},
    )

    def test_a_subcategory_inherits_its_nearest_classified_ancestor(self):
        assert self.classifier.resolve(None, "line-boots") == FC.PROGRAM

    def test_an_override_wins(self):
        assert self.classifier.resolve(FC.FUNDRAISING, "line-boots") == FC.FUNDRAISING

    def test_no_class_anywhere_is_unclassified(self):
        assert self.classifier.resolve(None, "line-misc") is None
        assert self.classifier.resolve(None, None) is None

    def test_a_cycle_written_by_hand_ends(self):
        assert self.classifier.resolve(None, "line-loop") is None

    def test_the_override_accepts_only_the_three_classes_or_null(self):
        assert (
            FunctionalClassUpdate.model_validate(
                {"functionalClass": None}
            ).functional_class
            is None
        )
        with pytest.raises(ValidationError):
            FunctionalClassUpdate.model_validate({"functionalClass": "operations"})


# ============================================
# Fixtures
# ============================================


@pytest.fixture
async def books(db_session):
    org_id = await _org(db_session, "func")
    other_org = await _org(db_session, "else")
    treasurer_pos = await _position(
        db_session, org_id, "Treasurer", ["finance.view", "finance.manage"]
    )
    viewer_pos = await _position(db_session, org_id, "Trustee", ["finance.view"])
    foreign_pos = await _position(
        db_session, other_org, "Treasurer", ["finance.view", "finance.manage"]
    )
    treasurer = await _user(db_session, org_id, "treasurer", [treasurer_pos])
    trustee = await _user(db_session, org_id, "trustee", [viewer_pos])
    outsider = await _user(db_session, other_org, "outsider", [foreign_pos])

    year = _year(org_id, "FY2026", FiscalYearStatus.ACTIVE, treasurer.id, 2026)
    ops = BudgetCategory(
        organization_id=org_id, name="Operations", functional_class=FC.PROGRAM
    )
    db_session.add_all([year, ops])
    await db_session.flush()
    gear = BudgetCategory(
        organization_id=org_id, name="Turnout gear", parent_category_id=ops.id
    )
    insurance = BudgetCategory(
        organization_id=org_id,
        name="Insurance",
        functional_class=FC.MANAGEMENT_GENERAL,
    )
    raffle = BudgetCategory(
        organization_id=org_id, name="Raffle", functional_class=FC.FUNDRAISING
    )
    supplies = BudgetCategory(organization_id=org_id, name="Supplies")
    db_session.add_all([gear, insurance, raffle, supplies])
    await db_session.flush()

    def line(category):
        return Budget(
            organization_id=org_id,
            fiscal_year_id=year.id,
            category_id=category.id,
            amount_budgeted=Decimal("1000.00"),
            created_by=treasurer.id,
        )

    gear_line, ins_line, raffle_line, sup_line = (
        line(gear),
        line(insurance),
        line(raffle),
        line(supplies),
    )
    db_session.add_all([gear_line, ins_line, raffle_line, sup_line])
    await db_session.flush()

    common = {"organization_id": org_id, "fiscal_year_id": year.id}
    gear_purchase = PurchaseRequest(
        **common,
        request_number="PR-2026-0001",
        budget_id=gear_line.id,
        requested_by=trustee.id,
        title="Helmets",
        estimated_amount=Decimal("100.00"),
        status=PurchaseRequestStatus.PAID,
        paid_at=utc(2026, 3, 5, 15),
    )
    loose_purchase = PurchaseRequest(
        **common,
        request_number="PR-2026-0002",
        requested_by=trustee.id,
        title="Stamps",
        estimated_amount=Decimal("10.00"),
        status=PurchaseRequestStatus.PAID,
        paid_at=utc(2026, 3, 6, 15),
    )
    insurance_check = CheckRequest(
        **common,
        request_number="CR-2026-0001",
        budget_id=ins_line.id,
        requested_by=trustee.id,
        payee_name="Mutual Insurance",
        amount=Decimal("50.00"),
        status=CheckRequestStatus.ISSUED,
        check_date=utc(2026, 3, 7, 15),
    )
    raffle_check = CheckRequest(
        **common,
        request_number="CR-2026-0002",
        budget_id=raffle_line.id,
        requested_by=trustee.id,
        payee_name="Ticket Printer",
        amount=Decimal("30.00"),
        status=CheckRequestStatus.VOIDED,
        check_date=utc(2026, 3, 8, 15),
        voided_at=utc(2026, 3, 9, 15),
    )
    report = ExpenseReport(
        **common,
        report_number="ER-2026-0001",
        submitted_by=trustee.id,
        title="Mixed",
        total_amount=Decimal("35.00"),
        status=ExpenseReportStatus.PAID,
        paid_at=utc(2026, 3, 10, 15),
    )
    db_session.add_all(
        [gear_purchase, loose_purchase, insurance_check, raffle_check, report]
    )
    await db_session.flush()
    raffle_prizes = ExpenseLineItem(
        expense_report_id=report.id,
        budget_id=gear_line.id,
        description="Raffle prize gloves",
        amount=Decimal("15.00"),
        date_incurred=utc(2026, 3, 1),
        functional_class=FC.FUNDRAISING,
    )
    tape = ExpenseLineItem(
        expense_report_id=report.id,
        budget_id=sup_line.id,
        description="Tape",
        amount=Decimal("20.00"),
        date_incurred=utc(2026, 3, 1),
    )
    db_session.add_all([raffle_prizes, tape])
    await db_session.flush()
    return {
        "org_id": org_id,
        "treasurer": treasurer,
        "trustee": trustee,
        "outsider": outsider,
        "gear_purchase": gear_purchase.id,
        "insurance_check": insurance_check.id,
        "report": report.id,
        "tape": tape.id,
        "raffle_prizes": raffle_prizes.id,
        "supplies": supplies.id,
    }


def _by_class(report) -> dict:
    return {
        c["functional_class"]: {
            "total": c["total"],
            "categories": {
                cat["category_name"]: cat["amount"] for cat in c["categories"]
            },
        }
        for c in report["classes"]
    }


# ============================================
# The report
# ============================================


@pytest.mark.integration
class TestTheReport:
    async def test_march_by_function_then_category(self, db_session, books):
        report = await FinanceReportService(db_session).functional_expenses(
            books["org_id"], *MARCH
        )

        classes = _by_class(report)
        assert classes["program"] == {
            "total": Decimal("100.00"),
            "categories": {"Turnout gear": Decimal("100.00")},
        }
        assert classes["management_general"]["total"] == Decimal("50.00")
        # The raffle check was voided in March, so it nets to nothing; the
        # gloves were moved to fundraising from their category's program.
        assert classes["fundraising"]["categories"] == {
            "Raffle": Decimal("0.00"),
            "Turnout gear": Decimal("15.00"),
        }
        assert classes[None]["categories"] == {
            "Supplies": Decimal("20.00"),
            None: Decimal("10.00"),
        }
        assert report["total"] == Decimal("195.00")

    async def test_it_agrees_with_the_payments_register(self, db_session, books):
        service = FinanceReportService(db_session)
        register = await service.payments_register(books["org_id"], *MARCH)
        report = await service.functional_expenses(books["org_id"], *MARCH)

        assert report["total"] == register["total"]

    async def test_every_class_is_listed_even_when_empty(self, db_session, books):
        report = await FinanceReportService(db_session).functional_expenses(
            books["org_id"], date(2026, 1, 1), date(2026, 1, 31)
        )

        assert [c["functional_class"] for c in report["classes"]] == [
            "program",
            "management_general",
            "fundraising",
        ]
        assert report["total"] == Decimal("0.00")

    async def test_as_csv_with_subtotals(self, db_session, books):
        async with _client(db_session, books["trustee"]) as client:
            resp = await client.get(
                "/finance/reports/functional-expenses",
                params={"start": "2026-03-01", "end": "2026-03-31", "format": "csv"},
            )

        assert resp.status_code == 200, resp.text
        rows = list(csv.reader(io.StringIO(resp.text)))
        assert rows[0] == ["Function", "Budget category", "Amount"]
        assert ["Program services", "Subtotal", "100.00"] in rows
        assert ["Unclassified", "No budget line", "10.00"] in rows
        assert rows[-1] == ["Total", "", "195.00"]

    async def test_another_department_sees_none_of_it(self, db_session, books):
        async with _client(db_session, books["outsider"]) as client:
            resp = await client.get(
                "/finance/reports/functional-expenses",
                params={"start": "2026-03-01", "end": "2026-03-31"},
            )

        assert resp.status_code == 200
        assert resp.json()["total"] == "0.00"


# ============================================
# Setting it
# ============================================


@pytest.mark.integration
class TestSettingIt:
    async def test_the_category_carries_it(self, db_session, books):
        async with _client(db_session, books["treasurer"]) as client:
            created = await client.post(
                "/finance/budget-categories",
                json={"name": "Hall rental", "functionalClass": "fundraising"},
            )
            cleared = await client.put(
                f"/finance/budget-categories/{books['supplies']}",
                json={"functionalClass": "management_general"},
            )

        assert created.status_code in (200, 201), created.text
        assert created.json()["functionalClass"] == "fundraising"
        assert cleared.status_code == 200, cleared.text
        assert cleared.json()["functionalClass"] == "management_general"

    async def test_an_override_moves_one_payment_and_clears_back(
        self, db_session, books
    ):
        url = f"/finance/purchase-requests/{books['gear_purchase']}/functional-class"
        async with _client(db_session, books["treasurer"]) as client:
            set_resp = await client.put(url, json={"functionalClass": "fundraising"})
            moved = (
                await client.get(f"/finance/purchase-requests/{books['gear_purchase']}")
            ).json()
            await client.put(url, json={"functionalClass": None})
            back = (
                await client.get(f"/finance/purchase-requests/{books['gear_purchase']}")
            ).json()

        assert set_resp.status_code == 204, set_resp.text
        assert moved["functionalClass"] == "fundraising"
        assert moved["effectiveFunctionalClass"] == "fundraising"
        assert back["functionalClass"] is None
        # Back to Turnout gear's inherited Operations class.
        assert back["effectiveFunctionalClass"] == "program"

    async def test_an_expense_line_is_classified_through_its_report(
        self, db_session, books
    ):
        async with _client(db_session, books["treasurer"]) as client:
            resp = await client.put(
                f"/finance/expense-reports/{books['report']}/items/{books['tape']}"
                "/functional-class",
                json={"functionalClass": "program"},
            )
            detail = (
                await client.get(f"/finance/expense-reports/{books['report']}")
            ).json()

        assert resp.status_code == 204, resp.text
        effective = {
            item["description"]: item["effectiveFunctionalClass"]
            for item in detail["lineItems"]
        }
        assert effective == {"Tape": "program", "Raffle prize gloves": "fundraising"}

    async def test_a_check_override_counts_in_the_report(self, db_session, books):
        async with _client(db_session, books["treasurer"]) as client:
            await client.put(
                f"/finance/check-requests/{books['insurance_check']}/functional-class",
                json={"functionalClass": "program"},
            )
        report = await FinanceReportService(db_session).functional_expenses(
            books["org_id"], *MARCH
        )

        assert _by_class(report)["program"]["categories"]["Insurance"] == Decimal(
            "50.00"
        )

    async def test_finance_view_alone_cannot_set_it(self, db_session, books):
        async with _client(db_session, books["trustee"]) as client:
            resp = await client.put(
                f"/finance/purchase-requests/{books['gear_purchase']}/functional-class",
                json={"functionalClass": "program"},
            )

        assert resp.status_code == 403

    async def test_another_departments_payment_is_not_found(self, db_session, books):
        async with _client(db_session, books["outsider"]) as client:
            resp = await client.put(
                f"/finance/purchase-requests/{books['gear_purchase']}/functional-class",
                json={"functionalClass": "program"},
            )
            line = await client.put(
                f"/finance/expense-reports/{books['report']}/items/{books['tape']}"
                "/functional-class",
                json={"functionalClass": "program"},
            )

        assert resp.status_code == 404
        assert line.status_code == 404

"""A budget-line owner's own view: "My budgets", the line, its transactions.

A line is owned by a position, and a line with no owner of its own inherits
its category's (``finance_budget_ownership``, the one definition of the rule).
Owners see their lines in every fiscal year, closed ones included, without
``finance.view`` — and only read them: amounts, owners, stations and
amendments stay ``finance.manage``'s (owner decisions, 2026-10-08).

Pinned here:

* ``GET /finance/my-budgets`` lists exactly the caller's lines — via their own
  position, via category inheritance, with a line's own owner overriding the
  category's — across draft, active and closed years, newest year first; an
  inactive member, a member who owns nothing and another department's member
  get an empty list, never a 403; ``/my-budgets/summary`` says whether there
  is anything to list;
* the line's detail, amendments and transactions open to ``finance.view`` or
  the line's owner, and are 404 to anyone else and across departments; the
  owner still cannot edit the line or record an amendment (403);
* the transaction list is what moved the line's totals: its spent and
  encumbered rows add up to ``amount_spent`` / ``amount_encumbered`` after the
  real approve / pay / issue / void flows ran, newest first, paginated.
"""

from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import (
    ApprovalEntityType,
    Budget,
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
from app.services.finance_service import FinanceService
from tests.test_finance_budget_owners import (
    _client,
    _org,
    _position,
    _station,
    _user,
    _year,
)

pytestmark = pytest.mark.integration


def _at(month: int, day: int) -> datetime:
    return datetime(2026, month, day, 12, 0, tzinfo=timezone.utc)


@pytest.fixture
async def dept(db_session: AsyncSession):
    """Owners, a viewer, a plain member, three years and a second department."""
    org_id = await _org(db_session, "mine")
    other_org = await _org(db_session, "theirs")

    treasurer_pos = await _position(
        db_session, org_id, "Treasurer", ["finance.view", "finance.manage"]
    )
    viewer_pos = await _position(db_session, org_id, "Finance Viewer", ["finance.view"])
    training_officer = await _position(
        db_session, org_id, "Training Officer", ["finance.request"]
    )
    chief = await _position(db_session, org_id, "Chief", ["finance.request"])
    firefighter = await _position(
        db_session, org_id, "Firefighter", ["finance.request"]
    )
    foreign_pos = await _position(db_session, other_org, "Their Chief", [])
    foreign_admin_pos = await _position(
        db_session, other_org, "Their Treasurer", ["finance.*"]
    )

    people = {
        "treasurer": await _user(db_session, org_id, "treasurer", [treasurer_pos]),
        "viewer": await _user(db_session, org_id, "viewer", [viewer_pos]),
        "trainer": await _user(db_session, org_id, "trainer", [training_officer]),
        "chief": await _user(db_session, org_id, "chief", [chief]),
        "member": await _user(db_session, org_id, "alice", [firefighter]),
        "former": await _user(
            db_session, org_id, "former", [training_officer], status="inactive"
        ),
        "outsider": await _user(db_session, other_org, "outsider", [foreign_pos]),
        "outsider_admin": await _user(
            db_session, other_org, "their-treasurer", [foreign_admin_pos]
        ),
    }
    treasurer_id = people["treasurer"].id

    active = _year(org_id, "FY2026", FiscalYearStatus.ACTIVE, treasurer_id, 2026)
    draft = _year(org_id, "FY2027", FiscalYearStatus.DRAFT, treasurer_id, 2027)
    closed = _year(org_id, "FY2025", FiscalYearStatus.CLOSED, treasurer_id, 2025)
    training = BudgetCategory(
        organization_id=org_id, name="Training", owner_position_id=training_officer
    )
    gear = BudgetCategory(organization_id=org_id, name="Gear")
    db_session.add_all([active, draft, closed, training, gear])
    await db_session.flush()
    station = await _station(db_session, org_id, "Station 2")

    def line(fy, category, amount, **kw):
        return Budget(
            organization_id=org_id,
            fiscal_year_id=fy.id,
            category_id=category.id,
            amount_budgeted=Decimal(amount),
            created_by=treasurer_id,
            **kw,
        )

    lines = {
        # Inherits Training Officer from its category.
        "training": line(
            active,
            training,
            "2000.00",
            amount_spent=Decimal("500.00"),
            amount_encumbered=Decimal("250.00"),
        ),
        "training_next_year": line(draft, training, "2100.00"),
        "training_last_year": line(closed, training, "1500.00"),
        # Its own owner overrides the category's.
        "training_chief": line(
            active, training, "300.00", owner_position_id=chief, station_id=station
        ),
        # Nobody's — the transactions tests run against this one.
        "gear": line(active, gear, "5000.00"),
        "gear_other": line(active, gear, "900.00"),
    }
    db_session.add_all(lines.values())
    await db_session.flush()
    return {
        "org_id": org_id,
        "other_org": other_org,
        "fy": active.id,
        "draft_fy": draft.id,
        "closed_fy": closed.id,
        "foreign_pos": foreign_pos,
        "lines": {k: v.id for k, v in lines.items()},
        **people,
    }


async def _get(db, user, path):
    async with _client(db, user) as client:
        return await client.get(path)


# ============================================
# GET /finance/my-budgets
# ============================================


class TestMyBudgets:
    async def test_the_category_owner_sees_inherited_lines_in_every_year(
        self, db_session, dept
    ):
        resp = await _get(db_session, dept["trainer"], "/finance/my-budgets")
        assert resp.status_code == 200
        rows = resp.json()
        lines = dept["lines"]
        # Newest year first: the draft FY2027, the active FY2026, closed FY2025.
        assert [r["id"] for r in rows] == [
            lines["training_next_year"],
            lines["training"],
            lines["training_last_year"],
        ]
        assert [r["fiscalYearStatus"] for r in rows] == ["draft", "active", "closed"]
        current = rows[1]
        assert current["fiscalYearName"] == "FY2026"
        assert current["categoryName"] == "Training"
        assert current["effectiveOwnerPositionName"] == "Training Officer"
        assert current["ownerInherited"] is True
        assert Decimal(current["amountRemaining"]) == Decimal("1250.00")
        assert current["percentUsed"] == 37.5
        assert Decimal(current["originalAmount"]) == Decimal("2000.00")

    async def test_a_lines_own_owner_overrides_the_category_owner(
        self, db_session, dept
    ):
        rows = (await _get(db_session, dept["chief"], "/finance/my-budgets")).json()
        assert [r["id"] for r in rows] == [dept["lines"]["training_chief"]]
        assert rows[0]["ownerInherited"] is False
        assert rows[0]["effectiveOwnerPositionName"] == "Chief"
        assert rows[0]["stationName"] == "Station 2"

    async def test_filters_by_fiscal_year(self, db_session, dept):
        resp = await _get(
            db_session,
            dept["trainer"],
            f"/finance/my-budgets?fiscal_year_id={dept['closed_fy']}",
        )
        assert [r["id"] for r in resp.json()] == [dept["lines"]["training_last_year"]]

    @pytest.mark.parametrize("person", ["member", "former", "viewer", "treasurer"])
    async def test_someone_who_owns_nothing_gets_an_empty_list(
        self, db_session, dept, person
    ):
        resp = await _get(db_session, dept[person], "/finance/my-budgets")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_another_department_never_sees_these_lines(self, db_session, dept):
        # Even a line that somehow stores the other department's position id.
        line = await db_session.get(Budget, dept["lines"]["gear"])
        line.owner_position_id = dept["foreign_pos"]
        await db_session.flush()
        resp = await _get(db_session, dept["outsider"], "/finance/my-budgets")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_summary_says_whether_the_caller_owns_anything(
        self, db_session, dept
    ):
        owner = await _get(db_session, dept["trainer"], "/finance/my-budgets/summary")
        member = await _get(db_session, dept["member"], "/finance/my-budgets/summary")
        former = await _get(db_session, dept["former"], "/finance/my-budgets/summary")
        assert owner.json() == {"ownsAny": True}
        assert member.json() == {"ownsAny": False}
        assert former.json() == {"ownsAny": False}


# ============================================
# Who reads a line
# ============================================

READ_PATHS = ["", "/amendments", "/transactions"]


class TestBudgetReadAccess:
    @pytest.mark.parametrize("suffix", READ_PATHS)
    async def test_a_finance_viewer_reads_any_line(self, db_session, dept, suffix):
        line = dept["lines"]["gear"]
        resp = await _get(
            db_session, dept["viewer"], f"/finance/budgets/{line}{suffix}"
        )
        assert resp.status_code == 200

    @pytest.mark.parametrize("suffix", READ_PATHS)
    @pytest.mark.parametrize("line_key", ["training", "training_last_year"])
    async def test_the_owner_reads_their_line_in_any_year(
        self, db_session, dept, suffix, line_key
    ):
        line = dept["lines"][line_key]
        resp = await _get(
            db_session, dept["trainer"], f"/finance/budgets/{line}{suffix}"
        )
        assert resp.status_code == 200

    async def test_the_owner_gets_the_lines_names(self, db_session, dept):
        line = dept["lines"]["training"]
        body = (
            await _get(db_session, dept["trainer"], f"/finance/budgets/{line}")
        ).json()
        assert body["categoryName"] == "Training"
        assert body["fiscalYearName"] == "FY2026"

    @pytest.mark.parametrize("suffix", READ_PATHS)
    @pytest.mark.parametrize(
        ("person", "line_key"),
        [
            ("member", "training"),  # owns nothing
            ("trainer", "training_chief"),  # the category's owner, overridden
            ("trainer", "gear"),  # someone else's category
            ("former", "training"),  # held the position, no longer active
            ("outsider", "training"),  # another department
            ("outsider_admin", "training"),  # another department's finance.*
        ],
    )
    async def test_anyone_else_is_told_the_line_does_not_exist(
        self, db_session, dept, suffix, person, line_key
    ):
        line = dept["lines"][line_key]
        resp = await _get(db_session, dept[person], f"/finance/budgets/{line}{suffix}")
        assert resp.status_code == 404

    async def test_ownership_opens_no_write(self, db_session, dept):
        line = dept["lines"]["training"]
        async with _client(db_session, dept["trainer"]) as client:
            put = await client.put(
                f"/finance/budgets/{line}", json={"amountBudgeted": "9999.00"}
            )
            amend = await client.post(
                f"/finance/budgets/{line}/amendments",
                json={
                    "amount": "100.00",
                    "reason": "More training",
                    "approvedBy": "Board",
                    "approvedOn": date(2026, 3, 1).isoformat(),
                },
            )
            listing = await client.get("/finance/budgets")
        assert put.status_code == 403
        assert amend.status_code == 403
        # The org-wide list stays behind finance.view.
        assert listing.status_code == 403


# ============================================
# GET /finance/budgets/{id}/transactions
# ============================================


@pytest.fixture
async def movements(db_session: AsyncSession, dept):
    """Run the real approve / pay / issue / void / reimburse flows on "gear".

    Each date is then pinned so the order is deterministic.
    """
    org_id = dept["org_id"]
    line = dept["lines"]["gear"]
    other_line = dept["lines"]["gear_other"]
    member = dept["member"].id
    treasurer = dept["treasurer"].id
    service = FinanceService(db_session)

    def pr(number, amount, status=PurchaseRequestStatus.PENDING_APPROVAL):
        return PurchaseRequest(
            organization_id=org_id,
            request_number=number,
            fiscal_year_id=dept["fy"],
            budget_id=line,
            requested_by=member,
            title=f"Purchase {number}",
            vendor="Hose Supply Co",
            estimated_amount=Decimal(amount),
            status=status,
        )

    def cr(number, amount):
        return CheckRequest(
            organization_id=org_id,
            request_number=number,
            fiscal_year_id=dept["fy"],
            budget_id=line,
            requested_by=member,
            payee_name="County Training Center",
            payee_address="1 Main St",
            amount=Decimal(amount),
            memo=f"Check {number}",
            status=CheckRequestStatus.APPROVED,
        )

    approved = pr("PR-0001", "100.00")
    paid = pr("PR-0002", "200.00")
    cancelled = pr("PR-0003", "75.00")
    draft = pr("PR-0004", "60.00", status=PurchaseRequestStatus.DRAFT)
    issued = cr("CR-0001", "30.00")
    voided = cr("CR-0002", "20.00")
    report = ExpenseReport(
        organization_id=org_id,
        report_number="ER-0001",
        submitted_by=member,
        fiscal_year_id=dept["fy"],
        title="Conference",
        total_amount=Decimal("55.00"),
        status=ExpenseReportStatus.APPROVED,
    )
    db_session.add_all([approved, paid, cancelled, draft, issued, voided, report])
    await db_session.flush()
    db_session.add_all(
        [
            ExpenseLineItem(
                expense_report_id=report.id,
                budget_id=line,
                description="Registration",
                merchant="State Fire Assn",
                amount=Decimal("40.00"),
                date_incurred=_at(3, 12),
            ),
            # Charged to a different line: not this one's transaction.
            ExpenseLineItem(
                expense_report_id=report.id,
                budget_id=other_line,
                description="Parking",
                amount=Decimal("15.00"),
                date_incurred=_at(3, 12),
            ),
        ]
    )
    await db_session.flush()

    for request in (approved, paid, cancelled):
        await service._finalize_approval(
            ApprovalEntityType.PURCHASE_REQUEST, request.id, treasurer, org_id
        )
    await service.mark_pr_paid(
        paid.id, org_id, actual_amount=Decimal("180.00"), acted_by=treasurer
    )
    await service.cancel_purchase_request(cancelled.id, org_id)
    await service.issue_check(issued.id, org_id, "1001", acted_by=treasurer)
    await service.issue_check(voided.id, org_id, "1002", acted_by=treasurer)
    await service.void_check(voided.id, org_id)
    await service.mark_expense_paid(report.id, org_id, acted_by=treasurer)

    approved.approved_at = _at(3, 1)
    paid.paid_at = _at(3, 5)
    issued.check_date = _at(3, 10)
    voided.check_date = _at(2, 1)
    report.paid_at = _at(3, 15)
    await db_session.flush()
    return {"line": line}


class TestTransactions:
    async def test_lists_what_moved_the_line_newest_first(
        self, db_session, dept, movements
    ):
        resp = await _get(
            db_session,
            dept["viewer"],
            f"/finance/budgets/{movements['line']}/transactions",
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 5
        rows = body["items"]
        assert [(r["number"], r["effect"]) for r in rows] == [
            ("ER-0001", "spent"),
            ("CR-0001", "spent"),
            ("PR-0002", "spent"),
            ("PR-0001", "encumbered"),
            ("CR-0002", "none"),
        ]
        expense, check, purchase_paid, purchase_open, void = rows
        assert expense["kind"] == "expense_report"
        assert expense["description"] == "Registration"
        assert expense["counterparty"] == "State Fire Assn"
        assert Decimal(expense["amount"]) == Decimal("40.00")
        assert check["counterparty"] == "County Training Center"
        assert check["status"] == "issued"
        assert Decimal(purchase_paid["amount"]) == Decimal("180.00")
        assert purchase_open["status"] == "approved"
        assert void["status"] == "voided"
        assert all(r["requesterName"].startswith("alice") for r in rows)
        # Requester only: no payee address, check number or payment method.
        for row in rows:
            assert not {"payeeAddress", "checkNumber", "paymentMethod"} & row.keys()

    async def test_the_listed_rows_add_up_to_the_lines_totals(
        self, db_session, dept, movements
    ):
        line = await db_session.get(Budget, movements["line"])
        await db_session.refresh(line)
        assert line.amount_spent == Decimal("250.00")
        assert line.amount_encumbered == Decimal("100.00")

        body = (
            await _get(
                db_session,
                dept["viewer"],
                f"/finance/budgets/{movements['line']}/transactions?limit=100",
            )
        ).json()

        def total(effect):
            return sum(
                (Decimal(r["amount"]) for r in body["items"] if r["effect"] == effect),
                Decimal("0"),
            )

        assert total("spent") == line.amount_spent
        assert total("encumbered") == line.amount_encumbered

    async def test_paginates(self, db_session, dept, movements):
        body = (
            await _get(
                db_session,
                dept["viewer"],
                f"/finance/budgets/{movements['line']}/transactions?limit=2&offset=2",
            )
        ).json()
        assert body["total"] == 5
        assert (body["limit"], body["offset"]) == (2, 2)
        assert [r["number"] for r in body["items"]] == ["PR-0002", "PR-0001"]

    async def test_a_line_with_no_movements_is_empty(self, db_session, dept, movements):
        body = (
            await _get(
                db_session,
                dept["viewer"],
                f"/finance/budgets/{dept['lines']['training_chief']}/transactions",
            )
        ).json()
        assert body == {"items": [], "total": 0, "limit": 25, "offset": 0}

    async def test_another_departments_finance_admin_sees_none_of_it(
        self, db_session, dept, movements
    ):
        resp = await _get(
            db_session,
            dept["outsider_admin"],
            f"/finance/budgets/{movements['line']}/transactions",
        )
        assert resp.status_code == 404

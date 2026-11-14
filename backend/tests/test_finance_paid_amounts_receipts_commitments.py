"""Owner decisions of 2026-11-01 on paying finance requests.

* **Mark Paid asks for the amount.** A purchase request records what was
  actually paid, shows the difference from the approved amount, and its
  budget line spends what was paid, not what was approved.
* **A receipt before payment.** A purchase request is not marked paid, and a
  check is not issued, without an uploaded receipt -- except an advance's and
  a reimbursement check's, whose receipts are the expense report's lines.
* **The member picks the line, approval commits it.** An expense report's
  lines name the budget lines they charge; approval encumbers them there, as
  a purchase request's approval does, and payment, cancellation and a voided
  check release exactly that.

The department is make_books' (Training $1,000 and Fuel $500 lines) plus a
member who raises the requests and a receipt document to attach.
"""

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import patch

import pytest
from sqlalchemy import select

from app.models.document import Document
from app.models.finance import (
    ApprovalEntityType,
    Budget,
    CheckRequest,
    CheckRequestStatus,
    ExpenseLineItem,
    ExpenseReport,
    ExpenseReportStatus,
    PurchaseRequestStatus,
)
from app.schemas.finance import (
    CheckRequestResponse,
    ExpenseReportResponse,
    PurchaseRequestResponse,
)
from app.services.documents_service import DocumentsService
from app.services.finance_service import (
    BudgetLimitExceededError,
    FinanceService,
    ReceiptRequiredError,
)
from tests.test_finance_quickbooks_export import PAID, _user, make_books
from tests.test_finance_reimbursement_flow import _client_as

pytestmark = [pytest.mark.integration]


@pytest.fixture
async def dept(db_session):
    books = await make_books(db_session)
    lines = (
        await db_session.execute(
            select(Budget).where(Budget.organization_id == books["org_id"])
        )
    ).scalars()
    budgets = {b.category_id: b for b in lines}
    books["training_line"] = budgets[books["training"].id]
    books["fuel_line"] = next(
        b for b in budgets.values() if b.id != books["training_line"].id
    )
    books["fy_id"] = books["training_line"].fiscal_year_id
    books["member_id"] = await _user(db_session, books["org_id"])
    books["receipt_id"] = await _receipt(db_session, books["org_id"])
    return books


async def _receipt(db, org_id) -> str:
    receipt = Document(organization_id=org_id, name="Receipt", file_name="r.pdf")
    db.add(receipt)
    await db.flush()
    return receipt.id


async def _line(db, line: Budget) -> Budget:
    await db.refresh(line)
    return line


async def _figures(db, line: Budget) -> tuple[Decimal, Decimal]:
    line = await _line(db, line)
    return Decimal(line.amount_spent), Decimal(line.amount_encumbered)


async def _approved_purchase(db, dept, *, receipt=True, estimate="200.00"):
    """Submitted and approved by the treasurer, so its estimate is encumbered
    the way approval leaves it."""
    service = FinanceService(db)
    pr = await service.create_purchase_request(
        dept["org_id"],
        dept["member_id"],
        fiscal_year_id=dept["fy_id"],
        budget_id=dept["training_line"].id,
        title="Hose nozzles",
        estimated_amount=Decimal(estimate),
    )
    await service.submit_purchase_request(pr.id, dept["org_id"], dept["member_id"])
    await service.manual_approve(
        ApprovalEntityType.PURCHASE_REQUEST,
        pr.id,
        dept["user_id"],
        org_id=dept["org_id"],
    )
    if receipt:
        pr.receipt_document_id = dept["receipt_id"]
        await db.flush()
    await db.refresh(pr)
    return pr


# ============================================================================
# 1. Mark Paid asks for the amount
# ============================================================================


class TestThePaidAmount:
    async def test_paying_more_than_approved_spends_what_was_paid(
        self, db_session, dept
    ):
        spent, encumbered = await _figures(db_session, dept["training_line"])
        pr = await _approved_purchase(db_session, dept)
        assert await _figures(db_session, dept["training_line"]) == (
            spent,
            encumbered + Decimal("200.00"),
        )

        paid = await FinanceService(db_session).mark_pr_paid(
            pr.id, dept["org_id"], Decimal("230.00"), acted_by=dept["user_id"]
        )

        assert paid.status == PurchaseRequestStatus.PAID
        assert paid.actual_amount == Decimal("230.00")
        # The whole estimate is released and the paid amount spent.
        assert await _figures(db_session, dept["training_line"]) == (
            spent + Decimal("230.00"),
            encumbered,
        )
        assert PurchaseRequestResponse.model_validate(paid).paid_difference == Decimal(
            "30.00"
        )

    async def test_paying_less_reports_a_negative_difference(self, db_session, dept):
        spent, encumbered = await _figures(db_session, dept["training_line"])
        pr = await _approved_purchase(db_session, dept)

        paid = await FinanceService(db_session).mark_pr_paid(
            pr.id, dept["org_id"], Decimal("185.50"), acted_by=dept["user_id"]
        )

        assert await _figures(db_session, dept["training_line"]) == (
            spent + Decimal("185.50"),
            encumbered,
        )
        assert PurchaseRequestResponse.model_validate(paid).paid_difference == Decimal(
            "-14.50"
        )

    async def test_a_stored_draft_amount_is_not_what_is_spent(self, db_session, dept):
        """The draft edit form can set actual_amount. Paying without an amount
        records the estimate, never that value, so the requester cannot name
        the spend."""
        spent, _ = await _figures(db_session, dept["training_line"])
        pr = await _approved_purchase(db_session, dept)
        pr.actual_amount = Decimal("900.00")
        await db_session.flush()

        paid = await FinanceService(db_session).mark_pr_paid(
            pr.id, dept["org_id"], acted_by=dept["user_id"]
        )

        assert paid.actual_amount == Decimal("200.00")
        assert (await _figures(db_session, dept["training_line"]))[0] == (
            spent + Decimal("200.00")
        )
        assert PurchaseRequestResponse.model_validate(paid).paid_difference == 0

    async def test_no_difference_is_reported_before_payment(self, db_session, dept):
        pr = await _approved_purchase(db_session, dept)
        pr.actual_amount = Decimal("900.00")
        await db_session.flush()
        await db_session.refresh(pr)
        assert PurchaseRequestResponse.model_validate(pr).paid_difference is None

    async def test_a_zero_amount_is_refused(self, db_session, dept):
        pr = await _approved_purchase(db_session, dept)
        with pytest.raises(ValueError, match="more than zero"):
            await FinanceService(db_session).mark_pr_paid(
                pr.id, dept["org_id"], Decimal("0"), acted_by=dept["user_id"]
            )

    async def test_the_endpoint_records_the_amount_sent(self, db_session, dept):
        pr = await _approved_purchase(db_session, dept)
        async with await _client_as(
            db_session, dept["org_id"], dept["user_id"], ["finance.manage"]
        ) as client:
            resp = await client.post(
                f"/finance/purchase-requests/{pr.id}/mark-paid",
                params={"actual_amount": "212.40"},
            )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert Decimal(body["actualAmount"]) == Decimal("212.40")
        assert Decimal(body["paidDifference"]) == Decimal("12.40")

    async def test_a_client_sending_no_amount_records_the_estimate(
        self, db_session, dept
    ):
        """An API client written before the amount was asked for keeps
        working: the approved estimate is recorded as what was paid."""
        spent, _ = await _figures(db_session, dept["training_line"])
        pr = await _approved_purchase(db_session, dept)
        async with await _client_as(
            db_session, dept["org_id"], dept["user_id"], ["finance.manage"]
        ) as client:
            resp = await client.post(f"/finance/purchase-requests/{pr.id}/mark-paid")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert Decimal(body["actualAmount"]) == Decimal("200.00")
        assert Decimal(body["paidDifference"]) == 0
        assert (await _figures(db_session, dept["training_line"]))[0] == (
            spent + Decimal("200.00")
        )

    @pytest.mark.parametrize("amount", ["0", "-5.00"])
    async def test_a_zero_or_negative_amount_is_a_422(self, db_session, dept, amount):
        pr = await _approved_purchase(db_session, dept)
        async with await _client_as(
            db_session, dept["org_id"], dept["user_id"], ["finance.manage"]
        ) as client:
            resp = await client.post(
                f"/finance/purchase-requests/{pr.id}/mark-paid",
                params={"actual_amount": amount},
            )
        assert resp.status_code == 422
        await db_session.refresh(pr)
        assert pr.status == PurchaseRequestStatus.APPROVED


# ============================================================================
# 2. A receipt before payment
# ============================================================================


async def _approved_check(db, dept, *, receipt=False, **fields):
    data = {
        "organization_id": dept["org_id"],
        "request_number": f"CR-2026-{uuid.uuid4().hex[:4]}",
        "requested_by": dept["member_id"],
        "fiscal_year_id": dept["fy_id"],
        "payee_name": "County Fuel Depot",
        "amount": Decimal("60.00"),
        "status": CheckRequestStatus.APPROVED,
        "approved_at": PAID,
    }
    data.update(fields)
    cr = CheckRequest(**data)
    if receipt:
        cr.receipt_document_id = dept["receipt_id"]
    db.add(cr)
    await db.flush()
    await db.refresh(cr)
    return cr


class TestAReceiptBeforePayment:
    async def test_a_purchase_without_a_receipt_is_not_paid(self, db_session, dept):
        spent, encumbered = await _figures(db_session, dept["training_line"])
        pr = await _approved_purchase(db_session, dept, receipt=False)

        with pytest.raises(ReceiptRequiredError, match="Attach the receipt"):
            await FinanceService(db_session).mark_pr_paid(
                pr.id, dept["org_id"], Decimal("200.00"), acted_by=dept["user_id"]
            )

        await db_session.refresh(pr)
        assert pr.status == PurchaseRequestStatus.APPROVED
        assert await _figures(db_session, dept["training_line"]) == (
            spent,
            encumbered + Decimal("200.00"),
        )

    async def test_a_typed_receipt_link_is_not_a_receipt(self, db_session, dept):
        pr = await _approved_purchase(db_session, dept, receipt=False)
        pr.receipt_url = "https://example.com/receipt.pdf"
        await db_session.flush()
        with pytest.raises(ReceiptRequiredError):
            await FinanceService(db_session).mark_pr_paid(
                pr.id, dept["org_id"], Decimal("200.00"), acted_by=dept["user_id"]
            )

    async def test_the_refusal_is_a_400_that_says_why(self, db_session, dept):
        pr = await _approved_purchase(db_session, dept, receipt=False)
        async with await _client_as(
            db_session, dept["org_id"], dept["user_id"], ["finance.manage"]
        ) as client:
            resp = await client.post(
                f"/finance/purchase-requests/{pr.id}/mark-paid",
                params={"actual_amount": "200.00"},
            )
        assert resp.status_code == 400
        assert "Attach the receipt" in resp.json()["detail"]

    async def test_a_check_without_a_receipt_is_not_issued(self, db_session, dept):
        cr = await _approved_check(db_session, dept, budget_id=dept["fuel_line"].id)
        with pytest.raises(ReceiptRequiredError, match="before it is issued"):
            await FinanceService(db_session).issue_check(
                cr.id, dept["org_id"], "2001", acted_by=dept["user_id"]
            )
        await db_session.refresh(cr)
        assert cr.status == CheckRequestStatus.APPROVED

    async def test_a_check_with_a_receipt_is_issued(self, db_session, dept):
        cr = await _approved_check(db_session, dept, receipt=True)
        issued = await FinanceService(db_session).issue_check(
            cr.id, dept["org_id"], "2002", acted_by=dept["user_id"]
        )
        assert issued.status == CheckRequestStatus.ISSUED

    async def test_an_advance_needs_no_receipt_of_its_own(self, db_session, dept):
        cr = await _approved_check(db_session, dept, is_advance=True)
        issued = await FinanceService(db_session).issue_check(
            cr.id, dept["org_id"], "2003", acted_by=dept["user_id"]
        )
        assert issued.status == CheckRequestStatus.ISSUED
        assert CheckRequestResponse.model_validate(issued).receipt_required is False

    async def test_the_response_says_a_receipt_is_needed(self, db_session, dept):
        cr = await _approved_check(db_session, dept)
        payload = CheckRequestResponse.model_validate(cr)
        assert payload.receipt_required is True
        assert payload.receipt_file_url is None

    async def test_a_receipt_is_uploaded_to_a_check_request(self, db_session, dept):
        cr = await _approved_check(db_session, dept)
        uploaded = Document(
            organization_id=dept["org_id"], name="Invoice", file_name="i.pdf"
        )
        db_session.add(uploaded)
        await db_session.flush()

        async def store(*_args, **_kwargs):
            return uploaded

        async with await _client_as(
            db_session, dept["org_id"], dept["user_id"], ["finance.manage"]
        ) as client:
            with patch(
                "app.api.v1.endpoints.finance.module_documents.store_as_document",
                store,
            ):
                resp = await client.post(
                    f"/finance/check-requests/{cr.id}/receipt",
                    files={"file": ("i.pdf", b"%PDF-1.4", "application/pdf")},
                )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["receiptDocumentId"] == uploaded.id
        assert (
            body["receiptFileUrl"] == f"/api/v1/finance/check-requests/{cr.id}/receipt"
        )
        issued = await FinanceService(db_session).issue_check(
            cr.id, dept["org_id"], "2004", acted_by=dept["user_id"]
        )
        assert issued.status == CheckRequestStatus.ISSUED

    async def test_another_members_check_reads_as_missing(self, db_session, dept):
        cr = await _approved_check(db_session, dept)
        outsider = await _user(db_session, dept["org_id"])
        async with await _client_as(
            db_session, dept["org_id"], outsider, ["finance.request"]
        ) as client:
            resp = await client.post(
                f"/finance/check-requests/{cr.id}/receipt",
                files={"file": ("i.pdf", b"%PDF-1.4", "application/pdf")},
            )
        assert resp.status_code == 404

    async def test_a_check_receipt_past_draft_cannot_be_deleted(self, db_session, dept):
        await _approved_check(db_session, dept, receipt=True, request_number="CR-9")
        with pytest.raises(ValueError, match="receipt on check request CR-9"):
            await DocumentsService(db_session)._release_document_references(
                {dept["receipt_id"]}, dept["org_id"]
            )


# ============================================================================
# 3. The member picks the line, approval commits it
# ============================================================================


async def _report(db, dept, lines, *, submit=True):
    """A member's report with one receipted line per (budget line, amount)."""
    service = FinanceService(db)
    er = await service.create_expense_report(
        dept["org_id"],
        dept["member_id"],
        line_items=[
            {
                "budget_id": budget_id,
                "description": f"Line {index}",
                "amount": Decimal(amount),
                "date_incurred": datetime.now(timezone.utc),
            }
            for index, (budget_id, amount) in enumerate(lines)
        ],
        charger_id=dept["member_id"],
        fiscal_year_id=dept["fy_id"],
        title="Conference",
    )
    for item in er.line_items:
        item.receipt_document_id = dept["receipt_id"]
    await db.flush()
    if submit:
        await service.submit_expense_report(er.id, dept["org_id"], dept["member_id"])
    return er


async def _approve(db, dept, er):
    await FinanceService(db).manual_approve(
        ApprovalEntityType.EXPENSE_REPORT, er.id, dept["user_id"], org_id=dept["org_id"]
    )
    await db.refresh(er)
    return er


class TestApprovalCommitsTheMembersLine:
    async def test_approval_encumbers_each_line_it_charges(self, db_session, dept):
        training = await _figures(db_session, dept["training_line"])
        fuel = await _figures(db_session, dept["fuel_line"])
        er = await _report(
            db_session,
            dept,
            [
                (dept["training_line"].id, "100.00"),
                (dept["training_line"].id, "25.00"),
                (dept["fuel_line"].id, "40.00"),
                (None, "5.00"),
            ],
        )
        # Submitting moves nothing.
        assert await _figures(db_session, dept["training_line"]) == training

        er = await _approve(db_session, dept, er)

        assert er.status == ExpenseReportStatus.APPROVED
        assert er.budget_committed_at is not None
        assert await _figures(db_session, dept["training_line"]) == (
            training[0],
            training[1] + Decimal("125.00"),
        )
        assert await _figures(db_session, dept["fuel_line"]) == (
            fuel[0],
            fuel[1] + Decimal("40.00"),
        )

    async def test_paying_turns_the_commitment_into_spend(self, db_session, dept):
        training = await _figures(db_session, dept["training_line"])
        er = await _approve(
            db_session,
            dept,
            await _report(db_session, dept, [(dept["training_line"].id, "100.00")]),
        )
        assert await _figures(db_session, dept["training_line"]) == (
            training[0],
            training[1] + Decimal("100.00"),
        )

        await FinanceService(db_session).mark_expense_paid(
            er.id, dept["org_id"], acted_by=dept["user_id"]
        )

        assert await _figures(db_session, dept["training_line"]) == (
            training[0] + Decimal("100.00"),
            training[1],
        )

    async def test_cancelling_an_approved_report_releases_it(self, db_session, dept):
        training = await _figures(db_session, dept["training_line"])
        er = await _approve(
            db_session,
            dept,
            await _report(db_session, dept, [(dept["training_line"].id, "100.00")]),
        )
        assert (await _figures(db_session, dept["training_line"]))[1] == (
            training[1] + Decimal("100.00")
        )

        await FinanceService(db_session).cancel_expense_report(er.id, dept["org_id"])

        assert await _figures(db_session, dept["training_line"]) == training

    async def test_an_approval_the_line_cannot_cover_is_refused(self, db_session, dept):
        line = await _line(db_session, dept["fuel_line"])
        left = line.amount_budgeted - line.amount_spent - line.amount_encumbered
        er = await _report(
            db_session, dept, [(dept["fuel_line"].id, str(left + Decimal("1")))]
        )
        with pytest.raises(BudgetLimitExceededError):
            await _approve(db_session, dept, er)

    async def test_a_report_approved_before_the_commitment_releases_nothing(
        self, db_session, dept
    ):
        """An upgrade leaves approved reports with nothing committed. Paying
        one spends its lines and leaves other requests' encumbrance alone."""
        pr = await _approved_purchase(db_session, dept)
        training = await _figures(db_session, dept["training_line"])
        er = ExpenseReport(
            organization_id=dept["org_id"],
            report_number="ER-2026-0900",
            submitted_by=dept["member_id"],
            fiscal_year_id=dept["fy_id"],
            title="Approved before the upgrade",
            total_amount=Decimal("50.00"),
            status=ExpenseReportStatus.APPROVED,
            approved_at=PAID,
        )
        db_session.add(er)
        await db_session.flush()
        db_session.add(
            ExpenseLineItem(
                expense_report_id=er.id,
                budget_id=dept["training_line"].id,
                description="Registration",
                amount=Decimal("50.00"),
                date_incurred=PAID,
                receipt_document_id=dept["receipt_id"],
            )
        )
        await db_session.flush()

        await FinanceService(db_session).mark_expense_paid(
            er.id, dept["org_id"], acted_by=dept["user_id"]
        )

        assert await _figures(db_session, dept["training_line"]) == (
            training[0] + Decimal("50.00"),
            training[1],
        )
        assert pr.status == PurchaseRequestStatus.APPROVED

    async def test_claiming_a_purchase_back_commits_nothing_twice(
        self, db_session, dept
    ):
        pr = await _approved_purchase(db_session, dept)
        training = await _figures(db_session, dept["training_line"])
        service = FinanceService(db_session)
        er = await service.create_reimbursement_report(
            pr.id,
            dept["org_id"],
            dept["member_id"],
            requester_scope=dept["member_id"],
            amount=Decimal("180.00"),
            date_incurred=PAID,
        )
        await service.submit_expense_report(er.id, dept["org_id"], dept["member_id"])
        er = await _approve(db_session, dept, er)

        assert er.budget_committed_at is None
        assert await _figures(db_session, dept["training_line"]) == training

    async def test_a_voided_check_restores_the_commitment(self, db_session, dept):
        training = await _figures(db_session, dept["training_line"])
        service = FinanceService(db_session)
        er = await _approve(
            db_session,
            dept,
            await _report(db_session, dept, [(dept["training_line"].id, "70.00")]),
        )
        cr = await service.request_reimbursement_check(
            er.id, dept["org_id"], payee_address="1 Main St"
        )
        await service.manual_approve(
            ApprovalEntityType.CHECK_REQUEST,
            cr.id,
            dept["user_id"],
            org_id=dept["org_id"],
        )
        await service.issue_check(
            cr.id, dept["org_id"], "3001", acted_by=dept["user_id"]
        )
        assert await _figures(db_session, dept["training_line"]) == (
            training[0] + Decimal("70.00"),
            training[1],
        )

        await service.void_check(cr.id, dept["org_id"])

        assert await _figures(db_session, dept["training_line"]) == (
            training[0],
            training[1] + Decimal("70.00"),
        )

    async def test_the_line_history_lists_the_commitment(self, db_session, dept):
        er = await _approve(
            db_session,
            dept,
            await _report(db_session, dept, [(dept["fuel_line"].id, "30.00")]),
        )
        history = await FinanceService(db_session).list_budget_transactions(
            dept["fuel_line"].id, dept["org_id"], 50, 0
        )
        rows = [row for row in history["items"] if row["entity_id"] == er.id]
        assert [(row["effect"], row["amount"]) for row in rows] == [
            ("encumbered", Decimal("30.00"))
        ]

    async def test_another_departments_line_is_refused(self, db_session, dept):
        other = await make_books(db_session)
        foreign = (
            (
                await db_session.execute(
                    select(Budget).where(Budget.organization_id == other["org_id"])
                )
            )
            .scalars()
            .first()
        )
        er = await _report(db_session, dept, [(None, "10.00")], submit=False)
        with pytest.raises(ValueError, match="Budget not found"):
            await FinanceService(db_session).add_expense_line_item(
                er.id,
                dept["org_id"],
                dept["member_id"],
                budget_id=foreign.id,
                description="Elsewhere",
                amount=Decimal("10.00"),
                date_incurred=PAID,
            )

    async def test_the_detail_names_each_lines_budget(self, db_session, dept):
        er = await _report(
            db_session, dept, [(dept["training_line"].id, "10.00")], submit=False
        )
        async with await _client_as(
            db_session, dept["org_id"], dept["member_id"], ["finance.request"]
        ) as client:
            resp = await client.get(f"/finance/expense-reports/{er.id}")
        assert resp.status_code == 200, resp.text
        [line] = resp.json()["lineItems"]
        assert line["budgetId"] == dept["training_line"].id
        assert line["budgetLabel"] == "Training"
        assert ExpenseReportResponse.model_validate(er).budget_committed_at is None

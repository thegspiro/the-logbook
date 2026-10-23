"""Purchase request -> expense report -> reimbursement check.

Owner decisions, 2026-10-23: a member who bought an approved purchase with
their own money claims it back with an expense report linked to the request;
the finance office pays an approved report by check ("Pay by check"), and that
check goes through the check-request approval chain before it is issued. A
check voided after QuickBooks received it is reversed there.

Each purchase is counted once: the report's lines are the spend, the check is
how it was paid, and the request closes as ``reimbursed`` (see
app/services/finance_reimbursement.py).

The department is make_books' (Training and Fuel lines, one paid transaction of
each type in March 2026) plus a member, who raises a $200 purchase request on
the Training line that the department approved.
"""

import csv
import io
import json
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import finance as finance_endpoints
from app.core.database import get_db
from app.models.document import Document
from app.models.finance import (
    ApprovalEntityType,
    Budget,
    CheckRequestStatus,
    ExpenseReportStatus,
    PurchaseRequest,
    PurchaseRequestStatus,
)
from app.models.grant import (
    CampaignType,
    Donation,
    FundraisingCampaign,
    PaymentMethod,
    PaymentStatus,
)
from app.models.user import User
from app.services.finance_reimbursement import ReimbursementLinkError
from app.services.finance_report_service import FinanceReportService
from app.services.finance_service import FinanceEntityNotFoundError, FinanceService
from app.services.restricted_funds import fund_balances
from app.services.separation_of_duties import SeparationOfDutiesError
from tests.test_finance_quickbooks_export import PAID, _user, make_books

pytestmark = [pytest.mark.integration]

ISSUED = datetime(2026, 3, 20, 15, 0, tzinfo=timezone.utc)


@pytest.fixture
async def dept(db_session):
    books = await make_books(db_session)
    lines = (
        await db_session.execute(
            select(Budget).where(Budget.organization_id == books["org_id"])
        )
    ).scalars()
    budgets = {b.category_id: b for b in lines}
    books["line"] = budgets[books["training"].id]
    books["fy_id"] = books["line"].fiscal_year_id
    books["member_id"] = await _user(db_session, books["org_id"])
    receipt = Document(
        organization_id=books["org_id"], name="Receipt", file_name="r.pdf"
    )
    db_session.add(receipt)
    await db_session.flush()
    books["receipt_id"] = receipt.id
    books["pr"] = await _approved_purchase(db_session, books)
    return books


async def _approved_purchase(db, dept, estimate="200.00", fund_id=None, number=None):
    """An approved request with its estimate encumbered, as approval leaves it."""
    pr = PurchaseRequest(
        organization_id=dept["org_id"],
        request_number=number or "PR-2026-0100",
        fiscal_year_id=dept["fy_id"],
        budget_id=dept["line"].id,
        fund_campaign_id=fund_id,
        requested_by=dept["member_id"],
        title="Hose nozzles",
        vendor="Fire Supply Co",
        estimated_amount=Decimal(estimate),
        status=PurchaseRequestStatus.APPROVED,
        approved_at=PAID,
        receipt_document_id=dept["receipt_id"],
    )
    db.add(pr)
    await db.flush()
    await FinanceService(db)._encumber_budget(
        dept["line"].id, Decimal(estimate), dept["org_id"]
    )
    return pr


async def _claim(db, dept, amount=None, pr=None):
    return await FinanceService(db).create_reimbursement_report(
        (pr or dept["pr"]).id,
        dept["org_id"],
        dept["member_id"],
        requester_scope=dept["member_id"],
        amount=Decimal(amount) if amount else None,
        date_incurred=PAID,
    )


async def _approved_report(db, dept, amount="180.00", pr=None):
    service = FinanceService(db)
    er = await _claim(db, dept, amount, pr)
    await service.submit_expense_report(er.id, dept["org_id"], dept["member_id"])
    await service.manual_approve(
        ApprovalEntityType.EXPENSE_REPORT, er.id, dept["user_id"], org_id=dept["org_id"]
    )
    return await service.get_expense_report(er.id, dept["org_id"])


async def _approved_check(db, dept, er):
    service = FinanceService(db)
    cr = await service.request_reimbursement_check(
        er.id, dept["org_id"], payee_address="1 Main St"
    )
    await service.manual_approve(
        ApprovalEntityType.CHECK_REQUEST, cr.id, dept["user_id"], org_id=dept["org_id"]
    )
    return cr


async def _issued(db, dept, er, number="3001", when=ISSUED):
    cr = await _approved_check(db, dept, er)
    return await FinanceService(db).issue_check(
        cr.id, dept["org_id"], number, check_date=when, acted_by=dept["user_id"]
    )


async def _line(db, dept) -> Budget:
    await db.refresh(dept["line"])
    return dept["line"]


async def _export(db, dept, start, end) -> list[list[str]]:
    stream = await FinanceService(db).generate_export(
        dept["org_id"], dept["user_id"], start, end
    )
    content = "".join([chunk async for chunk in stream])
    return list(csv.reader(io.StringIO(content)))


class TestClaimingAPurchaseBack:
    async def test_the_report_copies_the_purchase(self, db_session, dept):
        er = await _claim(db_session, dept, amount="185.25")

        assert er.status == ExpenseReportStatus.DRAFT
        assert er.purchase_request_id == dept["pr"].id
        assert er.submitted_by == dept["member_id"]
        assert er.total_amount == Decimal("185.25")
        [line] = er.line_items
        assert (line.budget_id, line.amount, line.merchant) == (
            dept["line"].id,
            Decimal("185.25"),
            "Fire Supply Co",
        )
        # The request's receipt comes with it, so the line can be submitted.
        assert line.receipt_document_id == dept["receipt_id"]

    async def test_the_amount_defaults_to_the_estimate(self, db_session, dept):
        er = await _claim(db_session, dept)

        assert er.total_amount == Decimal("200.00")

    async def test_only_the_requester_may_claim_it(self, db_session, dept):
        service = FinanceService(db_session)
        with pytest.raises(ReimbursementLinkError, match="Only the member"):
            await service.create_reimbursement_report(
                dept["pr"].id,
                dept["org_id"],
                dept["user_id"],
                requester_scope=None,
            )
        # A member without the manage grant is told it does not exist.
        with pytest.raises(FinanceEntityNotFoundError):
            await service.create_reimbursement_report(
                dept["pr"].id,
                dept["org_id"],
                dept["user_id"],
                requester_scope=dept["user_id"],
            )

    async def test_another_departments_request_is_not_found(self, db_session, dept):
        other = await make_books(db_session)
        with pytest.raises(ValueError, match="not found"):
            await FinanceService(db_session).create_reimbursement_report(
                dept["pr"].id,
                other["org_id"],
                dept["member_id"],
                requester_scope=None,
            )

    async def test_one_claim_at_a_time(self, db_session, dept):
        first = await _claim(db_session, dept)

        with pytest.raises(ReimbursementLinkError, match=first.report_number):
            await _claim(db_session, dept)

    async def test_a_denied_claim_lets_another_follow(self, db_session, dept):
        service = FinanceService(db_session)
        er = await _claim(db_session, dept)
        await service.submit_expense_report(er.id, dept["org_id"])
        await service.manual_deny(
            ApprovalEntityType.EXPENSE_REPORT,
            er.id,
            dept["user_id"],
            "Wrong amount",
            org_id=dept["org_id"],
        )

        second = await _claim(db_session, dept)
        assert second.id != er.id

    async def test_an_unapproved_purchase_cannot_be_claimed(self, db_session, dept):
        dept["pr"].status = PurchaseRequestStatus.PENDING_APPROVAL
        await db_session.flush()

        with pytest.raises(ReimbursementLinkError, match="approved purchase"):
            await _claim(db_session, dept)

    async def test_a_claimed_purchase_is_not_paid_or_cancelled_beside_it(
        self, db_session, dept
    ):
        service = FinanceService(db_session)
        er = await _claim(db_session, dept)
        await service.submit_expense_report(er.id, dept["org_id"])

        with pytest.raises(ReimbursementLinkError, match="cannot be marked as paid"):
            await service.mark_pr_paid(
                dept["pr"].id, dept["org_id"], acted_by=dept["user_id"]
            )
        with pytest.raises(ReimbursementLinkError, match="cannot be cancelled"):
            await service.cancel_purchase_request(dept["pr"].id, dept["org_id"])

    async def test_a_draft_claim_does_not_hold_the_purchase_open(
        self, db_session, dept
    ):
        service = FinanceService(db_session)
        er = await _claim(db_session, dept)
        await service.cancel_purchase_request(dept["pr"].id, dept["org_id"])

        with pytest.raises(ReimbursementLinkError, match="no longer approved"):
            await service.submit_expense_report(er.id, dept["org_id"])


class TestPayingByCheck:
    async def test_the_check_pays_the_member_what_is_owed(self, db_session, dept):
        er = await _approved_report(db_session, dept)
        cr = await FinanceService(db_session).request_reimbursement_check(
            er.id, dept["org_id"], payee_address="1 Main St"
        )

        assert cr.expense_report_id == er.id
        assert cr.requested_by == dept["member_id"]
        assert cr.payee_name == "Tess Treasurer"
        assert cr.amount == Decimal("180.00")
        assert cr.budget_id is None
        assert cr.fund_campaign_id is None
        # No chain is configured, so it waits on a manual approval.
        assert cr.status == CheckRequestStatus.PENDING_APPROVAL

    async def test_only_an_approved_report_is_paid_by_check(self, db_session, dept):
        er = await _claim(db_session, dept)

        with pytest.raises(ReimbursementLinkError, match="approved expense report"):
            await FinanceService(db_session).request_reimbursement_check(
                er.id, dept["org_id"]
            )

    async def test_one_check_at_a_time(self, db_session, dept):
        er = await _approved_report(db_session, dept)
        service = FinanceService(db_session)
        cr = await service.request_reimbursement_check(er.id, dept["org_id"])

        with pytest.raises(ReimbursementLinkError, match=cr.request_number):
            await service.request_reimbursement_check(er.id, dept["org_id"])
        # Nor is the report paid some other way while the check is live.
        with pytest.raises(ReimbursementLinkError, match=cr.request_number):
            await service.mark_expense_paid(
                er.id, dept["org_id"], "cash", acted_by=dept["user_id"]
            )

    async def test_its_amount_cannot_be_edited(self, db_session, dept):
        er = await _approved_report(db_session, dept)
        service = FinanceService(db_session)
        cr = await service.request_reimbursement_check(er.id, dept["org_id"])
        # Editable while just submitted, before an approval chain picks it up.
        cr.status = CheckRequestStatus.SUBMITTED
        await db_session.flush()

        with pytest.raises(ValueError, match="cannot be changed"):
            await service.update_check_request(
                cr.id, dept["org_id"], amount=Decimal("500.00")
            )
        with pytest.raises(ValueError, match="cannot be changed"):
            await service.update_check_request(
                cr.id, dept["org_id"], budget_id=dept["line"].id
            )
        # A form saving every field back unchanged is fine.
        updated = await service.update_check_request(
            cr.id, dept["org_id"], amount=Decimal("180.00"), payee_address="2 Elm"
        )
        assert updated.payee_address == "2 Elm"

    async def test_issuing_it_pays_the_report_and_closes_the_purchase(
        self, db_session, dept
    ):
        before = await _line(db_session, dept)
        spent, encumbered = before.amount_spent, before.amount_encumbered
        er = await _approved_report(db_session, dept)

        cr = await _issued(db_session, dept, er)

        await db_session.refresh(er)
        await db_session.refresh(dept["pr"])
        assert cr.status == CheckRequestStatus.ISSUED
        assert er.status == ExpenseReportStatus.PAID
        assert er.payment_method == "check"
        paid_at = er.paid_at
        assert paid_at is not None
        assert paid_at.replace(tzinfo=paid_at.tzinfo or timezone.utc) == ISSUED
        assert dept["pr"].status == PurchaseRequestStatus.REIMBURSED
        line = await _line(db_session, dept)
        # The $200 estimate is released and the $180 claimed is spent, once.
        assert line.amount_encumbered == encumbered - Decimal("200.00")
        assert line.amount_spent == spent + Decimal("180.00")

    async def test_the_member_cannot_issue_their_own_check(self, db_session, dept):
        er = await _approved_report(db_session, dept)
        cr = await _approved_check(db_session, dept, er)

        with pytest.raises(SeparationOfDutiesError):
            await FinanceService(db_session).issue_check(
                cr.id, dept["org_id"], "3002", acted_by=dept["member_id"]
            )

    async def test_a_denied_check_leaves_the_report_to_pay_again(
        self, db_session, dept
    ):
        er = await _approved_report(db_session, dept)
        service = FinanceService(db_session)
        cr = await service.request_reimbursement_check(er.id, dept["org_id"])
        await service.manual_deny(
            ApprovalEntityType.CHECK_REQUEST,
            cr.id,
            dept["user_id"],
            "Pay by direct deposit",
            org_id=dept["org_id"],
        )

        paid = await service.mark_expense_paid(
            er.id, dept["org_id"], "direct deposit", acted_by=dept["user_id"]
        )
        await db_session.refresh(dept["pr"])
        assert paid.status == ExpenseReportStatus.PAID
        assert dept["pr"].status == PurchaseRequestStatus.REIMBURSED


class TestVoidingTheCheck:
    async def test_a_void_undoes_the_payment(self, db_session, dept):
        before = await _line(db_session, dept)
        er = await _approved_report(db_session, dept)
        spent, encumbered = before.amount_spent, before.amount_encumbered
        cr = await _issued(db_session, dept, er)

        await FinanceService(db_session).void_check(cr.id, dept["org_id"])

        await db_session.refresh(er)
        await db_session.refresh(dept["pr"])
        assert er.status == ExpenseReportStatus.APPROVED
        assert er.paid_at is None
        assert dept["pr"].status == PurchaseRequestStatus.APPROVED
        line = await _line(db_session, dept)
        assert (line.amount_spent, line.amount_encumbered) == (spent, encumbered)

    async def test_a_reopened_purchase_returns_to_how_far_it_got(
        self, db_session, dept
    ):
        dept["pr"].status = PurchaseRequestStatus.RECEIVED
        dept["pr"].ordered_at = PAID
        dept["pr"].received_at = PAID
        await db_session.flush()
        er = await _approved_report(db_session, dept)
        cr = await _issued(db_session, dept, er)

        await FinanceService(db_session).void_check(cr.id, dept["org_id"])

        await db_session.refresh(dept["pr"])
        assert dept["pr"].status == PurchaseRequestStatus.RECEIVED

    async def test_another_check_can_follow(self, db_session, dept):
        er = await _approved_report(db_session, dept)
        cr = await _issued(db_session, dept, er)
        await FinanceService(db_session).void_check(cr.id, dept["org_id"])

        second = await _issued(db_session, dept, er, number="3005")

        await db_session.refresh(er)
        assert second.id != cr.id
        assert er.status == ExpenseReportStatus.PAID


class TestTheBooks:
    async def test_quickbooks_gets_the_report_through_the_check(self, db_session, dept):
        er = await _approved_report(db_session, dept)
        cr = await _issued(db_session, dept, er)

        rows = await _export(db_session, dept, *_march())

        mine = [r for r in rows if r[0] == cr.request_number]
        assert [r[3:6] for r in mine] == [
            ["Training Expense", "180.00", ""],
            ["Operating Checking", "", "180.00"],
        ]
        assert mine[0][1] == "03/20/2026"
        # The report is not exported a second time under its own number.
        assert not [r for r in rows if r[0] == er.report_number]
        await db_session.refresh(cr)
        await db_session.refresh(er)
        assert cr.qb_export_entry == [
            ["Training Expense", "180.00", "", "Fire Supply Co: Hose nozzles"],
            ["Operating Checking", "", "180.00", "Fire Supply Co: Hose nozzles"],
        ]
        assert cr.qb_exported_at is not None
        assert er.qb_exported_at is not None

    async def test_a_void_after_export_is_reversed_from_what_was_sent(
        self, db_session, dept
    ):
        er = await _approved_report(db_session, dept)
        cr = await _issued(db_session, dept, er)
        await _export(db_session, dept, *_march())
        # A later change of mapping must not change what the reversal posts.
        dept["training"].qb_account_name = "Renamed Expense"
        await db_session.flush()

        await FinanceService(db_session).void_check(cr.id, dept["org_id"])
        await db_session.refresh(er)
        assert er.qb_exported_at is None

        rows = await _export(db_session, dept, *_around_now())
        reversal = [r for r in rows if r[0] == f"{cr.request_number}-V"]
        assert [r[3:6] for r in reversal] == [
            ["Training Expense", "", "180.00"],
            ["Operating Checking", "180.00", ""],
        ]
        await db_session.refresh(cr)
        assert cr.qb_void_exported_at is not None

    async def test_a_report_paid_again_posts_under_the_new_check(
        self, db_session, dept
    ):
        er = await _approved_report(db_session, dept)
        first = await _issued(db_session, dept, er)
        await _export(db_session, dept, *_march())
        await FinanceService(db_session).void_check(first.id, dept["org_id"])
        second = await _issued(db_session, dept, er, number="3009")

        rows = await _export(db_session, dept, *_march())

        assert [r[0] for r in rows[1:]] == [second.request_number] * 2

    async def test_the_register_shows_the_report_once_with_its_check(
        self, db_session, dept
    ):
        er = await _approved_report(db_session, dept)
        cr = await _issued(db_session, dept, er)

        report = await FinanceReportService(db_session).payments_register(
            dept["org_id"], date(2026, 3, 1), date(2026, 3, 31)
        )

        mine = [
            r
            for r in report["rows"]
            if r["number"] in (er.report_number, cr.request_number)
        ]
        assert len(mine) == 1
        assert mine[0]["kind"] == "expense_report"
        assert mine[0]["check_number"] == "3001"
        assert mine[0]["amount"] == Decimal("180.00")

    async def test_the_register_keeps_the_payment_and_shows_its_void(
        self, db_session, dept
    ):
        er = await _approved_report(db_session, dept)
        cr = await _issued(db_session, dept, er)
        await FinanceService(db_session).void_check(cr.id, dept["org_id"])
        service = FinanceReportService(db_session)

        march = await service.payments_register(
            dept["org_id"], date(2026, 3, 1), date(2026, 3, 31)
        )
        assert [r["amount"] for r in march["rows"] if r["entity_id"] == er.id] == [
            Decimal("180.00")
        ]
        today = datetime.now(timezone.utc).date()
        now = await service.payments_register(
            dept["org_id"], today - timedelta(days=1), today + timedelta(days=1)
        )
        assert [r["amount"] for r in now["rows"] if r["entity_id"] == cr.id] == [
            Decimal("-180.00")
        ]

    async def test_functional_expenses_count_the_lines_once(self, db_session, dept):
        service = FinanceReportService(db_session)
        before = await service.functional_expenses(
            dept["org_id"], date(2026, 3, 1), date(2026, 3, 31)
        )
        er = await _approved_report(db_session, dept)
        await _issued(db_session, dept, er)

        after = await service.functional_expenses(
            dept["org_id"], date(2026, 3, 1), date(2026, 3, 31)
        )
        assert after["total"] - before["total"] == Decimal("180.00")


class TestARestrictedFund:
    async def test_the_purchase_and_its_report_are_committed_once(
        self, db_session, dept
    ):
        fund = FundraisingCampaign(
            organization_id=dept["org_id"],
            name="Nozzle drive",
            campaign_type=CampaignType.EQUIPMENT,
            goal_amount=Decimal("5000.00"),
            start_date=date(2026, 1, 1),
            is_restricted=True,
            restriction_purpose="Nozzles",
            active=True,
        )
        db_session.add(fund)
        await db_session.flush()
        db_session.add(
            Donation(
                organization_id=dept["org_id"],
                campaign_id=fund.id,
                amount=Decimal("500.00"),
                donation_date=datetime(2026, 2, 1, tzinfo=timezone.utc),
                payment_method=PaymentMethod.CHECK,
                payment_status=PaymentStatus.COMPLETED,
            )
        )
        pr = await _approved_purchase(
            db_session, dept, fund_id=fund.id, number="PR-2026-0200"
        )

        async def committed():
            return (await fund_balances(db_session, dept["org_id"], [fund.id]))[
                fund.id
            ].committed

        assert await committed() == Decimal("200.00")
        await _approved_report(db_session, dept, amount="190.00", pr=pr)
        # The report's lines replace the request's estimate once approved.
        assert await committed() == Decimal("190.00")


def _march():
    return (
        datetime(2026, 3, 1, tzinfo=timezone.utc),
        datetime(2026, 3, 31, tzinfo=timezone.utc),
    )


def _around_now():
    now = datetime.now(timezone.utc)
    return now - timedelta(days=1), now + timedelta(days=1)


async def _client_as(db, org_id: str, user_id: str, permissions) -> AsyncClient:
    """The finance API, signed in as an existing member holding ``permissions``."""
    position_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, permissions) "
            "VALUES (:id, :org, :name, :slug, :perms)"
        ),
        {
            "id": position_id,
            "org": org_id,
            "name": f"Position {position_id[:6]}",
            "slug": f"position-{position_id[:8]}",
            "perms": json.dumps(list(permissions)),
        },
    )
    await db.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": user_id, "p": position_id},
    )
    await db.flush()
    user = await db.get(User, user_id)
    await db.refresh(user, ["positions"])
    app = FastAPI()
    app.include_router(finance_endpoints.router, prefix="/finance")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


class TestTheEndpoints:
    async def test_the_member_claims_their_purchase_in_camel_case(
        self, db_session, dept
    ):
        async with await _client_as(
            db_session, dept["org_id"], dept["member_id"], ["finance.request"]
        ) as client:
            response = await client.post(
                f"/finance/purchase-requests/{dept['pr'].id}/reimbursement-report",
                json={"amount": "185.25", "dateIncurred": "2026-03-10T12:00:00Z"},
            )
            detail = await client.get(f"/finance/purchase-requests/{dept['pr'].id}")

        assert response.status_code == 201, response.text
        body = response.json()
        assert body["purchaseRequestId"] == dept["pr"].id
        assert body["purchaseRequestNumber"] == "PR-2026-0100"
        assert body["totalAmount"] == "185.25"
        assert detail.json()["reimbursementReportId"] == body["id"]
        assert detail.json()["reimbursementReportStatus"] == "draft"

    async def test_another_members_purchase_is_not_found(self, db_session, dept):
        other = await _user(db_session, dept["org_id"])
        async with await _client_as(
            db_session, dept["org_id"], other, ["finance.request"]
        ) as client:
            response = await client.post(
                f"/finance/purchase-requests/{dept['pr'].id}/reimbursement-report",
                json={},
            )

        assert response.status_code == 404

    async def test_paying_by_check_is_the_finance_offices(self, db_session, dept):
        er = await _approved_report(db_session, dept)
        async with await _client_as(
            db_session, dept["org_id"], dept["member_id"], ["finance.request"]
        ) as client:
            refused = await client.post(
                f"/finance/expense-reports/{er.id}/reimbursement-check", json={}
            )
        async with await _client_as(
            db_session, dept["org_id"], dept["user_id"], ["finance.manage"]
        ) as client:
            response = await client.post(
                f"/finance/expense-reports/{er.id}/reimbursement-check",
                json={"payeeAddress": "1 Main St"},
            )
            report = await client.get(f"/finance/expense-reports/{er.id}")

        assert refused.status_code == 403
        assert response.status_code == 201, response.text
        check = response.json()
        assert check["expenseReportId"] == er.id
        assert check["expenseReportNumber"] == er.report_number
        assert (check["amount"], check["payeeAddress"]) == ("180.00", "1 Main St")
        assert report.json()["reimbursementCheckId"] == check["id"]
        assert report.json()["amountOwed"] == "180.00"

    async def test_a_reimbursement_check_is_not_classified_on_its_own(
        self, db_session, dept
    ):
        er = await _approved_report(db_session, dept)
        cr = await FinanceService(db_session).request_reimbursement_check(
            er.id, dept["org_id"]
        )
        async with await _client_as(
            db_session, dept["org_id"], dept["user_id"], ["finance.manage"]
        ) as client:
            response = await client.put(
                f"/finance/check-requests/{cr.id}/functional-class",
                json={"functionalClass": "program"},
            )

        assert response.status_code == 400
        assert "expense report it pays" in response.json()["detail"]

"""Fixing and withdrawing what a member raised.

A draft expense report's lines can be edited and removed; a member withdraws
their own draft report or check request, and the finance office cancels one
that is further along. Before this nothing set either ``cancelled`` status, so
a reimbursement claim made with the wrong amount could be neither corrected
nor withdrawn, and as the live claim it blocked claiming the purchase again.

The department is test_finance_reimbursement_flow's: make_books' lines plus a
member with an approved $200 purchase request.
"""

from datetime import datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models.document import Document
from app.models.finance import (
    ApprovalChain,
    ApprovalChainStep,
    ApprovalEntityType,
    ApprovalStepRecord,
    ApprovalStepStatus,
    ApprovalStepType,
    ApproverType,
    Budget,
    CheckRequestStatus,
    ExpenseReportStatus,
)
from app.services.cash_advances import advance_balances
from app.services.finance_reimbursement import ReimbursementLinkError
from app.services.finance_service import FinanceEntityNotFoundError, FinanceService
from tests.test_finance_cash_advances import _advance
from tests.test_finance_quickbooks_export import _user, make_books
from tests.test_finance_reimbursement_flow import (
    _approved_check,
    _approved_purchase,
    _approved_report,
    _claim,
    _client_as,
    _issued,
)

pytestmark = [pytest.mark.integration]


@pytest.fixture
async def dept(db_session):
    """As test_finance_reimbursement_flow's: make_books' lines, a member and
    their approved $200 purchase request on the Training line."""
    books = await make_books(db_session)
    lines = (
        await db_session.execute(
            select(Budget).where(Budget.organization_id == books["org_id"])
        )
    ).scalars()
    books["line"] = {b.category_id: b for b in lines}[books["training"].id]
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


async def _draft(db, dept, amounts=("40.00", "60.00"), member_id=None):
    return await FinanceService(db).create_expense_report(
        dept["org_id"],
        member_id or dept["member_id"],
        line_items=[
            {
                "description": f"Line {n}",
                "amount": Decimal(amount),
                "date_incurred": datetime.now(timezone.utc),
                "expense_type": "general",
                "receipt_document_id": dept["receipt_id"],
            }
            for n, amount in enumerate(amounts, start=1)
        ],
        fiscal_year_id=dept["fy_id"],
        title="Supplies",
    )


def _line(er, description="Line 1"):
    """A report's line by description: the lines come back in no set order."""
    return next(line for line in er.line_items if line.description == description)


async def _chain(db, dept, entity_type):
    chain = ApprovalChain(
        organization_id=dept["org_id"],
        name="Standard",
        applies_to=entity_type,
        created_by=dept["user_id"],
    )
    db.add(chain)
    await db.flush()
    db.add(
        ApprovalChainStep(
            chain_id=chain.id,
            step_order=1,
            name="Treasurer",
            step_type=ApprovalStepType.APPROVAL,
            approver_type=ApproverType.PERMISSION,
            approver_value="finance.approve",
        )
    )
    await db.flush()


async def _step_statuses(db, entity_id):
    rows = await db.execute(
        select(ApprovalStepRecord.status).where(
            ApprovalStepRecord.entity_id == entity_id
        )
    )
    return list(rows.scalars())


class TestEditingLines:
    async def test_a_line_is_edited_and_the_total_follows(self, db_session, dept):
        er = await _draft(db_session, dept)
        line = _line(er)

        updated = await FinanceService(db_session).update_expense_line_item(
            er.id,
            line.id,
            dept["org_id"],
            requester_id=dept["member_id"],
            amount=Decimal("45.50"),
            merchant="Hardware store",
        )

        await db_session.refresh(er)
        assert (updated.amount, updated.merchant) == (
            Decimal("45.50"),
            "Hardware store",
        )
        assert er.total_amount == Decimal("105.50")

    async def test_an_optional_field_is_cleared_and_a_required_one_cannot_be(
        self, db_session, dept
    ):
        er = await _draft(db_session, dept)
        line = _line(er)
        service = FinanceService(db_session)
        await service.update_expense_line_item(
            er.id, line.id, dept["org_id"], merchant="Shop"
        )

        cleared = await service.update_expense_line_item(
            er.id, line.id, dept["org_id"], merchant=None
        )
        assert cleared.merchant is None
        with pytest.raises(ValueError, match="'description' cannot be cleared"):
            await service.update_expense_line_item(
                er.id, line.id, dept["org_id"], description=None
            )

    async def test_a_line_is_removed_and_the_total_follows(self, db_session, dept):
        er = await _draft(db_session, dept)

        er = await FinanceService(db_session).delete_expense_line_item(
            er.id, _line(er).id, dept["org_id"], requester_id=dept["member_id"]
        )

        assert [line.description for line in er.line_items] == ["Line 2"]
        assert er.total_amount == Decimal("60.00")

    async def test_a_report_with_no_lines_left_cannot_be_submitted(
        self, db_session, dept
    ):
        er = await _draft(db_session, dept, amounts=("40.00",))
        service = FinanceService(db_session)
        await service.delete_expense_line_item(er.id, _line(er).id, dept["org_id"])

        with pytest.raises(ValueError, match="must have line items"):
            await service.submit_expense_report(er.id, dept["org_id"])

    async def test_only_a_draft_reports_lines_change(self, db_session, dept):
        er = await _draft(db_session, dept)
        service = FinanceService(db_session)
        await service.submit_expense_report(er.id, dept["org_id"])

        with pytest.raises(ValueError, match="while the report is a draft"):
            await service.update_expense_line_item(
                er.id, _line(er).id, dept["org_id"], amount=Decimal("1.00")
            )
        with pytest.raises(ValueError, match="while the report is a draft"):
            await service.delete_expense_line_item(er.id, _line(er).id, dept["org_id"])

    async def test_another_members_report_is_not_found(self, db_session, dept):
        er = await _draft(db_session, dept)
        other = await _user(db_session, dept["org_id"])

        with pytest.raises(FinanceEntityNotFoundError):
            await FinanceService(db_session).update_expense_line_item(
                er.id,
                _line(er).id,
                dept["org_id"],
                requester_id=other,
                amount=Decimal("1.00"),
            )

    async def test_a_line_of_another_report_is_not_found(self, db_session, dept):
        er = await _draft(db_session, dept)
        other_report = await _draft(db_session, dept)

        with pytest.raises(FinanceEntityNotFoundError, match="line not found"):
            await FinanceService(db_session).delete_expense_line_item(
                er.id, _line(other_report).id, dept["org_id"]
            )

    async def test_a_claimed_purchase_can_be_corrected(self, db_session, dept):
        er = await _claim(db_session, dept, amount="200.00")

        updated = await FinanceService(db_session).update_expense_line_item(
            er.id,
            _line(er, "Hose nozzles").id,
            dept["org_id"],
            requester_id=dept["member_id"],
            amount=Decimal("187.40"),
        )

        await db_session.refresh(er)
        assert updated.budget_id == dept["line"].id
        assert er.total_amount == Decimal("187.40")


class TestWithdrawingAReport:
    async def test_the_member_withdraws_their_draft(self, db_session, dept):
        er = await _draft(db_session, dept)

        cancelled = await FinanceService(db_session).cancel_expense_report(
            er.id, dept["org_id"], requester_id=dept["member_id"]
        )

        assert cancelled.status == ExpenseReportStatus.CANCELLED

    async def test_the_member_cannot_withdraw_a_submitted_report(
        self, db_session, dept
    ):
        er = await _draft(db_session, dept)
        service = FinanceService(db_session)
        await service.submit_expense_report(er.id, dept["org_id"])

        with pytest.raises(ValueError, match="only while it is a draft"):
            await service.cancel_expense_report(
                er.id, dept["org_id"], requester_id=dept["member_id"]
            )

    async def test_the_office_cancels_a_submitted_report_and_closes_its_chain(
        self, db_session, dept
    ):
        await _chain(db_session, dept, ApprovalEntityType.EXPENSE_REPORT)
        er = await _draft(db_session, dept)
        service = FinanceService(db_session)
        await service.submit_expense_report(er.id, dept["org_id"])
        assert await _step_statuses(db_session, er.id) == [ApprovalStepStatus.PENDING]

        cancelled = await service.cancel_expense_report(er.id, dept["org_id"])

        assert cancelled.status == ExpenseReportStatus.CANCELLED
        assert await _step_statuses(db_session, er.id) == [ApprovalStepStatus.SKIPPED]

    async def test_a_paid_report_cannot_be_cancelled(self, db_session, dept):
        er = await _approved_report(db_session, dept)
        service = FinanceService(db_session)
        await service.mark_expense_paid(
            er.id, dept["org_id"], "cash", acted_by=dept["user_id"]
        )

        with pytest.raises(ValueError, match="Paid reports"):
            await service.cancel_expense_report(er.id, dept["org_id"])

    async def test_a_report_a_check_is_paying_is_not_cancelled(self, db_session, dept):
        er = await _approved_report(db_session, dept)
        cr = await _approved_check(db_session, dept, er)

        with pytest.raises(ReimbursementLinkError, match=cr.request_number):
            await FinanceService(db_session).cancel_expense_report(
                er.id, dept["org_id"]
            )

    async def test_withdrawing_a_claim_frees_the_purchase(self, db_session, dept):
        first = await _claim(db_session, dept, amount="250.00")
        await FinanceService(db_session).cancel_expense_report(
            first.id, dept["org_id"], requester_id=dept["member_id"]
        )

        second = await _claim(db_session, dept, amount="190.00")

        assert second.id != first.id
        assert second.purchase_request_id == dept["pr"].id

    async def test_a_cancelled_report_stops_counting_against_its_advance(
        self, db_session, dept
    ):
        advance = await _advance(db_session, dept, dept["member_id"])
        service = FinanceService(db_session)
        er = await service.create_expense_report(
            dept["org_id"],
            dept["member_id"],
            line_items=[
                {
                    "description": "Hotel",
                    "amount": Decimal("120.00"),
                    "date_incurred": datetime.now(timezone.utc),
                    "expense_type": "travel",
                    "receipt_document_id": dept["receipt_id"],
                }
            ],
            fiscal_year_id=dept["fy_id"],
            title="Conference",
            advance_id=advance.id,
        )
        await service.submit_expense_report(er.id, dept["org_id"])

        async def outstanding():
            balances = await advance_balances(
                db_session, dept["org_id"], advance_ids=[advance.id]
            )
            return balances[advance.id].outstanding

        assert await outstanding() == Decimal("180.00")
        await service.cancel_expense_report(er.id, dept["org_id"])
        assert await outstanding() == Decimal("300.00")


class TestWithdrawingACheckRequest:
    async def _draft_check(self, db, dept):
        return await FinanceService(db).create_check_request(
            dept["org_id"],
            dept["member_id"],
            fiscal_year_id=dept["fy_id"],
            payee_name="Hose Supply Co",
            amount=Decimal("80.00"),
        )

    async def test_the_member_withdraws_their_draft(self, db_session, dept):
        cr = await self._draft_check(db_session, dept)

        cancelled = await FinanceService(db_session).cancel_check_request(
            cr.id, dept["org_id"], requester_id=dept["member_id"]
        )

        assert cancelled.status == CheckRequestStatus.CANCELLED

    async def test_the_member_cannot_withdraw_a_submitted_request(
        self, db_session, dept
    ):
        cr = await self._draft_check(db_session, dept)
        service = FinanceService(db_session)
        await service.submit_check_request(cr.id, dept["org_id"])

        with pytest.raises(ValueError, match="only while it is a draft"):
            await service.cancel_check_request(
                cr.id, dept["org_id"], requester_id=dept["member_id"]
            )

    async def test_an_issued_check_is_voided_not_cancelled(self, db_session, dept):
        er = await _approved_report(db_session, dept)
        cr = await _issued(db_session, dept, er)

        with pytest.raises(ValueError, match="voided, not cancelled"):
            await FinanceService(db_session).cancel_check_request(cr.id, dept["org_id"])

    async def test_a_cancelled_reimbursement_check_leaves_the_report_to_pay_again(
        self, db_session, dept
    ):
        er = await _approved_report(db_session, dept)
        service = FinanceService(db_session)
        cr = await service.request_reimbursement_check(er.id, dept["org_id"])

        await service.cancel_check_request(cr.id, dept["org_id"])

        await db_session.refresh(er)
        assert er.status == ExpenseReportStatus.APPROVED
        second = await service.request_reimbursement_check(er.id, dept["org_id"])
        assert second.id != cr.id


class TestTheEndpoints:
    async def test_the_member_edits_a_line_in_camel_case(self, db_session, dept):
        er = await _draft(db_session, dept)
        async with await _client_as(
            db_session, dept["org_id"], dept["member_id"], ["finance.request"]
        ) as client:
            response = await client.put(
                f"/finance/expense-reports/{er.id}/items/{_line(er).id}",
                json={"amount": "41.00", "dateIncurred": "2026-03-01T12:00:00Z"},
            )
            report = await client.get(f"/finance/expense-reports/{er.id}")

        assert response.status_code == 200, response.text
        assert response.json()["amount"] == "41.00"
        assert report.json()["totalAmount"] == "101.00"

    async def test_the_member_removes_a_line_and_withdraws_the_report(
        self, db_session, dept
    ):
        er = await _draft(db_session, dept)
        async with await _client_as(
            db_session, dept["org_id"], dept["member_id"], ["finance.request"]
        ) as client:
            removed = await client.delete(
                f"/finance/expense-reports/{er.id}/items/{_line(er).id}"
            )
            withdrawn = await client.post(f"/finance/expense-reports/{er.id}/cancel")

        assert removed.status_code == 204
        assert withdrawn.status_code == 200, withdrawn.text
        assert withdrawn.json()["status"] == "cancelled"

    async def test_another_members_records_are_not_found(self, db_session, dept):
        er = await _draft(db_session, dept)
        other = await _user(db_session, dept["org_id"])
        async with await _client_as(
            db_session, dept["org_id"], other, ["finance.request"]
        ) as client:
            edit = await client.put(
                f"/finance/expense-reports/{er.id}/items/{_line(er).id}",
                json={"amount": "1.00"},
            )
            cancel = await client.post(f"/finance/expense-reports/{er.id}/cancel")

        assert (edit.status_code, cancel.status_code) == (404, 404)

    async def test_the_office_cancels_a_check_request(self, db_session, dept):
        cr = await FinanceService(db_session).create_check_request(
            dept["org_id"],
            dept["member_id"],
            fiscal_year_id=dept["fy_id"],
            payee_name="Hose Supply Co",
            amount=Decimal("80.00"),
        )
        await FinanceService(db_session).submit_check_request(cr.id, dept["org_id"])
        async with await _client_as(
            db_session, dept["org_id"], dept["user_id"], ["finance.manage"]
        ) as client:
            response = await client.post(f"/finance/check-requests/{cr.id}/cancel")

        assert response.status_code == 200, response.text
        assert response.json()["status"] == "cancelled"

"""Receipts on expense report lines: the requirement and who reads them.

Uploading is main's document-backed receipt (``POST …/receipt``, a document
under Finance > Receipts, covered by ``test_finance_receipts.py``). This file
covers what is layered on it: every line needs a receipt before the report
can be submitted, a closing year takes no new receipts from members, and the
report's approvers can open the report and its receipts.
"""

from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.models.finance import (
    ApprovalEntityType,
    ApprovalStepType,
    ExpenseLineItem,
    ExpenseReport,
    FiscalYearStatus,
)
from app.services import file_storage_service, upload_scanning
from app.services.finance_service import FinanceService
from tests.test_finance_budget_owners import _client, _org, _position, _user, _year

pytestmark = [pytest.mark.integration]

PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"


@pytest.fixture
def uploads(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(tmp_path))
    monkeypatch.setattr(upload_scanning, "is_malware_scan_enabled", lambda: False)
    return tmp_path


@pytest.fixture
async def dept(db_session):
    org_id = await _org(db_session, "rcpt")
    other_org = await _org(db_session, "else")
    member_pos = await _position(db_session, org_id, "Member", ["finance.request"])
    treasurer_pos = await _position(
        db_session, org_id, "Treasurer", ["finance.request", "finance.manage"]
    )
    chief_pos = await _position(
        db_session, org_id, "Chief", ["finance.request", "finance.approve"]
    )
    captain_pos = await _position(
        db_session, org_id, "Captain", ["finance.request", "finance.approve"]
    )
    people = {
        "alice": await _user(db_session, org_id, "alice", [member_pos]),
        "bob": await _user(db_session, org_id, "bob", [member_pos]),
        "treasurer": await _user(db_session, org_id, "treasurer", [treasurer_pos]),
        "chief": await _user(db_session, org_id, "chief", [chief_pos]),
        "captain": await _user(db_session, org_id, "captain", [captain_pos]),
    }
    foreign_pos = await _position(
        db_session, other_org, "Treasurer", ["finance.request", "finance.manage"]
    )
    people["foreign"] = await _user(db_session, other_org, "foreign", [foreign_pos])
    year = _year(
        org_id, "FY2026", FiscalYearStatus.ACTIVE, people["treasurer"].id, 2026
    )
    db_session.add(year)
    await db_session.flush()
    return {"org_id": org_id, "fy_id": year.id, **people}


async def _report(db, dept, lines=("Hotel", "Parking")) -> ExpenseReport:
    return await FinanceService(db).create_expense_report(
        dept["org_id"],
        dept["alice"].id,
        fiscal_year_id=dept["fy_id"],
        title="Conference",
        line_items=[
            {
                "description": name,
                "amount": 50,
                "date_incurred": datetime(2026, 3, 1, tzinfo=timezone.utc),
            }
            for name in lines
        ],
    )


async def _lines(db, report_id) -> list[ExpenseLineItem]:
    result = await db.execute(
        select(ExpenseLineItem)
        .where(ExpenseLineItem.expense_report_id == report_id)
        .order_by(ExpenseLineItem.description)
        .execution_options(populate_existing=True)
    )
    return list(result.scalars())


def _path(report_id, item_id) -> str:
    return f"/finance/expense-reports/{report_id}/items/{item_id}/receipt"


async def _upload(db, user, report_id, item_id, content=PDF, name="receipt.pdf"):
    async with _client(db, user) as client:
        return await client.post(
            _path(report_id, item_id),
            files={"file": (name, content, "application/pdf")},
        )


async def _call(db, user, method, path):
    async with _client(db, user) as client:
        return await client.request(method, path)


async def _attach_all(db, dept, report_id) -> None:
    for line in await _lines(db, report_id):
        resp = await _upload(db, dept["alice"], report_id, line.id)
        assert resp.status_code == 200, resp.text


async def _submit(db, dept, report_id):
    return await _call(
        db, dept["alice"], "POST", f"/finance/expense-reports/{report_id}/submit"
    )


class TestTheRequirement:
    async def test_a_report_without_every_receipt_is_not_submitted(
        self, db_session, dept, uploads
    ):
        er = await _report(db_session, dept)
        hotel, _ = await _lines(db_session, er.id)
        await _upload(db_session, dept["alice"], er.id, hotel.id)

        resp = await _submit(db_session, dept, er.id)

        assert resp.status_code == 400
        assert resp.json()["detail"] == (
            'Attach a receipt to every line before submitting. Missing: "Parking".'
        )
        await db_session.refresh(er)
        assert er.status.value == "draft"

    async def test_with_every_receipt_it_is_submitted(self, db_session, dept, uploads):
        er = await _report(db_session, dept)
        await _attach_all(db_session, dept, er.id)

        resp = await _submit(db_session, dept, er.id)

        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "pending_approval"


class TestUploading:
    async def test_the_line_links_the_uploaded_document(
        self, db_session, dept, uploads
    ):
        er = await _report(db_session, dept, lines=("Hotel",))
        (line,) = await _lines(db_session, er.id)

        resp = await _upload(db_session, dept["alice"], er.id, line.id)

        assert resp.status_code == 200, resp.text
        assert resp.json()["receiptDocumentId"]
        (line,) = await _lines(db_session, er.id)
        assert line.receipt_document_id == resp.json()["receiptDocumentId"]

    async def test_a_closing_year_takes_no_new_receipts_from_members(
        self, db_session, dept, uploads
    ):
        er = await _report(db_session, dept, lines=("Hotel",))
        (line,) = await _lines(db_session, er.id)
        await FinanceService(db_session).begin_year_end_close(
            dept["fy_id"], dept["org_id"]
        )

        member = await _upload(db_session, dept["alice"], er.id, line.id)
        office = await _upload(db_session, dept["treasurer"], er.id, line.id)

        assert member.status_code == 400
        assert "closing for year-end" in member.json()["detail"]
        # The finance office may still file evidence for what it settles.
        assert office.status_code == 200, office.text

    async def test_a_locked_year_takes_none_at_all(self, db_session, dept, uploads):
        er = await _report(db_session, dept, lines=("Hotel",))
        (line,) = await _lines(db_session, er.id)
        service = FinanceService(db_session)
        await service.begin_year_end_close(dept["fy_id"], dept["org_id"])
        await service.lock_fiscal_year(
            dept["fy_id"],
            dept["org_id"],
            locked_by=dept["treasurer"].id,
            notes="Reconciled",
        )

        resp = await _upload(db_session, dept["treasurer"], er.id, line.id)

        assert resp.status_code == 400
        assert "locked" in resp.json()["detail"]


class TestWhoReadsThem:
    async def _submitted(self, db_session, dept, chain_approver=None):
        service = FinanceService(db_session)
        if chain_approver is not None:
            await service.create_approval_chain(
                dept["org_id"],
                dept["treasurer"].id,
                name="Expenses",
                applies_to=ApprovalEntityType.EXPENSE_REPORT,
                is_default=True,
                steps=[
                    {
                        "step_order": 1,
                        "name": "Approve",
                        "step_type": ApprovalStepType.APPROVAL,
                        "approver_type": "specific_user",
                        "approver_value": chain_approver.id,
                    }
                ],
            )
        er = await _report(db_session, dept, lines=("Hotel",))
        await _attach_all(db_session, dept, er.id)
        resp = await _submit(db_session, dept, er.id)
        assert resp.status_code == 200, resp.text
        (line,) = await _lines(db_session, er.id)
        return er, line

    async def _reads(self, db_session, user, er, line) -> tuple[int, int]:
        report = await _call(
            db_session, user, "GET", f"/finance/expense-reports/{er.id}"
        )
        receipt = await _call(db_session, user, "GET", _path(er.id, line.id))
        return report.status_code, receipt.status_code

    async def test_the_submitter_and_a_finance_manager_read_it(
        self, db_session, dept, uploads
    ):
        er, line = await self._submitted(db_session, dept)

        for user in (dept["alice"], dept["treasurer"]):
            resp = await _call(db_session, user, "GET", _path(er.id, line.id))
            assert resp.status_code == 200, resp.text
            assert resp.content == PDF
            assert resp.headers["content-type"] == "application/pdf"
            disposition = resp.headers["content-disposition"]
            assert er.report_number in disposition
            assert "Hotel" in disposition

    async def test_the_approver_a_chain_names_reads_it_and_nobody_else(
        self, db_session, dept, uploads
    ):
        er, line = await self._submitted(db_session, dept, chain_approver=dept["chief"])

        assert await self._reads(db_session, dept["chief"], er, line) == (200, 200)
        # Holds finance.approve, but this report's chain names someone else.
        assert await self._reads(db_session, dept["captain"], er, line) == (404, 404)
        assert await self._reads(db_session, dept["bob"], er, line) == (404, 404)
        assert await self._reads(db_session, dept["foreign"], er, line) == (404, 404)

    async def test_any_approver_reads_a_report_no_chain_applies_to(
        self, db_session, dept, uploads
    ):
        er, line = await self._submitted(db_session, dept)

        # Unrouted: any finance.approve holder approves it by hand.
        assert await self._reads(db_session, dept["captain"], er, line) == (200, 200)

    async def test_an_approver_does_not_read_a_draft(self, db_session, dept, uploads):
        er = await _report(db_session, dept, lines=("Hotel",))
        await _attach_all(db_session, dept, er.id)
        (line,) = await _lines(db_session, er.id)

        assert await self._reads(db_session, dept["captain"], er, line) == (404, 404)

    async def test_a_line_without_a_receipt_is_not_found(
        self, db_session, dept, uploads
    ):
        er = await _report(db_session, dept, lines=("Hotel",))
        (line,) = await _lines(db_session, er.id)

        resp = await _call(db_session, dept["alice"], "GET", _path(er.id, line.id))

        assert resp.status_code == 404

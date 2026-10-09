"""Receipts on expense report lines.

Every line of an expense report needs an uploaded receipt before the report
can be submitted. A receipt is stored through FileStorageService under the
organization's ``finance-receipts`` area, changes only while the report is a
draft, and is read by the report's submitter, a finance manager, or one of
its approvers — the approvals queue sends an approver to the report, so they
can open it and its receipts without the org-wide manage grant.
"""

import os
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
from app.services.malware_scan_service import ScanResult
from tests.test_finance_budget_owners import _client, _org, _position, _user, _year

pytestmark = [pytest.mark.integration]

PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"
OTHER_PDF = b"%PDF-1.4\n2 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"


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
        return await client.put(
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
    async def test_the_file_is_stored_in_the_orgs_receipts_area(
        self, db_session, dept, uploads, monkeypatch
    ):
        audit = []

        async def record(**kwargs):
            audit.append(kwargs["event_type"])

        from app.api.v1.endpoints import finance as finance_endpoints

        monkeypatch.setattr(finance_endpoints, "log_audit_event", record)
        er = await _report(db_session, dept, lines=("Hotel",))
        (line,) = await _lines(db_session, er.id)

        resp = await _upload(
            db_session, dept["alice"], er.id, line.id, name="Hotel folio.pdf"
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["hasReceipt"] is True
        assert body["receiptFileName"] == "Hotel folio.pdf"
        assert body["receiptContentType"] == "application/pdf"
        assert body["receiptFileSize"] == len(PDF)
        assert "receiptFilePath" not in body
        (line,) = await _lines(db_session, er.id)
        directory = uploads / dept["org_id"] / "finance-receipts" / er.id
        assert os.path.dirname(line.receipt_file_path) == str(directory)
        assert line.receipt_uploaded_by == dept["alice"].id
        assert audit == ["finance.expense_receipt_attached"]

    async def test_a_new_receipt_replaces_the_old_file(self, db_session, dept, uploads):
        er = await _report(db_session, dept, lines=("Hotel",))
        (line,) = await _lines(db_session, er.id)
        await _upload(db_session, dept["alice"], er.id, line.id)
        (line,) = await _lines(db_session, er.id)
        first = line.receipt_file_path

        resp = await _upload(db_session, dept["alice"], er.id, line.id, OTHER_PDF)

        assert resp.status_code == 200, resp.text
        (line,) = await _lines(db_session, er.id)
        assert line.receipt_file_path != first
        assert not os.path.exists(first)
        assert os.path.exists(line.receipt_file_path)

    async def test_removing_it_clears_the_line_and_the_file(
        self, db_session, dept, uploads
    ):
        er = await _report(db_session, dept, lines=("Hotel",))
        (line,) = await _lines(db_session, er.id)
        await _upload(db_session, dept["alice"], er.id, line.id)
        (line,) = await _lines(db_session, er.id)
        stored = line.receipt_file_path

        resp = await _call(db_session, dept["alice"], "DELETE", _path(er.id, line.id))

        assert resp.status_code == 204, resp.text
        (line,) = await _lines(db_session, er.id)
        assert line.receipt_file_path is None
        assert line.receipt_file_name is None
        assert not os.path.exists(stored)

    async def test_only_a_pdf_or_image_is_taken(self, db_session, dept, uploads):
        er = await _report(db_session, dept, lines=("Hotel",))
        (line,) = await _lines(db_session, er.id)

        resp = await _upload(
            db_session, dept["alice"], er.id, line.id, b"just text\n", "receipt.txt"
        )

        assert resp.status_code == 400
        assert "not allowed" in resp.json()["detail"]
        (line,) = await _lines(db_session, er.id)
        assert line.receipt_file_path is None

    async def test_an_infected_file_is_refused_and_not_kept(
        self, db_session, dept, uploads, monkeypatch
    ):
        monkeypatch.setattr(upload_scanning, "is_malware_scan_enabled", lambda: True)

        async def infected(content):
            return ScanResult(infected=True, signature="Eicar-Test-Signature")

        monkeypatch.setattr(upload_scanning, "scan_bytes", infected)
        er = await _report(db_session, dept, lines=("Hotel",))
        (line,) = await _lines(db_session, er.id)

        resp = await _upload(db_session, dept["alice"], er.id, line.id)

        assert resp.status_code == 400
        (line,) = await _lines(db_session, er.id)
        assert line.receipt_file_path is None
        assert not (uploads / dept["org_id"] / "finance-receipts").exists()

    async def test_another_members_report_is_not_found(self, db_session, dept, uploads):
        er = await _report(db_session, dept, lines=("Hotel",))
        (line,) = await _lines(db_session, er.id)

        for user in (dept["bob"], dept["foreign"]):
            resp = await _upload(db_session, user, er.id, line.id)
            assert resp.status_code == 404, resp.text
        assert not (uploads / dept["org_id"] / "finance-receipts").exists()

    async def test_a_finance_manager_may_attach_one(self, db_session, dept, uploads):
        er = await _report(db_session, dept, lines=("Hotel",))
        (line,) = await _lines(db_session, er.id)

        resp = await _upload(db_session, dept["treasurer"], er.id, line.id)

        assert resp.status_code == 200, resp.text

    async def test_receipts_are_fixed_once_submitted(self, db_session, dept, uploads):
        er = await _report(db_session, dept, lines=("Hotel",))
        await _attach_all(db_session, dept, er.id)
        await _submit(db_session, dept, er.id)
        (line,) = await _lines(db_session, er.id)

        replaced = await _upload(db_session, dept["alice"], er.id, line.id, OTHER_PDF)
        removed = await _call(
            db_session, dept["alice"], "DELETE", _path(er.id, line.id)
        )

        for resp in (replaced, removed):
            assert resp.status_code == 400
            assert "while the report is a draft" in resp.json()["detail"]
        (after,) = await _lines(db_session, er.id)
        assert after.receipt_file_path == line.receipt_file_path

    async def test_a_closing_year_takes_no_new_receipts(
        self, db_session, dept, uploads
    ):
        er = await _report(db_session, dept, lines=("Hotel",))
        (line,) = await _lines(db_session, er.id)
        await FinanceService(db_session).begin_year_end_close(
            dept["fy_id"], dept["org_id"]
        )

        resp = await _upload(db_session, dept["alice"], er.id, line.id)

        assert resp.status_code == 400
        assert "closing for year-end" in resp.json()["detail"]


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

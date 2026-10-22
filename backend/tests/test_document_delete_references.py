"""Deleting a document respects, or tidies, the records that point at it.

* A receipt on a purchase request or expense report past draft is the record
  the finance office approved and paid against. Its foreign key is SET NULL,
  so the delete used to succeed and strip the receipt silently; it is now
  refused, naming the request. A draft's receipt may still go.
* Minutes keep the library copy they were published as in a plain column with
  no foreign key. Deleting that document left the minutes pointing at nothing;
  the reference is now cleared with the delete.
"""

import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import Document, DocumentFolder
from app.models.finance import (
    ExpenseLineItem,
    ExpenseReport,
    ExpenseReportStatus,
    FiscalYearStatus,
    PurchaseRequest,
    PurchaseRequestStatus,
)
from app.models.minute import MeetingMinutes, MinutesStatus
from app.services.documents_service import DocumentsService
from tests.test_finance_budget_owners import _org, _position, _user, _year

pytestmark = pytest.mark.integration


@pytest.fixture
async def dept(db_session: AsyncSession):
    org_id = await _org(db_session, "docref")
    other_org = await _org(db_session, "docref-other")
    pos = await _position(db_session, org_id, "Clerk", ["documents.manage"])
    clerk = await _user(db_session, org_id, "clerk", [pos])
    year = _year(org_id, "FY2026", FiscalYearStatus.ACTIVE, clerk.id, 2026)
    db_session.add(year)
    await db_session.flush()
    return {"org_id": org_id, "other_org": other_org, "clerk": clerk, "fy": year.id}


async def _document(db: AsyncSession, org_id: str, folder_id=None) -> str:
    document = Document(
        organization_id=org_id,
        name="Receipt",
        file_name="receipt.pdf",
        folder_id=folder_id,
    )
    db.add(document)
    await db.flush()
    return document.id


async def _purchase(db, dept, receipt_id, status) -> PurchaseRequest:
    pr = PurchaseRequest(
        organization_id=dept["org_id"],
        request_number=f"PR-{uuid.uuid4().hex[:6]}",
        fiscal_year_id=dept["fy"],
        requested_by=dept["clerk"].id,
        title="Hose",
        estimated_amount=Decimal("120.00"),
        status=status,
        receipt_document_id=receipt_id,
    )
    db.add(pr)
    await db.flush()
    return pr


async def _expense(db, dept, receipt_id, status) -> ExpenseReport:
    report = ExpenseReport(
        organization_id=dept["org_id"],
        report_number=f"ER-{uuid.uuid4().hex[:6]}",
        submitted_by=dept["clerk"].id,
        fiscal_year_id=dept["fy"],
        title="Conference",
        total_amount=Decimal("40.00"),
        status=status,
    )
    db.add(report)
    await db.flush()
    db.add(
        ExpenseLineItem(
            expense_report_id=report.id,
            description="Registration",
            amount=Decimal("40.00"),
            date_incurred=datetime(2026, 3, 1, tzinfo=timezone.utc),
            receipt_document_id=receipt_id,
        )
    )
    await db.flush()
    return report


async def _exists(db: AsyncSession, document_id: str) -> bool:
    result = await db.execute(select(Document.id).where(Document.id == document_id))
    return result.scalar_one_or_none() is not None


async def _delete(db, dept, document_id) -> bool:
    return await DocumentsService(db).delete_document(
        document_id, dept["org_id"], dept["clerk"]
    )


class TestFinanceReceipts:
    async def test_a_submitted_requests_receipt_is_kept(self, db_session, dept):
        receipt_id = await _document(db_session, dept["org_id"])
        pr = await _purchase(
            db_session, dept, receipt_id, PurchaseRequestStatus.PENDING_APPROVAL
        )
        pr_id, number = pr.id, pr.request_number

        with pytest.raises(ValueError, match=number):
            await _delete(db_session, dept, receipt_id)

        assert await _exists(db_session, receipt_id)
        result = await db_session.execute(
            select(PurchaseRequest.receipt_document_id).where(
                PurchaseRequest.id == pr_id
            )
        )
        assert result.scalar_one() == receipt_id

    async def test_a_drafts_receipt_may_go(self, db_session, dept):
        receipt_id = await _document(db_session, dept["org_id"])
        pr = await _purchase(db_session, dept, receipt_id, PurchaseRequestStatus.DRAFT)
        pr_id = pr.id

        assert await _delete(db_session, dept, receipt_id) is True

        assert not await _exists(db_session, receipt_id)
        result = await db_session.execute(
            select(PurchaseRequest.receipt_document_id).where(
                PurchaseRequest.id == pr_id
            )
        )
        assert result.scalar_one() is None

    async def test_a_submitted_reports_line_receipt_is_kept(self, db_session, dept):
        receipt_id = await _document(db_session, dept["org_id"])
        report = await _expense(
            db_session, dept, receipt_id, ExpenseReportStatus.APPROVED
        )
        number = report.report_number

        with pytest.raises(ValueError, match=number):
            await _delete(db_session, dept, receipt_id)
        assert await _exists(db_session, receipt_id)

    async def test_a_draft_reports_line_receipt_may_go(self, db_session, dept):
        receipt_id = await _document(db_session, dept["org_id"])
        await _expense(db_session, dept, receipt_id, ExpenseReportStatus.DRAFT)

        assert await _delete(db_session, dept, receipt_id) is True
        assert not await _exists(db_session, receipt_id)

    async def test_deleting_the_folder_is_refused_too(self, db_session, dept):
        folder = DocumentFolder(organization_id=dept["org_id"], name="Receipts")
        db_session.add(folder)
        await db_session.flush()
        folder_id = folder.id
        receipt_id = await _document(db_session, dept["org_id"], folder_id=folder_id)
        await _purchase(db_session, dept, receipt_id, PurchaseRequestStatus.APPROVED)

        with pytest.raises(ValueError, match="purchase request"):
            await DocumentsService(db_session).delete_folder(
                folder_id, dept["org_id"], dept["clerk"]
            )
        assert await _exists(db_session, receipt_id)


class TestPublishedMinutes:
    async def test_the_minutes_stop_pointing_at_a_deleted_copy(self, db_session, dept):
        document_id = await _document(db_session, dept["org_id"])
        minutes = MeetingMinutes(
            organization_id=dept["org_id"],
            title="Business meeting",
            meeting_date=datetime(2026, 10, 1, tzinfo=timezone.utc),
            status=MinutesStatus.APPROVED,
            published_document_id=document_id,
            published_revision_version=2,
            published_at=datetime(2026, 10, 2, tzinfo=timezone.utc),
        )
        other = MeetingMinutes(
            organization_id=dept["other_org"],
            title="Their meeting",
            meeting_date=datetime(2026, 10, 1, tzinfo=timezone.utc),
            status=MinutesStatus.APPROVED,
            published_document_id=document_id,
            published_revision_version=1,
        )
        db_session.add_all([minutes, other])
        await db_session.flush()
        minutes_id, other_id = minutes.id, other.id

        assert await _delete(db_session, dept, document_id) is True

        result = await db_session.execute(
            select(
                MeetingMinutes.id,
                MeetingMinutes.published_document_id,
                MeetingMinutes.published_revision_version,
                MeetingMinutes.published_at,
            ).where(MeetingMinutes.id.in_([minutes_id, other_id]))
        )
        rows = {row.id: row for row in result.all()}
        assert rows[minutes_id].published_document_id is None
        assert rows[minutes_id].published_revision_version is None
        assert rows[minutes_id].published_at is None
        # Another department's row is never touched by this department's delete.
        assert rows[other_id].published_document_id == document_id

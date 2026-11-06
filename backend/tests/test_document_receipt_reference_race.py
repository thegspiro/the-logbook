"""DOC-31: a document delete's receipt guard against a concurrent finance write.

``DocumentsService._release_document_references`` refuses to delete a document
that is the receipt on a purchase request or expense report past draft. It
used to read those records with a plain SELECT, which under InnoDB's
REPEATABLE READ answers from the snapshot taken at the transaction's first
read. A request submitted after that snapshot still read as a draft, the
delete went through, and the ``SET NULL`` foreign key stripped the receipt
from a submitted request -- the loss the guard exists to prevent.

The fix, and the lock order it agrees with Finance (see the canonical lock
order note at the top of ``app/services/documents_service.py``):

* The guard's reads are locking reads, so they see what was committed after
  the snapshot, and a submit that arrives after them waits for the delete.
* Documents come before Finance: a finance path that will reference a
  document locks the document side first (the reimbursement path locks the
  receipt it copies, the upload paths lock the receipts folder), then its own
  record.
* The delete never waits on a finance row. It reads them with ``NOWAIT`` and
  refuses while one is being changed: a finance writer can hold its record
  and then need the document (the foreign key check on a receipt), and a
  delete waiting on that record would close the cycle.

Real connections, not ``db_session``: a race needs two transactions that
really commit. Every row created is removed at the end.
"""

import asyncio
import io
import time
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from fastapi import UploadFile
from sqlalchemy import select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints.finance import upload_purchase_request_receipt
from app.core.database import database_manager
from app.models.document import Document
from app.models.finance import (
    ExpenseLineItem,
    ExpenseReport,
    ExpenseReportStatus,
    FiscalYear,
    FiscalYearStatus,
    PurchaseRequest,
    PurchaseRequestStatus,
)
from app.models.user import User
from app.services import file_storage_service
from app.services.documents_service import DocumentsService
from app.services.finance_service import FinanceService

pytestmark = pytest.mark.integration

# How long a holder keeps its lock, so the other side is certain to arrive
# while it is held.
_HOLD_SECONDS = 0.6


def _session():
    return database_manager.session_factory()


async def _seed(*, pr_status=PurchaseRequestStatus.DRAFT, with_report=False):
    """A department with a document that is the receipt on a purchase request,
    and, with ``with_report``, a second document that is the receipt on a
    draft expense report's line."""
    org_id, user_id, position_id = (str(uuid.uuid4()) for _ in range(3))
    async with _session() as db:
        await db.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, "
                "timezone, active) VALUES (:id, 'Receipt Race Dept', "
                "'fire_department', :slug, 'UTC', 1)"
            ),
            {"id": org_id, "slug": f"receipt-race-{org_id[:8]}"},
        )
        await db.execute(
            text(
                "INSERT INTO positions (id, organization_id, name, slug, permissions) "
                "VALUES (:id, :org, 'Treasurer', :slug, "
                '\'["finance.manage", "finance.request"]\')'
            ),
            {"id": position_id, "org": org_id, "slug": f"treasurer-{org_id[:8]}"},
        )
        await db.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) VALUES (:id, :org, :un, "
                "'Receipt', 'Racer', :em, 'hashed', 'active')"
            ),
            {
                "id": user_id,
                "org": org_id,
                "un": f"receipt-race-{user_id[:8]}",
                "em": f"receipt-race-{user_id[:8]}@test.example",
            },
        )
        await db.execute(
            text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
            {"u": user_id, "p": position_id},
        )
        year = FiscalYear(
            organization_id=org_id,
            name="FY2026",
            start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
            end_date=datetime(2026, 12, 31, tzinfo=timezone.utc),
            status=FiscalYearStatus.ACTIVE,
            created_by=user_id,
        )
        db.add(year)
        await db.flush()
        folder = await DocumentsService(db).ensure_finance_receipts_folder(org_id)
        receipt = Document(
            organization_id=org_id,
            folder_id=folder.id,
            name="Receipt",
            file_name="receipt.pdf",
        )
        db.add(receipt)
        await db.flush()
        pr = PurchaseRequest(
            organization_id=org_id,
            request_number=f"PR-{uuid.uuid4().hex[:6]}",
            fiscal_year_id=year.id,
            requested_by=user_id,
            title="Hose",
            estimated_amount=Decimal("120.00"),
            status=pr_status,
            receipt_document_id=receipt.id,
        )
        db.add(pr)
        await db.flush()
        seeded = {
            "org": org_id,
            "user": user_id,
            "folder": folder.id,
            "receipt": receipt.id,
            "pr": pr.id,
            "pr_number": pr.request_number,
        }
        if with_report:
            line_receipt = Document(
                organization_id=org_id,
                folder_id=folder.id,
                name="Line receipt",
                file_name="line.pdf",
            )
            db.add(line_receipt)
            await db.flush()
            report = ExpenseReport(
                organization_id=org_id,
                report_number=f"ER-{uuid.uuid4().hex[:6]}",
                submitted_by=user_id,
                fiscal_year_id=year.id,
                title="Conference",
                total_amount=Decimal("40.00"),
                status=ExpenseReportStatus.DRAFT,
            )
            db.add(report)
            await db.flush()
            db.add(
                ExpenseLineItem(
                    expense_report_id=report.id,
                    description="Registration",
                    amount=Decimal("40.00"),
                    date_incurred=datetime.now(timezone.utc),
                    receipt_document_id=line_receipt.id,
                )
            )
            seeded.update(
                line_receipt=line_receipt.id,
                er=report.id,
                er_number=report.report_number,
            )
        await db.commit()
    return seeded


async def _cleanup(org_id: str) -> None:
    async with database_manager.engine.connect() as conn:
        async with conn.begin():
            for statement in (
                # The receipt upload commits an audit event; left behind it
                # shifts every audit-shipping and chain test that runs after
                # this file in a random order (the onboarding race test cleans
                # up the same way).
                "DELETE FROM audit_logs WHERE organization_id = :o",
                "DELETE FROM meeting_minutes WHERE organization_id = :o",
                "DELETE FROM check_requests WHERE organization_id = :o",
                "DELETE li FROM expense_line_items li JOIN expense_reports er "
                "ON er.id = li.expense_report_id WHERE er.organization_id = :o",
                "DELETE FROM expense_reports WHERE organization_id = :o",
                "DELETE FROM purchase_requests WHERE organization_id = :o",
                "DELETE FROM documents WHERE organization_id = :o",
                "DELETE FROM document_folders WHERE organization_id = :o "
                "AND parent_id IS NOT NULL",
                "DELETE FROM document_folders WHERE organization_id = :o",
                "DELETE FROM fiscal_years WHERE organization_id = :o",
                "DELETE up FROM user_positions up JOIN users u ON u.id = up.user_id "
                "WHERE u.organization_id = :o",
                "DELETE FROM positions WHERE organization_id = :o",
                "DELETE FROM users WHERE organization_id = :o",
                "DELETE FROM organizations WHERE id = :o",
            ):
                await conn.execute(text(statement), {"o": org_id})


@pytest.fixture
async def seeded(_initialize_database):
    created = []

    async def make(**kwargs):
        data = await _seed(**kwargs)
        created.append(data["org"])
        return data

    yield make
    for org_id in created:
        await _cleanup(org_id)


async def _receipt_state(seeded_data, record="pr"):
    """(document still exists, the record's receipt reference), read fresh."""
    async with _session() as db:
        exists = await db.scalar(
            select(Document.id).where(Document.id == seeded_data["receipt"])
        )
        if record == "pr":
            reference = await db.scalar(
                select(PurchaseRequest.receipt_document_id).where(
                    PurchaseRequest.id == seeded_data["pr"]
                )
            )
        else:
            reference = await db.scalar(
                select(ExpenseLineItem.receipt_document_id).where(
                    ExpenseLineItem.expense_report_id == seeded_data["er"]
                )
            )
    return exists is not None, reference


class TestTheGuardReadsWhatWasCommittedAfterItsSnapshot:
    """The DOC-31 race itself: the delete's transaction has already read
    something (as every request has, by the time the guard runs) when another
    transaction submits the record and commits."""

    async def test_a_request_submitted_after_the_snapshot_keeps_its_receipt(
        self, seeded
    ):
        data = await seeded()
        async with _session() as deleter, _session() as submitter:
            # The delete's snapshot: the request is still a draft here.
            status = await deleter.scalar(
                select(PurchaseRequest.status).where(PurchaseRequest.id == data["pr"])
            )
            assert status == PurchaseRequestStatus.DRAFT

            await FinanceService(submitter).submit_purchase_request(
                data["pr"], data["org"]
            )
            await submitter.commit()

            with pytest.raises(ValueError, match=data["pr_number"]):
                await DocumentsService(deleter).delete_document(
                    data["receipt"], data["org"]
                )
            await deleter.rollback()

        assert await _receipt_state(data) == (True, data["receipt"]), (
            "a request submitted after the delete's snapshot lost its receipt: "
            "the guard read the snapshot, not what was committed"
        )

    async def test_a_report_submitted_after_the_snapshot_keeps_its_receipt(
        self, seeded
    ):
        data = await seeded(with_report=True)
        data["receipt"] = data["line_receipt"]
        async with _session() as deleter, _session() as submitter:
            status = await deleter.scalar(
                select(ExpenseReport.status).where(ExpenseReport.id == data["er"])
            )
            assert status == ExpenseReportStatus.DRAFT

            await FinanceService(submitter).submit_expense_report(
                data["er"], data["org"]
            )
            await submitter.commit()

            with pytest.raises(ValueError, match=data["er_number"]):
                await DocumentsService(deleter).delete_document(
                    data["receipt"], data["org"]
                )
            await deleter.rollback()

        assert await _receipt_state(data, record="er") == (True, data["receipt"])


class TestASubmitArrivingAfterTheGuardWaits:
    async def test_the_submit_waits_for_the_delete_to_finish(self, seeded):
        data = await seeded()
        guard_passed = asyncio.Event()
        submitted = asyncio.Event()

        async def delete():
            async with _session() as deleter:
                await DocumentsService(deleter)._release_document_references(
                    {data["receipt"]}, data["org"]
                )
                guard_passed.set()
                await asyncio.sleep(_HOLD_SECONDS)
                # Still a draft as far as anyone can commit: the submit has
                # not got past the request's row.
                was_waiting = not submitted.is_set()
                await deleter.execute(
                    text("DELETE FROM documents WHERE id = :d"),
                    {"d": data["receipt"]},
                )
                await deleter.commit()
                return was_waiting

        async def submit():
            await guard_passed.wait()
            async with _session() as submitter:
                pr = await FinanceService(submitter).submit_purchase_request(
                    data["pr"], data["org"]
                )
                submitted.set()
                await submitter.commit()
                return pr.receipt_document_id

        was_waiting, receipt_after = await asyncio.gather(delete(), submit())

        assert was_waiting, (
            "the submit moved the request past draft while the delete that had "
            "just found it a draft was still open"
        )
        # The draft lost its receipt, which a draft may; the submit saw it go.
        assert receipt_after is None

    async def test_a_delete_meeting_a_submit_in_flight_refuses_at_once(self, seeded):
        data = await seeded()
        submit_flushed = asyncio.Event()

        async def submit():
            async with _session() as submitter:
                await FinanceService(submitter).submit_purchase_request(
                    data["pr"], data["org"]
                )
                submit_flushed.set()
                await asyncio.sleep(_HOLD_SECONDS)
                await submitter.commit()

        async def delete():
            await submit_flushed.wait()
            started = time.monotonic()
            async with _session() as deleter:
                try:
                    await DocumentsService(deleter).delete_document(
                        data["receipt"], data["org"]
                    )
                    return "deleted", time.monotonic() - started
                except ValueError as exc:
                    await deleter.rollback()
                    return str(exc), time.monotonic() - started

        _, (outcome, elapsed) = await asyncio.gather(submit(), delete())

        assert "being changed" in outcome, outcome
        assert elapsed < _HOLD_SECONDS, (
            f"the delete waited {elapsed:.2f}s on a finance row; it must not "
            "wait on one (see the module docstring)"
        )
        assert await _receipt_state(data) == (True, data["receipt"])


async def _purchase_is_free(pr_id: str) -> bool:
    """Whether the purchase request's row can be locked right now."""
    async with _session() as probe:
        try:
            await probe.execute(
                select(PurchaseRequest.id)
                .where(PurchaseRequest.id == pr_id)
                .with_for_update(nowait=True)
            )
            return True
        except OperationalError:
            return False
        finally:
            await probe.rollback()


class TestFinanceTakesTheDocumentSideFirst:
    """While the document side is locked, a finance path that will reference
    it waits *before* locking its own record -- the agreed order. Taking the
    record first and the document second is the order that, once the delete
    reads finance rows with a lock, would make the two wait on each other."""

    async def test_a_reimbursement_locks_the_receipt_before_the_purchase(self, seeded):
        data = await seeded(pr_status=PurchaseRequestStatus.APPROVED)
        blocked = asyncio.Event()

        async def hold_receipt():
            async with _session() as holder:
                await holder.execute(
                    select(Document.id)
                    .where(Document.id == data["receipt"])
                    .with_for_update()
                )
                blocked.set()
                await asyncio.sleep(_HOLD_SECONDS)
                free = await _purchase_is_free(data["pr"])
                await holder.rollback()
                return free

        async def reimburse():
            await blocked.wait()
            async with _session() as claimant:
                report = await FinanceService(claimant).create_reimbursement_report(
                    data["pr"], data["org"], data["user"], requester_scope=None
                )
                await claimant.commit()
                return report.line_items[0].receipt_document_id

        free, copied = await asyncio.gather(hold_receipt(), reimburse())

        assert free, (
            "the reimbursement held the purchase request while it waited for "
            "the receipt -- Finance before Documents, the order the delete path "
            "does not take"
        )
        assert copied == data["receipt"]

    async def test_a_receipt_upload_locks_the_folder_before_the_purchase(
        self, seeded, tmp_path, monkeypatch
    ):
        monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(tmp_path))
        data = await seeded()
        blocked = asyncio.Event()

        async def hold_folder():
            async with _session() as holder:
                await holder.execute(
                    text("SELECT id FROM document_folders WHERE id = :f FOR UPDATE"),
                    {"f": data["folder"]},
                )
                blocked.set()
                await asyncio.sleep(_HOLD_SECONDS)
                free = await _purchase_is_free(data["pr"])
                await holder.rollback()
                return free

        async def upload():
            await blocked.wait()
            async with _session() as uploader:
                user = (
                    await uploader.execute(
                        select(User)
                        .where(User.id == data["user"])
                        .options(selectinload(User.positions))
                    )
                ).scalar_one()
                response = await upload_purchase_request_receipt(
                    pr_id=data["pr"],
                    file=UploadFile(
                        file=io.BytesIO(b"%PDF-1.4 receipt"), filename="r.pdf"
                    ),
                    db=uploader,
                    current_user=user,
                )
                await uploader.commit()
                return response.receipt_document_id

        free, attached = await asyncio.gather(hold_folder(), upload())

        assert free, (
            "the upload held the purchase request while it waited for the "
            "receipts folder -- Finance before Documents"
        )
        assert attached not in (None, data["receipt"])

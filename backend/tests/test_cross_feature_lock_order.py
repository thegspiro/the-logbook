"""Two lock-order cycles found while agreeing DOC-31's order.

* **Finance against itself.** A purchase request and the expense report that
  claims it back were locked in opposite orders: submitting the report, paying
  it, and issuing or voiding the check that pays it locked the report and then
  the purchase; cancelling or paying the purchase, and raising the claim,
  locked the purchase and then its live report. Purchase first is now the
  order everywhere.
* **Minutes against a document delete.** Reopening or republishing minutes
  locks the minutes row and then writes its library copy; a document delete
  holds the document and then cleared every minutes row pointing at it -- and,
  with ``published_document_id`` unindexed, locked every minutes row in the
  department doing so. The column is indexed now, and the delete takes the
  referencing rows with NOWAIT, so it never waits on minutes.

The canonical lock order is written out at the top of
``app/services/documents_service.py``. Real connections: a lock-order defect
needs two transactions that really hold their locks.
"""

import asyncio
import time
from datetime import datetime, timezone

import pytest
from sqlalchemy import select, update
from sqlalchemy.exc import OperationalError

from app.core.database import database_manager
from app.models.document import Document
from app.models.finance import (
    CheckRequest,
    CheckRequestStatus,
    ExpenseReport,
    ExpenseReportStatus,
    PurchaseRequest,
    PurchaseRequestStatus,
)
from app.models.minute import MeetingMinutes, MinutesStatus
from app.services.documents_service import DocumentsService
from app.services.finance_reimbursement import live_report_for_purchase
from app.services.finance_service import FinanceService
from app.services.minute_service import MinuteService
from app.utils.document_locks import ReferenceRowBusy
from tests.test_document_receipt_reference_race import _cleanup, _seed

pytestmark = pytest.mark.integration

_HOLD_SECONDS = 0.6


def _session():
    return database_manager.session_factory()


@pytest.fixture
async def dept(_initialize_database):
    created = []

    async def make(**kwargs):
        data = await _seed(**kwargs)
        created.append(data["org"])
        return data

    yield make
    for org_id in created:
        await _cleanup(org_id)


async def _row_is_free(model, row_id: str) -> bool:
    """Whether the row can be locked right now, without waiting."""
    async with _session() as probe:
        try:
            await probe.execute(
                select(model.id).where(model.id == row_id).with_for_update(nowait=True)
            )
            return True
        except OperationalError:
            return False
        finally:
            await probe.rollback()


async def _claimed_purchase(dept, report_status=None):
    """An approved purchase with a reimbursement report claiming it back."""
    data = await dept(pr_status=PurchaseRequestStatus.APPROVED)
    async with _session() as db:
        report = await FinanceService(db).create_reimbursement_report(
            data["pr"], data["org"], data["user"], requester_scope=None
        )
        data["er"] = report.id
        if report_status is not None:
            await db.execute(
                update(ExpenseReport)
                .where(ExpenseReport.id == report.id)
                .values(status=report_status)
            )
        await db.commit()
    return data


async def _while_purchase_is_held(data, run):
    """Hold the purchase request's lock, start ``run``, and report whether the
    report was still free once ``run`` had blocked on the purchase."""
    held = asyncio.Event()

    async def holder():
        async with _session() as db:
            await db.execute(
                select(PurchaseRequest.id)
                .where(PurchaseRequest.id == data["pr"])
                .with_for_update()
            )
            held.set()
            await asyncio.sleep(_HOLD_SECONDS)
            free = await _row_is_free(ExpenseReport, data["er"])
            await db.rollback()
            return free

    async def other():
        await held.wait()
        async with _session() as db:
            result = await run(db)
            await db.commit()
            return result

    return await asyncio.gather(holder(), other())


class TestPurchaseBeforeItsReport:
    async def test_paying_a_report_and_cancelling_its_purchase_do_not_deadlock(
        self, dept
    ):
        """The cycle itself: the purchase side holds the purchase and asks for
        the report (``live_report_for_purchase``, as cancel and pay do) while
        paying the report runs. Report-then-purchase made this a deadlock."""
        data = await _claimed_purchase(dept, ExpenseReportStatus.APPROVED)
        held = asyncio.Event()

        async def purchase_side():
            async with _session() as db:
                await db.execute(
                    select(PurchaseRequest.id)
                    .where(PurchaseRequest.id == data["pr"])
                    .with_for_update()
                )
                held.set()
                await asyncio.sleep(_HOLD_SECONDS)
                try:
                    report = await live_report_for_purchase(db, data["org"], data["pr"])
                    return report.id if report else None
                except OperationalError as exc:
                    return f"error {exc.orig.args[0]}"
                finally:
                    await db.rollback()

        async def pay_report():
            await held.wait()
            async with _session() as db:
                try:
                    paid = await FinanceService(db).mark_expense_paid(
                        data["er"], data["org"], "cash"
                    )
                    await db.commit()
                    return paid.status
                except OperationalError as exc:
                    await db.rollback()
                    return f"error {exc.orig.args[0]}"

        seen, paid = await asyncio.gather(purchase_side(), pay_report())

        assert (seen, paid) == (data["er"], ExpenseReportStatus.PAID), (
            f"purchase side saw {seen!r}, paying the report gave {paid!r}; "
            "error 1213 is the deadlock between report-then-purchase and "
            "purchase-then-report"
        )

    async def test_submitting_a_claim_locks_the_purchase_first(self, dept):
        data = await _claimed_purchase(dept)
        free, _ = await _while_purchase_is_held(
            data,
            lambda db: FinanceService(db).submit_expense_report(
                data["er"], data["org"]
            ),
        )
        assert free, "submit locked the report and then waited for its purchase"

    async def test_issuing_the_check_that_pays_a_claim_locks_the_purchase_first(
        self, dept
    ):
        data = await _claimed_purchase(dept, ExpenseReportStatus.APPROVED)
        async with _session() as db:
            check = await FinanceService(db).request_reimbursement_check(
                data["er"], data["org"]
            )
            await db.execute(
                update(CheckRequest)
                .where(CheckRequest.id == check.id)
                .values(status=CheckRequestStatus.APPROVED)
            )
            await db.commit()
            check_id = check.id

        free, issued = await _while_purchase_is_held(
            data,
            lambda db: FinanceService(db).issue_check(check_id, data["org"], "1001"),
        )
        assert free, "issuing the check locked the report before its purchase"
        assert issued.status == CheckRequestStatus.ISSUED


async def _minutes(db, org_id, published_document_id=None) -> str:
    minutes = MeetingMinutes(
        organization_id=org_id,
        title="Business meeting",
        meeting_date=datetime(2026, 10, 1, 19, 0, tzinfo=timezone.utc),
        status=MinutesStatus.APPROVED,
        published_document_id=published_document_id,
    )
    db.add(minutes)
    await db.flush()
    return minutes.id


async def _library_copy(dept):
    """A document that is the published copy of approved minutes, and a second
    set of minutes in the same department that points at nothing."""
    data = await dept()
    async with _session() as db:
        copy = Document(
            organization_id=data["org"], name="Minutes", file_name="minutes.html"
        )
        db.add(copy)
        await db.flush()
        data["copy"] = copy.id
        data["minutes"] = await _minutes(db, data["org"], copy.id)
        data["other_minutes"] = await _minutes(db, data["org"])
        await db.commit()
    return data


async def _hold_minutes(minutes_id, held: asyncio.Event):
    async with _session() as db:
        await db.execute(
            select(MeetingMinutes.id)
            .where(MeetingMinutes.id == minutes_id)
            .with_for_update()
        )
        held.set()
        await asyncio.sleep(_HOLD_SECONDS)
        await db.rollback()


async def _timed_delete(data, document_id, held: asyncio.Event):
    await held.wait()
    started = time.monotonic()
    async with _session() as db:
        try:
            await DocumentsService(db).delete_document(document_id, data["org"])
            outcome = "deleted"
        except ValueError as exc:
            await db.rollback()
            outcome = str(exc)
    return outcome, time.monotonic() - started


class TestADocumentDeleteNeverWaitsOnMinutes:
    async def test_minutes_that_do_not_point_at_the_document_are_not_locked(self, dept):
        data = await _library_copy(dept)
        async with _session() as db:
            unrelated = Document(
                organization_id=data["org"], name="Flyer", file_name="flyer.pdf"
            )
            db.add(unrelated)
            await db.commit()
            unrelated_id = unrelated.id
        held = asyncio.Event()

        _, (outcome, elapsed) = await asyncio.gather(
            _hold_minutes(data["other_minutes"], held),
            _timed_delete(data, unrelated_id, held),
        )

        assert outcome == "deleted"
        assert elapsed < _HOLD_SECONDS, (
            f"deleting a document no minutes point at waited {elapsed:.2f}s on "
            "an unrelated minutes row: the clear scanned the department's minutes"
        )

    async def test_a_delete_meeting_its_minutes_in_flight_refuses_at_once(self, dept):
        data = await _library_copy(dept)
        held = asyncio.Event()

        _, (outcome, elapsed) = await asyncio.gather(
            _hold_minutes(data["minutes"], held),
            _timed_delete(data, data["copy"], held),
        )

        assert "being changed" in outcome, outcome
        assert elapsed < _HOLD_SECONDS

    async def test_reopening_minutes_and_deleting_their_copy_do_not_deadlock(
        self, dept
    ):
        """The cycle itself: reopening locks the minutes and then flags the
        copy; the delete holds the copy and then clears the minutes."""
        data = await _library_copy(dept)
        copy_held = asyncio.Event()

        async def delete_side():
            async with _session() as db:
                service = DocumentsService(db)
                await service.get_document_by_id(
                    data["copy"], data["org"], for_update=True
                )
                copy_held.set()
                # Long enough for the reopen to lock the minutes and block on
                # the copy.
                await asyncio.sleep(_HOLD_SECONDS)
                try:
                    await service._release_document_references(
                        {data["copy"]}, data["org"]
                    )
                    return "released"
                except ReferenceRowBusy:
                    return "refused"
                except OperationalError as exc:
                    return f"error {exc.orig.args[0]}"
                finally:
                    await db.rollback()

        async def reopen():
            await copy_held.wait()
            async with _session() as db:
                try:
                    reopened = await MinuteService(db).reopen_minutes(
                        data["minutes"], data["org"], None, "Typo in motion 3"
                    )
                    return reopened is not None
                except OperationalError as exc:
                    await db.rollback()
                    return f"error {exc.orig.args[0]}"

        deleted, reopened = await asyncio.gather(delete_side(), reopen())

        assert (deleted, reopened) == ("refused", True), (
            f"delete side {deleted!r}, reopen {reopened!r}; error 1213 is the "
            "deadlock between minutes-then-copy and copy-then-minutes"
        )

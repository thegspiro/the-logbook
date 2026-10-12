"""The QuickBooks export remembers what it sent, and reverses voided checks.

QuickBooks imports the same journal entry twice without complaint (its
duplicate-number warning has to be off for this import), so the export, not
QuickBooks, keeps the books single:

* a payment a complete export carried is left out of the next one, unless the
  Treasurer asks to send it again;
* nothing is stamped until the whole file has been produced, so an
  interrupted export leaves its payments for the next;
* a check voided after it was exported gets a reversing entry, against the
  accounts the original posted to, dated the day it was voided — once;
* two exports cannot run at once, or both would carry the same payments;
* the migration stamps what earlier exports already carried.
"""

import csv
import importlib.util
import io
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import (
    Budget,
    CheckRequest,
    CheckRequestStatus,
    ExpenseReport,
    ExportLog,
    PurchaseRequest,
    PurchaseRequestStatus,
)
from app.services.finance_service import ExportInProgressError, FinanceService
from tests.test_finance_quickbooks_export import (
    PAID,
    RANGE,
    _client_with,
    _logs,
    make_books,
)

pytestmark = [pytest.mark.integration]

VOIDED = datetime(2026, 3, 20, 14, 0, tzinfo=timezone.utc)


@pytest.fixture
async def books(db_session: AsyncSession):
    return await make_books(db_session)


async def _rows(db: AsyncSession, org_id: str, user_id: str, **kwargs) -> list:
    stream = await FinanceService(db).generate_export(org_id, user_id, *RANGE, **kwargs)
    content = "".join([chunk async for chunk in stream])
    return list(csv.reader(io.StringIO(content)))[1:]


async def _export(db, books, **kwargs) -> list:
    return await _rows(db, books["org_id"], books["user_id"], **kwargs)


def _numbers(rows) -> list[str]:
    return sorted({row[0] for row in rows})


async def _check(db: AsyncSession, org_id: str) -> CheckRequest:
    result = await db.execute(
        select(CheckRequest)
        .where(CheckRequest.organization_id == org_id)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def _fresh(db: AsyncSession, model, org_id: str):
    result = await db.execute(
        select(model)
        .where(model.organization_id == org_id)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def _void(db: AsyncSession, org_id: str, when: datetime = VOIDED) -> None:
    check = await _check(db, org_id)
    check.status = CheckRequestStatus.VOIDED
    check.voided_at = when
    await db.flush()


ALL = ["CR-2026-0001", "ER-2026-0001", "PR-2026-0001"]


class TestSentOnce:
    async def test_a_second_export_leaves_out_what_the_first_sent(
        self, db_session, books
    ):
        first = await _export(db_session, books)
        second = await _export(db_session, books)

        assert _numbers(first) == ALL
        assert second == []
        logs = await _logs(db_session, books["org_id"])
        assert [log.status for log in logs] == ["successful", "successful"]
        for model in (PurchaseRequest, ExpenseReport, CheckRequest):
            row = await _fresh(db_session, model, books["org_id"])
            assert row.qb_exported_at is not None
            assert row.qb_export_log_id in {log.id for log in logs}

    async def test_the_check_keeps_the_accounts_it_was_posted_to(
        self, db_session, books
    ):
        await _export(db_session, books)

        check = await _check(db_session, books["org_id"])
        assert (check.qb_export_account, check.qb_export_offset_account) == (
            "Vehicle Expense:Fuel",
            "Operating Checking",
        )

    async def test_a_payment_made_since_goes_out_alone(self, db_session, books):
        await _export(db_session, books)
        purchase = books["purchase"]
        db_session.add(
            PurchaseRequest(
                organization_id=books["org_id"],
                request_number="PR-2026-0002",
                fiscal_year_id=purchase.fiscal_year_id,
                budget_id=purchase.budget_id,
                requested_by=books["user_id"],
                title="Manikins",
                estimated_amount=Decimal("90"),
                status=PurchaseRequestStatus.PAID,
                paid_at=PAID + timedelta(days=5),
            )
        )
        await db_session.flush()

        assert _numbers(await _export(db_session, books)) == ["PR-2026-0002"]

    async def test_sending_again_includes_everything_and_restamps(
        self, db_session, books
    ):
        await _export(db_session, books)
        (first,) = await _logs(db_session, books["org_id"])
        again = await _export(db_session, books, include_exported=True)

        assert _numbers(again) == ALL
        (second,) = [
            log for log in await _logs(db_session, books["org_id"]) if log is not first
        ]
        purchase = await _fresh(db_session, PurchaseRequest, books["org_id"])
        assert purchase.qb_export_log_id == second.id

    async def test_an_interrupted_export_stamps_nothing(self, db_session, books):
        stream = await FinanceService(db_session).generate_export(
            books["org_id"], books["user_id"], *RANGE
        )
        await anext(stream)  # the header, then the client went away
        await stream.aclose()

        for model in (PurchaseRequest, ExpenseReport, CheckRequest):
            row = await _fresh(db_session, model, books["org_id"])
            assert row.qb_exported_at is None
        assert _numbers(await _export(db_session, books)) == ALL


class TestVoidedChecks:
    async def test_a_check_voided_after_export_is_reversed_once(
        self, db_session, books
    ):
        await _export(db_session, books)
        await _void(db_session, books["org_id"])

        reversal = await _export(db_session, books)
        after = await _export(db_session, books)

        description = "County Fuel Depot (check 1042), voided"
        assert reversal == [
            [
                "CR-2026-0001-V",
                "03/20/2026",
                "Void: March diesel",
                "Operating Checking",
                "80.00",
                "",
                description,
            ],
            [
                "CR-2026-0001-V",
                "03/20/2026",
                "Void: March diesel",
                "Vehicle Expense:Fuel",
                "",
                "80.00",
                description,
            ],
        ]
        assert after == []
        check = await _check(db_session, books["org_id"])
        assert check.qb_void_exported_at is not None
        assert check.qb_void_export_log_id is not None

    async def test_the_reversal_uses_the_accounts_the_original_posted_to(
        self, db_session, books
    ):
        await _export(db_session, books)
        books["fuel_map"].qb_account_name = "Apparatus Fuel"
        await _void(db_session, books["org_id"])

        reversal = await _export(db_session, books)

        assert [row[3] for row in reversal] == [
            "Operating Checking",
            "Vehicle Expense:Fuel",
        ]

    async def test_a_check_voided_before_any_export_is_left_out(
        self, db_session, books
    ):
        await _void(db_session, books["org_id"])

        assert _numbers(await _export(db_session, books)) == [
            "ER-2026-0001",
            "PR-2026-0001",
        ]

    async def test_a_void_outside_the_period_waits_for_the_period_covering_it(
        self, db_session, books
    ):
        await _export(db_session, books)
        await _void(db_session, books["org_id"], when=datetime(2026, 4, 2, 12, 0))

        assert await _export(db_session, books) == []
        check = await _check(db_session, books["org_id"])
        assert check.qb_void_exported_at is None

    async def test_sending_a_period_again_includes_the_voided_original(
        self, db_session, books
    ):
        await _export(db_session, books)
        await _void(db_session, books["org_id"])
        await _export(db_session, books)

        again = await _export(db_session, books, include_exported=True)

        assert "CR-2026-0001" in _numbers(again)
        assert "CR-2026-0001-V" in _numbers(again)

    async def test_voiding_records_when(self, db_session, books):
        check = await _check(db_session, books["org_id"])
        budget = await db_session.get(Budget, check.budget_id)
        budget.amount_spent = Decimal("80.00")
        await db_session.flush()

        voided = await FinanceService(db_session).void_check(check.id, books["org_id"])

        assert voided.voided_at is not None


class TestOneExportAtATime:
    async def _pending(self, db, books, started: datetime) -> ExportLog:
        log = ExportLog(
            organization_id=books["org_id"],
            export_type="transactions",
            date_range_start=RANGE[0],
            date_range_end=RANGE[1],
            record_count=0,
            file_format="csv",
            exported_by=books["user_id"],
            exported_at=started,
            status="pending",
        )
        db.add(log)
        # Committed, as the other request's export would be.
        await db.commit()
        return log

    async def test_a_running_export_holds_off_another(self, db_session, books):
        await self._pending(db_session, books, datetime.now(timezone.utc))

        with pytest.raises(ExportInProgressError):
            await FinanceService(db_session).generate_export(
                books["org_id"], books["user_id"], *RANGE
            )

        assert len(await _logs(db_session, books["org_id"])) == 1

    async def test_one_left_pending_by_a_crash_stops_blocking(self, db_session, books):
        stale = datetime.now(timezone.utc) - timedelta(hours=1)
        await self._pending(db_session, books, stale)

        assert _numbers(await _export(db_session, books)) == ALL

    async def test_the_endpoint_answers_409(self, db_session, books):
        await self._pending(db_session, books, datetime.now(timezone.utc))
        async with await _client_with(
            db_session, books["org_id"], ["finance.manage"]
        ) as client:
            resp = await client.post(
                "/finance/export/transactions",
                json={
                    "dateRangeStart": RANGE[0].isoformat(),
                    "dateRangeEnd": RANGE[1].isoformat(),
                },
            )

        assert resp.status_code == 409
        assert resp.json()["detail"].startswith("Another QuickBooks export")


class TestOverHttp:
    async def test_include_exported_is_accepted_in_camel_case(self, db_session, books):
        await _export(db_session, books)
        async with await _client_with(
            db_session, books["org_id"], ["finance.manage"]
        ) as client:
            resp = await client.post(
                "/finance/export/transactions",
                json={
                    "dateRangeStart": RANGE[0].isoformat(),
                    "dateRangeEnd": RANGE[1].isoformat(),
                    "includeExported": True,
                },
            )

        assert resp.status_code == 200, resp.text
        rows = list(csv.reader(io.StringIO(resp.text)))[1:]
        assert _numbers(rows) == ALL

    async def test_a_check_reports_when_it_was_sent(self, db_session, books):
        await _export(db_session, books)
        check = await _check(db_session, books["org_id"])
        async with await _client_with(
            db_session, books["org_id"], ["finance.view", "finance.manage"]
        ) as client:
            resp = await client.get(f"/finance/check-requests/{check.id}")

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["qbExportedAt"] is not None
        assert body["voidedAt"] is None
        assert body["qbVoidExportedAt"] is None


# ============================================
# The migration's backfill
# ============================================

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261011_1054_3f3bd6f3c7e4_quickbooks_export_tracking.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("_qb_tracking", _MIGRATION_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _migration()


class TestBackfill:
    """The upgrade stamps what successful exports already carried."""

    async def _log(self, db, books, *, at: datetime, status="successful"):
        log = ExportLog(
            organization_id=books["org_id"],
            export_type="transactions",
            date_range_start=RANGE[0],
            date_range_end=RANGE[1],
            record_count=4,
            file_format="csv",
            exported_by=books["user_id"],
            exported_at=at,
            completed_at=at,
            status=status,
        )
        db.add(log)
        await db.flush()
        return log

    async def _backfill(self, db: AsyncSession, monkeypatch) -> None:
        def run(sync_session):
            monkeypatch.setattr(
                MIGRATION,
                "op",
                SimpleNamespace(get_bind=lambda: sync_session.connection()),
            )
            MIGRATION._backfill()

        await db.run_sync(run)

    async def test_what_a_successful_export_carried_is_stamped(
        self, db_session, books, monkeypatch
    ):
        log = await self._log(db_session, books, at=datetime(2026, 4, 1, 9, 0))

        await self._backfill(db_session, monkeypatch)

        for model in (PurchaseRequest, ExpenseReport, CheckRequest):
            row = await _fresh(db_session, model, books["org_id"])
            assert row.qb_export_log_id == log.id
        assert await _export(db_session, books) == []

    async def test_a_failed_export_stamps_nothing(self, db_session, books, monkeypatch):
        await self._log(
            db_session, books, at=datetime(2026, 4, 1, 9, 0), status="partial"
        )

        await self._backfill(db_session, monkeypatch)

        assert _numbers(await _export(db_session, books)) == ALL

    async def test_a_payment_made_after_the_export_is_not_stamped(
        self, db_session, books, monkeypatch
    ):
        # Exported on the 5th: the payments on the 10th were not in the file.
        await self._log(db_session, books, at=datetime(2026, 3, 5, 9, 0))

        await self._backfill(db_session, monkeypatch)

        assert _numbers(await _export(db_session, books)) == ALL

    async def test_a_check_voided_after_the_export_is_stamped_for_reversal(
        self, db_session, books, monkeypatch
    ):
        await self._log(db_session, books, at=datetime(2026, 4, 1, 9, 0))
        check = await _check(db_session, books["org_id"])
        check.status = CheckRequestStatus.VOIDED
        await db_session.flush()
        await db_session.execute(
            text("UPDATE check_requests SET updated_at = :at WHERE id = :id"),
            {"at": datetime(2026, 4, 3, 12, 0, tzinfo=timezone.utc), "id": check.id},
        )

        await self._backfill(db_session, monkeypatch)

        check = await _check(db_session, books["org_id"])
        assert check.voided_at == datetime(2026, 4, 3, 12, 0, tzinfo=timezone.utc)
        assert check.qb_exported_at is not None

    async def test_a_check_voided_before_the_export_is_not(
        self, db_session, books, monkeypatch
    ):
        await self._log(db_session, books, at=datetime(2026, 4, 1, 9, 0))
        check = await _check(db_session, books["org_id"])
        check.status = CheckRequestStatus.VOIDED
        await db_session.flush()
        await db_session.execute(
            text("UPDATE check_requests SET updated_at = :at WHERE id = :id"),
            {"at": datetime(2026, 3, 15, 12, 0, tzinfo=timezone.utc), "id": check.id},
        )

        await self._backfill(db_session, monkeypatch)

        check = await _check(db_session, books["org_id"])
        assert check.voided_at == datetime(2026, 3, 15, 12, 0, tzinfo=timezone.utc)
        assert check.qb_exported_at is None

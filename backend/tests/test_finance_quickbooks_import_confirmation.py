"""The Treasurer confirms which export files were imported into QuickBooks.

The export can see that a file was produced, not that QuickBooks took it in.
Once the Treasurer confirms a file was imported, sending its payments again
(``include_exported``) is refused unless the request confirms that too,
because those are exactly the payments a second import would post twice.
"""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import PaginationParams
from app.models.finance import ExportLog
from app.services.finance_service import FinanceService, ReimportConfirmationRequired
from tests.test_finance_quickbooks_export import RANGE, _client_with, make_books
from tests.test_finance_quickbooks_export_tracking import _export, _numbers

pytestmark = [pytest.mark.integration]

ALL = ["CR-2026-0001", "ER-2026-0001", "PR-2026-0001"]


@pytest.fixture
async def books(db_session: AsyncSession):
    return await make_books(db_session)


async def _only_log(db: AsyncSession, org_id: str) -> ExportLog:
    rows = await FinanceService(db).list_export_logs(
        org_id, PaginationParams(skip=0, limit=10)
    )
    assert len(rows) == 1
    log = await db.get(ExportLog, rows[0]["id"])
    assert log is not None
    return log


async def _confirm(db: AsyncSession, books) -> ExportLog:
    log = await _only_log(db, books["org_id"])
    await FinanceService(db).confirm_export_imported(
        books["org_id"], log.id, books["user_id"]
    )
    return log


class TestConfirming:
    async def test_a_complete_export_can_be_confirmed(self, db_session, books):
        await _export(db_session, books)
        log = await _confirm(db_session, books)

        row = await FinanceService(db_session).get_export_log_row(
            books["org_id"], log.id
        )

        assert row["imported_at"] is not None
        assert row["imported_by"] == books["user_id"]
        assert row["imported_by_name"] == "Tess Treasurer"

    async def test_confirming_again_keeps_the_first_confirmation(
        self, db_session, books
    ):
        await _export(db_session, books)
        log = await _confirm(db_session, books)
        first = log.imported_at

        await FinanceService(db_session).confirm_export_imported(
            books["org_id"], log.id, books["user_id"]
        )

        assert log.imported_at == first

    async def test_an_interrupted_export_cannot_be(self, db_session, books):
        await _export(db_session, books)
        log = await _only_log(db_session, books["org_id"])
        log.status = "partial"
        await db_session.flush()

        with pytest.raises(ValueError, match="Only a complete export"):
            await FinanceService(db_session).confirm_export_imported(
                books["org_id"], log.id, books["user_id"]
            )

    async def test_another_departments_export_is_not_found(self, db_session, books):
        await _export(db_session, books)
        log = await _only_log(db_session, books["org_id"])
        other = await make_books(db_session)

        with pytest.raises(ValueError, match="Export not found"):
            await FinanceService(db_session).confirm_export_imported(
                other["org_id"], log.id, other["user_id"]
            )
        assert log.imported_at is None


class TestSendingAgain:
    async def test_resending_a_confirmed_file_is_refused(self, db_session, books):
        await _export(db_session, books)
        await _confirm(db_session, books)

        with pytest.raises(ReimportConfirmationRequired) as refused:
            await _export(db_session, books, include_exported=True)

        assert refused.value.count == 3
        assert "3 payments" in str(refused.value)

    async def test_the_refusal_starts_no_export(self, db_session, books):
        await _export(db_session, books)
        await _confirm(db_session, books)

        with pytest.raises(ReimportConfirmationRequired):
            await _export(db_session, books, include_exported=True)

        rows = await FinanceService(db_session).list_export_logs(
            books["org_id"], PaginationParams(skip=0, limit=10)
        )
        assert len(rows) == 1

    async def test_confirming_the_resend_produces_the_file(self, db_session, books):
        await _export(db_session, books)
        await _confirm(db_session, books)

        rows = await _export(
            db_session, books, include_exported=True, confirm_reimport=True
        )

        assert _numbers(rows) == ALL

    async def test_an_unconfirmed_file_resends_as_before(self, db_session, books):
        await _export(db_session, books)

        rows = await _export(db_session, books, include_exported=True)

        assert _numbers(rows) == ALL

    async def test_withdrawing_the_confirmation_lifts_the_refusal(
        self, db_session, books
    ):
        await _export(db_session, books)
        log = await _confirm(db_session, books)
        await FinanceService(db_session).withdraw_export_imported(
            books["org_id"], log.id
        )

        rows = await _export(db_session, books, include_exported=True)

        assert _numbers(rows) == ALL
        assert log.imported_at is None
        assert log.imported_by is None

    async def test_a_new_export_without_resending_is_never_refused(
        self, db_session, books
    ):
        await _export(db_session, books)
        await _confirm(db_session, books)

        assert await _export(db_session, books) == []


class TestEndpoints:
    async def test_confirm_withdraw_and_the_409(self, db_session, books):
        await _export(db_session, books)
        log = await _only_log(db_session, books["org_id"])
        async with await _client_with(
            db_session, books["org_id"], ["finance.manage"]
        ) as client:
            confirmed = await client.post(f"/finance/export/logs/{log.id}/imported")
            history = await client.get("/finance/export/logs")
            refused = await client.post(
                "/finance/export/transactions",
                json={
                    "dateRangeStart": RANGE[0].isoformat(),
                    "dateRangeEnd": RANGE[1].isoformat(),
                    "includeExported": True,
                },
            )
            withdrawn = await client.delete(f"/finance/export/logs/{log.id}/imported")

        assert confirmed.status_code == 200
        assert confirmed.json()["importedAt"]
        assert confirmed.json()["importedByName"]
        assert history.json()[0]["importedAt"]
        assert refused.status_code == 409
        assert "confirmed as imported" in refused.json()["detail"]
        assert withdrawn.status_code == 200
        assert withdrawn.json()["importedAt"] is None

    async def test_an_unknown_export_is_a_400(self, db_session, books):
        async with await _client_with(
            db_session, books["org_id"], ["finance.manage"]
        ) as client:
            response = await client.post("/finance/export/logs/nope/imported")

        assert response.status_code == 400
        assert response.json()["detail"] == "Export not found"

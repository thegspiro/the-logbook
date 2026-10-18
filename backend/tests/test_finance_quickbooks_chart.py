"""The QuickBooks export checks account names against an uploaded chart.

The journal-entry import matches accounts by name, so a misspelled or renamed
account fails in QuickBooks after the file has left. With the department's
chart of accounts on file, the export refuses such a name first and the
readiness report says which account is missing. Without one, nothing changes.

Separately, an account name starting with =, +, - or @ is refused outright:
the export's formula-injection escaping would put an apostrophe in front of
it, and QuickBooks would then not recognize the account.
"""

from datetime import datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import DuesFrequency, DuesSchedule, ExportMapping
from app.services.finance_service import FinanceService
from app.utils.quickbooks_chart import ChartAccount
from tests.test_finance_quickbooks_export import (
    RANGE,
    _client_with,
    _logs,
    make_books,
)

pytestmark = [pytest.mark.integration]

# Every account make_books posts to.
FULL_CHART = [
    ChartAccount("Operating Checking", "Bank"),
    ChartAccount("Training Expense", "Expenses"),
    ChartAccount("Vehicle Expense:Fuel", "Expenses"),
]


@pytest.fixture
async def books(db_session: AsyncSession):
    return await make_books(db_session)


async def _upload(db: AsyncSession, books, accounts: list[ChartAccount]) -> None:
    await FinanceService(db).replace_chart_of_accounts(
        books["org_id"], books["user_id"], accounts
    )


async def _readiness(db: AsyncSession, books) -> dict:
    return await FinanceService(db).get_export_readiness(books["org_id"])


def _category(readiness: dict, name: str) -> dict:
    return next(r for r in readiness["categories"] if r["category_name"] == name)


async def _run(db: AsyncSession, books) -> str:
    stream = await FinanceService(db).generate_export(
        books["org_id"], books["user_id"], *RANGE
    )
    return "".join([chunk async for chunk in stream])


class TestWithoutAChart:
    async def test_nothing_is_checked(self, db_session, books):
        readiness = await _readiness(db_session, books)

        assert readiness["chart_uploaded"] is False
        assert {r["status"] for r in readiness["categories"]} == {"ready"}
        assert "Vehicle Expense:Fuel" in await _run(db_session, books)


class TestWithAChart:
    async def test_a_chart_holding_every_account_changes_nothing(
        self, db_session, books
    ):
        await _upload(db_session, books, FULL_CHART)

        readiness = await _readiness(db_session, books)

        assert readiness["chart_uploaded"] is True
        assert {r["status"] for r in readiness["categories"]} == {"ready"}
        assert "Vehicle Expense:Fuel" in await _run(db_session, books)

    async def test_an_account_the_chart_lacks_is_reported(self, db_session, books):
        await _upload(db_session, books, FULL_CHART[:2])

        fuel = _category(await _readiness(db_session, books), "Fuel")

        assert fuel["status"] == "not_in_chart"
        assert fuel["accounts_not_in_chart"] == ["Vehicle Expense:Fuel"]

    async def test_an_export_posting_to_it_is_refused_and_logs_nothing(
        self, db_session, books
    ):
        await _upload(db_session, books, FULL_CHART[:2])

        with pytest.raises(ValueError, match="'Vehicle Expense:Fuel', not in the"):
            await _run(db_session, books)
        assert await _logs(db_session, books["org_id"]) == []

    async def test_a_name_differing_only_in_case_does_not_match(
        self, db_session, books
    ):
        await _upload(
            db_session,
            books,
            [*FULL_CHART[:2], ChartAccount("vehicle expense:fuel", "Expenses")],
        )

        fuel = _category(await _readiness(db_session, books), "Fuel")

        assert fuel["status"] == "not_in_chart"

    async def test_a_new_upload_replaces_the_old_chart(self, db_session, books):
        await _upload(db_session, books, FULL_CHART[:2])
        await _upload(db_session, books, FULL_CHART)

        chart = await FinanceService(db_session).get_chart_of_accounts(books["org_id"])

        assert [a["name"] for a in chart["accounts"]] == sorted(
            a.name for a in FULL_CHART
        )
        assert chart["uploaded_by_name"] == "Tess Treasurer"
        assert chart["uploaded_at"] is not None

    async def test_clearing_the_chart_turns_the_check_off(self, db_session, books):
        await _upload(db_session, books, FULL_CHART[:2])
        await FinanceService(db_session).clear_chart_of_accounts(books["org_id"])

        readiness = await _readiness(db_session, books)

        assert readiness["chart_uploaded"] is False
        assert _category(readiness, "Fuel")["status"] == "ready"

    async def test_another_departments_chart_is_not_consulted(self, db_session, books):
        other = await make_books(db_session)
        await _upload(db_session, other, FULL_CHART[:1])

        readiness = await _readiness(db_session, books)

        assert readiness["chart_uploaded"] is False
        assert {r["status"] for r in readiness["categories"]} == {"ready"}

    async def test_advance_accounts_are_checked_too(self, db_session, books):
        service = FinanceService(db_session)
        await service.set_advance_accounts(
            books["org_id"], "Employee Advances", "Operating Checking"
        )
        await _upload(db_session, books, FULL_CHART)

        advances = (await _readiness(db_session, books))["advances"]

        assert advances["status"] == "not_in_chart"
        assert advances["accounts_not_in_chart"] == ["Employee Advances"]

    async def test_dues_accounts_are_checked_too(self, db_session, books):
        service = FinanceService(db_session)
        await service.set_dues_default_accounts(
            books["org_id"], "Dues Income", "Operating Checking"
        )
        db_session.add(
            DuesSchedule(
                organization_id=books["org_id"],
                name="Annual",
                amount=Decimal("50.00"),
                frequency=DuesFrequency.ANNUAL,
                due_date=datetime(2026, 1, 31, tzinfo=timezone.utc),
                created_by=books["user_id"],
            )
        )
        await db_session.flush()
        await _upload(db_session, books, FULL_CHART)

        schedule = (await _readiness(db_session, books))["dues"]["schedules"][0]

        assert schedule["status"] == "not_in_chart"
        assert schedule["accounts_not_in_chart"] == ["Dues Income"]


class TestUnsafeAccountNames:
    async def test_a_mapping_naming_one_is_refused(self, db_session, books):
        with pytest.raises(ValueError, match="can't start with"):
            await FinanceService(db_session).create_export_mapping(
                books["org_id"],
                internal_category="Fuel",
                qb_account_name="-Fuel",
                qb_offset_account_name="Operating Checking",
                mapping_type="expense",
            )

    async def test_a_stored_one_is_reported_and_refused(self, db_session, books):
        mapping = await db_session.get(ExportMapping, books["fuel_map"].id)
        mapping.qb_offset_account_name = "+Petty Cash"
        await db_session.flush()

        fuel = _category(await _readiness(db_session, books), "Fuel")

        assert fuel["status"] == "unsafe_account_name"
        with pytest.raises(ValueError, match="starting with =, \\+, - or @"):
            await _run(db_session, books)


class TestChartEndpoints:
    async def test_upload_read_and_clear(self, db_session, books):
        report = (
            "QB Dept\nAccount List\n\nAccount,Type\n"
            "Operating Checking,Bank\nTraining Expense,Expenses\n"
        )
        async with await _client_with(
            db_session, books["org_id"], ["finance.manage"]
        ) as client:
            uploaded = await client.post(
                "/finance/export/chart-of-accounts",
                files={"file": ("Account List.csv", report.encode(), "text/csv")},
            )
            readiness = await client.get("/finance/export/readiness")
            cleared = await client.delete("/finance/export/chart-of-accounts")
            after = await client.get("/finance/export/chart-of-accounts")

        assert uploaded.status_code == 200
        body = uploaded.json()
        assert [a["name"] for a in body["accounts"]] == [
            "Operating Checking",
            "Training Expense",
        ]
        assert body["accounts"][0]["accountType"] == "Bank"
        assert body["uploadedAt"]
        fuel = next(
            r for r in readiness.json()["categories"] if r["categoryName"] == "Fuel"
        )
        assert fuel["status"] == "not_in_chart"
        assert fuel["accountsNotInChart"] == ["Vehicle Expense:Fuel"]
        assert readiness.json()["chartUploaded"] is True
        assert cleared.status_code == 204
        assert after.json() == {
            "uploadedAt": None,
            "uploadedByName": None,
            "accounts": [],
        }

    async def test_an_unreadable_file_is_a_400_and_keeps_the_old_chart(
        self, db_session, books
    ):
        await _upload(db_session, books, FULL_CHART)
        async with await _client_with(
            db_session, books["org_id"], ["finance.manage"]
        ) as client:
            response = await client.post(
                "/finance/export/chart-of-accounts",
                files={"file": ("chart.csv", b"Vendor\nAcme\n", "text/csv")},
            )

        assert response.status_code == 400
        assert "No account column" in response.json()["detail"]
        chart = await FinanceService(db_session).get_chart_of_accounts(books["org_id"])
        assert len(chart["accounts"]) == len(FULL_CHART)

    async def test_an_oversized_file_is_a_413(self, db_session, books, monkeypatch):
        monkeypatch.setattr("app.api.v1.endpoints.finance.MAX_CHART_FILE_BYTES", 10)
        async with await _client_with(
            db_session, books["org_id"], ["finance.manage"]
        ) as client:
            response = await client.post(
                "/finance/export/chart-of-accounts",
                files={"file": ("chart.csv", b"Account\nOperating Checking\n")},
            )

        assert response.status_code == 413

    async def test_it_needs_finance_manage(self, db_session, books):
        async with await _client_with(
            db_session, books["org_id"], ["finance.view"]
        ) as client:
            response = await client.post(
                "/finance/export/chart-of-accounts",
                files={"file": ("chart.csv", b"Account\nCash\n", "text/csv")},
            )

        assert response.status_code == 403

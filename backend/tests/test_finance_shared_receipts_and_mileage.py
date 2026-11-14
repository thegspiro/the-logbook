"""One receipt on several expense lines, and the mileage trip log.

Owner decisions of 2026-11-01 (docs/KNOWN_LIMITATIONS.md, "Finance — Expense
Receipts: What the Requirement Does Not Cover"):

* **Share a receipt.** A receipt uploaded to one line can be used on other
  lines of the same report (``POST …/items/{id}/receipt/share``) -- never a
  line on another report, nor on another member's. Taking it off one draft
  line (``DELETE …/items/{id}/receipt``) leaves the others. A document that a
  submitted line refers to cannot be deleted, however many lines share it.
* **Built-in mileage log.** A mileage line records its trips; its amount is
  the miles at the department's ``finance.mileage_rate`` and its date is the
  earliest trip, both worked out by the server; the log stands in for the
  receipt. With no rate set, a log is refused with a message saying so.
"""

import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from pydantic import ValidationError
from sqlalchemy import select, update

from app.models.document import Document
from app.models.finance import (
    ExpenseLineItem,
    ExpenseReport,
    ExpenseReportStatus,
    FiscalYearStatus,
)
from app.models.user import Organization
from app.schemas.organization import FinanceSettingsUpdate
from app.services import file_storage_service, upload_scanning
from app.services.documents_service import DocumentsService
from app.services.expense_mileage import mileage_rate_in, price_trip_log
from app.services.finance_service import FinanceService
from app.utils.mileage_rate import parse_mileage_rate
from tests.test_finance_budget_owners import _client, _org, _position, _user, _year

PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"

TRIPS = [
    {
        "tripDate": "2026-10-03",
        "fromLocation": "Station 1",
        "toLocation": "County training center",
        "purpose": "Pump operator class",
        "miles": "30.2",
    },
    {
        "tripDate": "2026-10-01",
        "fromLocation": "Station 1",
        "toLocation": "Supply house",
        "purpose": "Collect hose couplings",
        "miles": "12.5",
    },
]


# ============================================
# The rate and the pricing, no database
# ============================================


@pytest.mark.unit
class TestTheRate:
    def test_a_rate_is_a_bounded_decimal_of_three_places(self):
        assert parse_mileage_rate("0.725") == Decimal("0.725")
        assert parse_mileage_rate(0.7) == Decimal("0.700")
        for bad in ("0.7255", "0", "-1", "5.01", "abc", True, None, "NaN"):
            assert parse_mileage_rate(bad) is None, bad

    def test_an_unreadable_stored_rate_reads_as_unset(self):
        assert mileage_rate_in({"finance": {"mileage_rate": "seventy"}}) is None
        assert mileage_rate_in({"finance": "x"}) is None
        assert mileage_rate_in(None) is None
        assert mileage_rate_in({"finance": {"mileage_rate": "0.655"}}) == Decimal(
            "0.655"
        )

    def test_the_settings_form_stores_a_string_and_refuses_a_bad_rate(self):
        assert FinanceSettingsUpdate(mileage_rate="0.70").mileage_rate == "0.700"
        assert FinanceSettingsUpdate(mileage_rate="").mileage_rate is None
        with pytest.raises(ValidationError, match="mileage rate"):
            FinanceSettingsUpdate(mileage_rate="12")

    def test_the_log_is_priced_to_the_cent_half_up(self):
        trips = [{"miles": "10.5"}, {"miles": "0.5"}]
        assert price_trip_log(trips, Decimal("0.655")) == Decimal("7.21")


# ============================================
# Fixtures
# ============================================


@pytest.fixture
def uploads(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(tmp_path))
    monkeypatch.setattr(upload_scanning, "is_malware_scan_enabled", lambda: False)
    return tmp_path


@pytest.fixture
async def dept(db_session):
    org_id = await _org(db_session, "share")
    member_pos = await _position(db_session, org_id, "Member", ["finance.request"])
    clerk_pos = await _position(db_session, org_id, "Clerk", ["documents.manage"])
    people = {
        "alice": await _user(db_session, org_id, "alice", [member_pos]),
        "bob": await _user(db_session, org_id, "bob", [member_pos]),
        "clerk": await _user(db_session, org_id, "clerk", [clerk_pos]),
    }
    year = _year(org_id, "FY2026", FiscalYearStatus.ACTIVE, people["alice"].id, 2026)
    db_session.add(year)
    await db_session.flush()
    return {"org_id": org_id, "fy_id": year.id, **people}


async def _set_rate(db, org_id, rate) -> None:
    await db.execute(
        update(Organization)
        .where(Organization.id == org_id)
        .values(settings={"finance": {"mileage_rate": rate}})
    )
    await db.flush()


async def _report(db, dept, member="alice", lines=("Hotel", "Parking")):
    return await FinanceService(db).create_expense_report(
        dept["org_id"],
        dept[member].id,
        fiscal_year_id=dept["fy_id"],
        title="Conference",
        line_items=[
            {
                "description": name,
                "amount": Decimal("50.00"),
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


def _items(report_id) -> str:
    return f"/finance/expense-reports/{report_id}/items"


async def _request(db, user, method, path, **kwargs):
    async with _client(db, user) as client:
        return await client.request(method, path, **kwargs)


async def _upload(db, user, report_id, item_id):
    return await _request(
        db,
        user,
        "POST",
        f"{_items(report_id)}/{item_id}/receipt",
        files={"file": ("folio.pdf", PDF, "application/pdf")},
    )


async def _share(db, user, report_id, item_id, from_item_id):
    return await _request(
        db,
        user,
        "POST",
        f"{_items(report_id)}/{item_id}/receipt/share",
        json={"fromItemId": from_item_id},
    )


async def _submit(db, user, report_id):
    return await _request(
        db, user, "POST", f"/finance/expense-reports/{report_id}/submit"
    )


# ============================================
# Sharing a receipt
# ============================================


@pytest.mark.integration
class TestSharingAReceipt:
    async def test_one_upload_covers_both_lines_and_the_report_submits(
        self, db_session, dept, uploads
    ):
        er = await _report(db_session, dept)
        hotel, parking = await _lines(db_session, er.id)
        uploaded = await _upload(db_session, dept["alice"], er.id, hotel.id)
        assert uploaded.status_code == 200, uploaded.text

        resp = await _share(db_session, dept["alice"], er.id, parking.id, hotel.id)

        assert resp.status_code == 200, resp.text
        document_id = uploaded.json()["receiptDocumentId"]
        assert resp.json()["receiptDocumentId"] == document_id
        hotel, parking = await _lines(db_session, er.id)
        assert hotel.receipt_document_id == parking.receipt_document_id == document_id
        submitted = await _submit(db_session, dept["alice"], er.id)
        assert submitted.status_code == 200, submitted.text

    async def test_a_line_on_another_report_is_not_a_source(
        self, db_session, dept, uploads
    ):
        first = await _report(db_session, dept, lines=("Hotel",))
        second = await _report(db_session, dept, lines=("Parking",))
        (hotel,) = await _lines(db_session, first.id)
        (parking,) = await _lines(db_session, second.id)
        await _upload(db_session, dept["alice"], first.id, hotel.id)

        resp = await _share(db_session, dept["alice"], second.id, parking.id, hotel.id)

        assert resp.status_code == 404
        assert resp.json()["detail"] == "Expense line not found"
        (parking,) = await _lines(db_session, second.id)
        assert parking.receipt_document_id is None

    async def test_another_members_report_reads_as_missing(
        self, db_session, dept, uploads
    ):
        er = await _report(db_session, dept)
        hotel, parking = await _lines(db_session, er.id)
        await _upload(db_session, dept["alice"], er.id, hotel.id)

        resp = await _share(db_session, dept["bob"], er.id, parking.id, hotel.id)

        assert resp.status_code == 404
        assert resp.json()["detail"] == "Expense report not found"
        _, parking = await _lines(db_session, er.id)
        assert parking.receipt_document_id is None

    async def test_a_line_with_no_receipt_has_nothing_to_share(
        self, db_session, dept, uploads
    ):
        er = await _report(db_session, dept)
        hotel, parking = await _lines(db_session, er.id)

        resp = await _share(db_session, dept["alice"], er.id, parking.id, hotel.id)

        assert resp.status_code == 400
        assert resp.json()["detail"] == "That line has no receipt to share yet"

    async def test_taking_it_off_one_line_leaves_the_other(
        self, db_session, dept, uploads
    ):
        er = await _report(db_session, dept)
        hotel, parking = await _lines(db_session, er.id)
        uploaded = await _upload(db_session, dept["alice"], er.id, hotel.id)
        document_id = uploaded.json()["receiptDocumentId"]
        await _share(db_session, dept["alice"], er.id, parking.id, hotel.id)

        resp = await _request(
            db_session, dept["alice"], "DELETE", f"{_items(er.id)}/{parking.id}/receipt"
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["receiptDocumentId"] is None
        hotel, parking = await _lines(db_session, er.id)
        assert hotel.receipt_document_id == document_id
        assert parking.receipt_document_id is None
        assert await db_session.get(Document, document_id) is not None

    async def test_a_submitted_line_keeps_its_receipt(self, db_session, dept, uploads):
        er = await _report(db_session, dept)
        hotel, parking = await _lines(db_session, er.id)
        await _upload(db_session, dept["alice"], er.id, hotel.id)
        await _share(db_session, dept["alice"], er.id, parking.id, hotel.id)
        assert (await _submit(db_session, dept["alice"], er.id)).status_code == 200

        resp = await _request(
            db_session, dept["alice"], "DELETE", f"{_items(er.id)}/{parking.id}/receipt"
        )

        assert resp.status_code == 400
        _, parking = await _lines(db_session, er.id)
        assert parking.receipt_document_id is not None


@pytest.mark.integration
class TestDeletingASharedReceipt:
    async def _shared(self, db, dept, status) -> tuple[str, str]:
        document = Document(
            organization_id=dept["org_id"], name="Folio", file_name="folio.pdf"
        )
        db.add(document)
        report = ExpenseReport(
            organization_id=dept["org_id"],
            report_number=f"ER-{uuid.uuid4().hex[:6]}",
            submitted_by=dept["alice"].id,
            fiscal_year_id=dept["fy_id"],
            title="Conference",
            total_amount=Decimal("80.00"),
            status=status,
        )
        db.add(report)
        await db.flush()
        for name in ("Room", "Parking"):
            db.add(
                ExpenseLineItem(
                    expense_report_id=report.id,
                    description=name,
                    amount=Decimal("40.00"),
                    date_incurred=datetime(2026, 3, 1, tzinfo=timezone.utc),
                    receipt_document_id=document.id,
                )
            )
        await db.flush()
        return document.id, report.id

    async def test_it_is_refused_while_a_submitted_line_refers_to_it(
        self, db_session, dept
    ):
        document_id, report_id = await self._shared(
            db_session, dept, ExpenseReportStatus.PENDING_APPROVAL
        )

        with pytest.raises(ValueError, match="past draft"):
            await DocumentsService(db_session).delete_document(
                document_id, dept["org_id"], dept["clerk"]
            )

        lines = await _lines(db_session, report_id)
        assert [line.receipt_document_id for line in lines] == [document_id] * 2

    async def test_a_drafts_shared_receipt_may_still_go(self, db_session, dept):
        document_id, report_id = await self._shared(
            db_session, dept, ExpenseReportStatus.DRAFT
        )

        assert await DocumentsService(db_session).delete_document(
            document_id, dept["org_id"], dept["clerk"]
        )

        lines = await _lines(db_session, report_id)
        assert [line.receipt_document_id for line in lines] == [None, None]


# ============================================
# The mileage trip log
# ============================================


async def _add_mileage(db, dept, report_id, trips=TRIPS, **extra):
    return await _request(
        db,
        dept["alice"],
        "POST",
        _items(report_id),
        json={
            "description": "October mileage",
            "expenseType": "mileage",
            "mileageTrips": trips,
            **extra,
        },
    )


@pytest.mark.integration
class TestTheTripLog:
    async def test_the_line_is_priced_from_the_miles_and_dated_by_its_first_trip(
        self, db_session, dept
    ):
        await _set_rate(db_session, dept["org_id"], "0.700")
        er = await _report(db_session, dept, lines=("Hotel",))

        # A typed amount and date beside a log are the server's to replace.
        resp = await _add_mileage(
            db_session,
            dept,
            er.id,
            amount="999.00",
            dateIncurred="2026-10-20T12:00:00Z",
        )

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert Decimal(body["amount"]) == Decimal("29.89")  # 42.7 miles x 0.70
        assert Decimal(body["totalMiles"]) == Decimal("42.7")
        assert Decimal(body["mileageRate"]) == Decimal("0.700")
        assert body["dateIncurred"].startswith("2026-10-01")
        assert [t["toLocation"] for t in body["mileageTrips"]] == [
            "County training center",
            "Supply house",
        ]
        await db_session.refresh(er)
        assert er.total_amount == Decimal("79.89")

    async def test_the_log_stands_in_for_the_receipt(self, db_session, dept, uploads):
        await _set_rate(db_session, dept["org_id"], "0.700")
        er = await _report(db_session, dept, lines=("Hotel",))
        (hotel,) = await _lines(db_session, er.id)
        await _upload(db_session, dept["alice"], er.id, hotel.id)
        assert (await _add_mileage(db_session, dept, er.id)).status_code == 201

        resp = await _submit(db_session, dept["alice"], er.id)

        assert resp.status_code == 200, resp.text

    async def test_a_mileage_line_without_a_log_still_needs_a_receipt(
        self, db_session, dept
    ):
        er = await FinanceService(db_session).create_expense_report(
            dept["org_id"],
            dept["alice"].id,
            fiscal_year_id=dept["fy_id"],
            title="Mileage",
            line_items=[
                {
                    "description": "Mileage",
                    "amount": Decimal("20.00"),
                    "expense_type": "mileage",
                    "date_incurred": datetime(2026, 10, 1, tzinfo=timezone.utc),
                }
            ],
        )

        resp = await _submit(db_session, dept["alice"], er.id)

        assert resp.status_code == 400
        assert "Attach a receipt to every line" in resp.json()["detail"]

    async def test_with_no_rate_set_the_log_is_refused_and_says_why(
        self, db_session, dept
    ):
        er = await _report(db_session, dept, lines=("Hotel",))

        resp = await _add_mileage(db_session, dept, er.id)

        assert resp.status_code == 400
        assert "has not set a mileage rate" in resp.json()["detail"]
        assert len(await _lines(db_session, er.id)) == 1

    async def test_only_a_mileage_line_takes_a_log(self, db_session, dept):
        await _set_rate(db_session, dept["org_id"], "0.700")
        er = await _report(db_session, dept, lines=("Hotel",))

        resp = await _add_mileage(
            db_session, dept, er.id, expenseType="meals", amount="10.00"
        )

        assert resp.status_code == 422
        assert "Only a mileage line can carry a trip log" in resp.text

    @pytest.mark.parametrize(
        "change",
        [
            {"miles": "0"},
            {"miles": "1000.1"},
            {"miles": "12.55"},
            {"purpose": "   "},
            {"fromLocation": ""},
        ],
    )
    async def test_a_malformed_trip_is_refused(self, db_session, dept, change):
        await _set_rate(db_session, dept["org_id"], "0.700")
        er = await _report(db_session, dept, lines=("Hotel",))

        # With an amount and date, so only the trip can be what is refused.
        resp = await _add_mileage(
            db_session,
            dept,
            er.id,
            trips=[{**TRIPS[0], **change}],
            amount="10.00",
            dateIncurred="2026-10-01T12:00:00Z",
        )

        assert resp.status_code == 422
        assert all(
            error["loc"][:2] == ["body", "mileage_trips"]
            for error in resp.json()["detail"]
        ), resp.text

    async def test_a_trip_after_today_is_refused(self, db_session, dept):
        await _set_rate(db_session, dept["org_id"], "0.700")
        er = await _report(db_session, dept, lines=("Hotel",))

        resp = await _add_mileage(
            db_session, dept, er.id, trips=[{**TRIPS[0], "tripDate": "2099-01-01"}]
        )

        assert resp.status_code == 400
        assert resp.json()["detail"] == "A trip cannot be dated after today"

    async def test_a_line_with_no_log_still_needs_its_amount(self, db_session, dept):
        er = await _report(db_session, dept, lines=("Hotel",))

        resp = await _request(
            db_session,
            dept["alice"],
            "POST",
            _items(er.id),
            json={"description": "Fuel", "dateIncurred": "2026-10-01T12:00:00Z"},
        )

        assert resp.status_code == 400
        assert resp.json()["detail"] == "Enter each line's amount and date"

    async def test_a_report_created_with_a_log_is_priced_too(self, db_session, dept):
        await _set_rate(db_session, dept["org_id"], "0.500")

        resp = await _request(
            db_session,
            dept["alice"],
            "POST",
            "/finance/expense-reports",
            json={
                "fiscalYearId": dept["fy_id"],
                "title": "Mileage",
                "lineItems": [
                    {
                        "description": "October mileage",
                        "expenseType": "mileage",
                        "mileageTrips": TRIPS,
                    }
                ],
            },
        )

        assert resp.status_code == 201, resp.text
        assert Decimal(resp.json()["totalAmount"]) == Decimal("21.35")


@pytest.mark.integration
class TestEditingTheLog:
    async def _line(self, db_session, dept):
        await _set_rate(db_session, dept["org_id"], "0.700")
        er = await _report(db_session, dept, lines=("Hotel",))
        added = await _add_mileage(db_session, dept, er.id)
        return er, added.json()["id"]

    async def _edit(self, db_session, dept, er, item_id, body):
        return await _request(
            db_session, dept["alice"], "PUT", f"{_items(er.id)}/{item_id}", json=body
        )

    async def test_editing_around_the_log_keeps_the_rate_it_was_priced_at(
        self, db_session, dept
    ):
        er, item_id = await self._line(db_session, dept)
        await _set_rate(db_session, dept["org_id"], "0.900")

        resp = await self._edit(
            db_session, dept, er, item_id, {"description": "Mileage", "amount": "1"}
        )

        assert resp.status_code == 200, resp.text
        assert Decimal(resp.json()["amount"]) == Decimal("29.89")
        assert Decimal(resp.json()["mileageRate"]) == Decimal("0.700")

    async def test_a_new_log_is_priced_at_todays_rate(self, db_session, dept):
        er, item_id = await self._line(db_session, dept)
        await _set_rate(db_session, dept["org_id"], "0.900")

        resp = await self._edit(
            db_session, dept, er, item_id, {"mileageTrips": [TRIPS[1]]}
        )

        assert resp.status_code == 200, resp.text
        assert Decimal(resp.json()["amount"]) == Decimal("11.25")  # 12.5 x 0.90
        await db_session.refresh(er)
        assert er.total_amount == Decimal("61.25")

    async def test_removing_the_log_means_the_line_needs_a_receipt_again(
        self, db_session, dept, uploads
    ):
        er, item_id = await self._line(db_session, dept)

        resp = await self._edit(db_session, dept, er, item_id, {"mileageTrips": None})

        assert resp.status_code == 200, resp.text
        assert resp.json()["mileageTrips"] is None
        assert resp.json()["mileageRate"] is None
        hotel = next(
            line for line in await _lines(db_session, er.id) if line.id != item_id
        )
        await _upload(db_session, dept["alice"], er.id, hotel.id)
        submitted = await _submit(db_session, dept["alice"], er.id)
        assert submitted.status_code == 400
        assert "October mileage" in submitted.json()["detail"]

    async def test_a_logged_line_cannot_become_another_type(self, db_session, dept):
        er, item_id = await self._line(db_session, dept)

        resp = await self._edit(db_session, dept, er, item_id, {"expenseType": "meals"})

        assert resp.status_code == 400
        assert resp.json()["detail"] == "Only a mileage line can carry a trip log"

"""Live posting to QuickBooks Online, against a fake Intuit.

``FakeIntuit`` answers the calls the way Intuit's documentation describes:
the token endpoint's JSON, ``{"QueryResponse": {...}}`` for the chart of
accounts and the vendor list, and a create answered as ``{"<Entity>": {...}}``.
It also does what makes ``requestid`` worth sending: a create repeated with a
request id it has seen is answered with the original record, not a second one
("If our service receives another request with the same request ID ... it can
recognize and send the same response for the original request").

The department is the export tests' ``make_books``: a paid purchase request
(Training, to Red Cross), an issued check (Fuel, to County Fuel Depot) and a
paid expense report (one Training line and one Fuel line), all paid from
Operating Checking.
"""

import json
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
import jwt
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import quickbooks_online as qbo_endpoints
from app.core.config import settings
from app.core.database import get_db
from app.models.finance import (
    CheckRequest,
    QuickBooksConnection,
    QuickBooksPosting,
)
from app.models.user import User
from app.services import quickbooks_sync_service as sync
from tests.test_finance_quickbooks_export import (
    PAID,
    _org,
    _user,
    make_books,
)
from tests.test_finance_quickbooks_export_tracking import _rows

pytestmark = [pytest.mark.integration]

REALM = "9130350"
TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke"

ACCOUNTS = [
    {"Id": "35", "Name": "Operating Checking", "AccountType": "Bank", "Active": True},
    {
        "Id": "60",
        "Name": "Training Expense",
        "AccountType": "Expense",
        "Active": True,
    },
    {
        "Id": "61",
        "Name": "Fuel",
        "FullyQualifiedName": "Vehicle Expense:Fuel",
        "SubAccount": True,
        "AccountType": "Expense",
        "Active": True,
    },
    {"Id": "40", "Name": "Visa", "AccountType": "Credit Card", "Active": True},
]


class FakeIntuit:
    """Intuit's OAuth and Accounting endpoints, in memory."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.purchases: dict[str, dict[str, Any]] = {}
        self.vendors: list[dict[str, Any]] = [
            {"Id": "56", "DisplayName": "Red Cross", "Active": True}
        ]
        self.by_request_id: dict[str, dict[str, Any]] = {}
        self.refresh_count = 0
        self.refresh_status = 200
        # Queued answers for the next purchase creates: "drop_after_create"
        # records the purchase and then loses the response.
        self.purchase_faults: list[str] = []
        self.next_id = 1000

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        url = str(request.url).split("?")[0]
        if url == TOKEN_URL:
            form = parse_qs(request.content.decode())
            if form["grant_type"] == ["refresh_token"]:
                self.refresh_count += 1
                if self.refresh_status != 200:
                    return httpx.Response(
                        self.refresh_status, json={"error": "invalid_grant"}
                    )
            return httpx.Response(
                200,
                json={
                    "token_type": "bearer",
                    "expires_in": 3600,
                    "refresh_token": f"refresh-{self.refresh_count}",
                    "x_refresh_token_expires_in": 8640000,
                    "access_token": f"access-{self.refresh_count}",
                },
            )
        if url == REVOKE_URL:
            return httpx.Response(200)
        path = request.url.path
        assert path.startswith(f"/v3/company/{REALM}/"), path
        assert request.url.params["minorversion"] == "75"
        if path.endswith("/query"):
            statement = request.url.params["query"]
            entity = statement.split(" FROM ")[1].split(" ")[0]
            rows = ACCOUNTS if entity == "Account" else self.vendors
            return httpx.Response(
                200, json={"QueryResponse": {entity: rows, "startPosition": 1}}
            )
        request_id = request.url.params["requestid"]
        if request_id in self.by_request_id:
            return httpx.Response(200, json=self.by_request_id[request_id])
        body = json.loads(request.content)
        if path.endswith("/vendor"):
            vendor = {"Id": self._id(), "DisplayName": body["DisplayName"]}
            self.vendors.append(vendor)
            response = {"Vendor": vendor, "time": "t"}
            self.by_request_id[request_id] = response
            return httpx.Response(200, json=response)
        assert path.endswith("/purchase"), path
        fault = self.purchase_faults.pop(0) if self.purchase_faults else None
        if fault == "unauthorized":
            return httpx.Response(401, json={"fault": {"error": [{"code": "3200"}]}})
        if fault == "throttled":
            return httpx.Response(429, json={})
        if fault == "outage":
            return httpx.Response(503, json={})
        if fault == "invalid":
            return httpx.Response(
                400,
                json={
                    "Fault": {
                        "Error": [
                            {
                                "Message": "Object Not Found",
                                "Detail": "Something you're trying to use has "
                                "been made inactive.",
                                "code": "610",
                            }
                        ],
                        "type": "ValidationFault",
                    }
                },
            )
        purchase = {"Id": self._id(), "SyncToken": "0", **body}
        self.purchases[purchase["Id"]] = purchase
        response = {"Purchase": purchase, "time": "t"}
        self.by_request_id[request_id] = response
        if fault == "drop_after_create":
            raise httpx.ReadTimeout("response lost", request=request)
        return httpx.Response(200, json=response)

    def _id(self) -> str:
        self.next_id += 1
        return str(self.next_id)

    def calls(self, suffix: str) -> list[httpx.Request]:
        return [
            r
            for r in self.requests
            if r.method == "POST" and r.url.path.endswith(suffix)
        ]

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(self.handler))


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setattr(settings, "QBO_CLIENT_ID", "client-abc")
    monkeypatch.setattr(settings, "QBO_CLIENT_SECRET", "secret-xyz")
    monkeypatch.setattr(
        settings,
        "QBO_REDIRECT_URI",
        "https://app.example.org/api/v1/finance/quickbooks/oauth/callback",
    )
    monkeypatch.setattr(settings, "QBO_ENVIRONMENT", "sandbox")
    return settings.QBO_ENVIRONMENT


@pytest.fixture
def intuit() -> FakeIntuit:
    return FakeIntuit()


@pytest.fixture
async def books(db_session: AsyncSession):
    return await make_books(db_session)


async def _connect(
    db: AsyncSession,
    org_id: str,
    *,
    post_from: datetime = PAID - timedelta(days=1),
    expires_in: timedelta = timedelta(hours=1),
) -> None:
    db.add(
        QuickBooksConnection(
            organization_id=org_id,
            status=sync.CONNECTED,
            environment="sandbox",
            realm_id=REALM,
            access_token="access-0",
            refresh_token="refresh-0",
            access_token_expires_at=datetime.now(timezone.utc) + expires_in,
            post_from=post_from,
        )
    )
    await db.flush()


async def _run(db: AsyncSession, org_id: str, intuit: FakeIntuit) -> dict:
    async with intuit.client() as http:
        return await sync.run_for_organization(db, org_id, http=http)


async def _postings(db: AsyncSession, org_id: str) -> dict[str, QuickBooksPosting]:
    result = await db.execute(
        select(QuickBooksPosting)
        .where(QuickBooksPosting.organization_id == org_id)
        .execution_options(populate_existing=True)
    )
    return {p.document_number: p for p in result.scalars()}


async def _connection(db: AsyncSession, org_id: str) -> QuickBooksConnection:
    result = await db.execute(
        select(QuickBooksConnection)
        .where(QuickBooksConnection.organization_id == org_id)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def _make_due(db: AsyncSession, org_id: str) -> None:
    await db.execute(
        text(
            "UPDATE quickbooks_postings SET next_attempt_at = NULL "
            "WHERE organization_id = :org"
        ),
        {"org": org_id},
    )
    await db.commit()


async def _check(db: AsyncSession, org_id: str) -> CheckRequest:
    result = await db.execute(
        select(CheckRequest).where(CheckRequest.organization_id == org_id)
    )
    return result.scalar_one()


def _bodies(intuit: FakeIntuit) -> dict[str, dict[str, Any]]:
    """Purchases by the payment's own number: a check's DocNumber is its
    check number, so its request number is in PrivateNote."""
    return {
        (p["PrivateNote"] if p["PaymentType"] == "Check" else p["DocNumber"]): p
        for p in intuit.purchases.values()
    }


@pytest.mark.usefixtures("connected")
class TestPosting:
    async def test_each_payment_posts_as_a_purchase_to_its_vendor(
        self, db_session, books, configured, intuit
    ):
        counts = await _run(db_session, books["org_id"], intuit)

        assert counts["posted"] == 3
        bodies = _bodies(intuit)
        assert set(bodies) == {"PR-2026-0001", "CR-2026-0001", "ER-2026-0001"}
        purchase = bodies["PR-2026-0001"]
        assert {k: purchase[k] for k in purchase if k not in ("Id", "SyncToken")} == {
            "PaymentType": "Cash",
            "AccountRef": {"value": "35"},
            "TxnDate": "2026-03-10",
            "DocNumber": "PR-2026-0001",
            "EntityRef": {"value": "56", "type": "Vendor"},
            "Line": [
                {
                    "Amount": 240.5,
                    "DetailType": "AccountBasedExpenseLineDetail",
                    "AccountBasedExpenseLineDetail": {"AccountRef": {"value": "60"}},
                }
            ],
        }
        # The report's two lines keep their own accounts; the subaccount is
        # found by its Parent:Child name.
        report_lines = bodies["ER-2026-0001"]["Line"]
        assert sorted(
            (
                line["Amount"],
                line["AccountBasedExpenseLineDetail"]["AccountRef"]["value"],
            )
            for line in report_lines
        ) == [(15.0, "61"), (20.0, "60")]
        postings = await _postings(db_session, books["org_id"])
        for number, posting in postings.items():
            assert posting.status == "posted"
            assert posting.qb_purchase_id == bodies[number]["Id"]
            assert posting.realm_id == REALM
            assert posting.posted_at is not None

    async def test_a_vendor_quickbooks_lacks_is_created_once(
        self, db_session, books, configured, intuit
    ):
        await _run(db_session, books["org_id"], intuit)

        created = [json.loads(r.content) for r in intuit.calls("/vendor")]
        # Red Cross existed; the check's payee and the member did not.
        assert {"DisplayName": "County Fuel Depot"} in created
        assert {"DisplayName": "Tess Treasurer"} in created
        assert len(created) == 2
        check = _bodies(intuit)["CR-2026-0001"]
        fuel_depot = next(
            v for v in intuit.vendors if v["DisplayName"] == "County Fuel Depot"
        )
        assert check["EntityRef"] == {"value": fuel_depot["Id"], "type": "Vendor"}

    async def test_every_create_carries_the_postings_request_id(
        self, db_session, books, configured, intuit
    ):
        await _run(db_session, books["org_id"], intuit)

        postings = await _postings(db_session, books["org_id"])
        sent = sorted(r.url.params["requestid"] for r in intuit.calls("/purchase"))
        assert sent == sorted(p.request_id for p in postings.values())
        for vendor_call in intuit.calls("/vendor"):
            assert vendor_call.url.params["requestid"].endswith("-v")

    async def test_running_again_posts_nothing_twice(
        self, db_session, books, configured, intuit
    ):
        await _run(db_session, books["org_id"], intuit)
        await _make_due(db_session, books["org_id"])
        again = await _run(db_session, books["org_id"], intuit)

        assert again["queued"] == 0
        assert again["posted"] == 0
        assert len(intuit.calls("/purchase")) == 3
        assert len(intuit.purchases) == 3

    async def test_a_lost_response_is_resent_and_gets_the_same_purchase(
        self, db_session, books, configured, intuit
    ):
        intuit.purchase_faults = ["drop_after_create"]
        await _run(db_session, books["org_id"], intuit)

        postings = await _postings(db_session, books["org_id"])
        retrying = [p for p in postings.values() if p.status == "retrying"]
        assert len(retrying) == 1
        (waiting,) = retrying
        request_id = waiting.request_id
        assert waiting.next_attempt_at is not None
        # QuickBooks recorded it although the answer never arrived.
        assert len(intuit.purchases) == 3

        await _make_due(db_session, books["org_id"])
        await _run(db_session, books["org_id"], intuit)

        posting = (await _postings(db_session, books["org_id"]))[
            waiting.document_number
        ]
        assert posting.status == "posted"
        assert posting.request_id == request_id
        assert len(intuit.purchases) == 3
        assert posting.qb_purchase_id in intuit.purchases

    async def test_an_outage_waits_and_keeps_the_request_id(
        self, db_session, books, configured, intuit
    ):
        intuit.purchase_faults = ["outage"]
        await _run(db_session, books["org_id"], intuit)

        (waiting,) = [
            p
            for p in (await _postings(db_session, books["org_id"])).values()
            if p.status == "retrying"
        ]
        assert waiting.attempts == 1
        assert "HTTP 503" in (waiting.last_error or "")
        due = waiting.next_attempt_at
        assert due is not None
        if due.tzinfo is None:
            due = due.replace(tzinfo=timezone.utc)
        assert due - datetime.now(timezone.utc) > timedelta(minutes=4)

    async def test_throttling_stops_the_run_for_a_minute(
        self, db_session, books, configured, intuit
    ):
        intuit.purchase_faults = ["throttled"]
        counts = await _run(db_session, books["org_id"], intuit)

        assert counts["posted"] == 0
        assert len(intuit.calls("/purchase")) == 1
        statuses = sorted(
            p.status for p in (await _postings(db_session, books["org_id"])).values()
        )
        assert statuses == ["queued", "queued", "retrying"]

    async def test_a_refusal_is_failed_with_quickbooks_message_and_a_new_id(
        self, db_session, books, configured, intuit
    ):
        intuit.purchase_faults = ["invalid"]
        await _run(db_session, books["org_id"], intuit)

        (failed,) = [
            p
            for p in (await _postings(db_session, books["org_id"])).values()
            if p.status == "failed"
        ]
        sent_ids = [r.url.params["requestid"] for r in intuit.calls("/purchase")]
        assert failed.request_id not in sent_ids
        assert failed.last_error == (
            "Object Not Found - Something you're trying to use has been made "
            "inactive."
        )

        await sync.retry_posting(db_session, books["org_id"], failed.id)
        await _run(db_session, books["org_id"], intuit)
        posting = (await _postings(db_session, books["org_id"]))[failed.document_number]
        assert posting.status == "posted"

    async def test_an_expired_access_token_is_refreshed_and_the_new_refresh_token_kept(
        self, db_session, books, configured, intuit
    ):
        intuit.purchase_faults = ["unauthorized"]
        counts = await _run(db_session, books["org_id"], intuit)

        assert counts["posted"] == 3
        assert intuit.refresh_count == 1
        connection = await _connection(db_session, books["org_id"])
        assert connection.refresh_token == "refresh-1"
        assert connection.access_token == "access-1"

    async def test_a_token_about_to_expire_is_refreshed_first(
        self, db_session, books, configured, intuit
    ):
        connection = await _connection(db_session, books["org_id"])
        connection.access_token_expires_at = datetime.now(timezone.utc) + timedelta(
            minutes=1
        )
        await db_session.commit()
        await _run(db_session, books["org_id"], intuit)

        assert intuit.refresh_count == 1
        first_api_call = next(r for r in intuit.requests if "/v3/" in r.url.path)
        assert first_api_call.headers["Authorization"] == "Bearer access-1"

    async def test_a_refused_refresh_token_asks_for_reconnecting(
        self, db_session, books, configured, intuit
    ):
        intuit.purchase_faults = ["unauthorized"]
        intuit.refresh_status = 400
        await _run(db_session, books["org_id"], intuit)

        connection = await _connection(db_session, books["org_id"])
        assert connection.status == sync.RECONNECT_REQUIRED
        assert "connect" in (connection.last_error or "").lower()
        statuses = {
            p.status for p in (await _postings(db_session, books["org_id"])).values()
        }
        assert statuses == {"queued"}

    async def test_an_issued_check_posts_as_a_check_with_its_number(
        self, db_session, books, configured, intuit
    ):
        await _run(db_session, books["org_id"], intuit)

        check = _bodies(intuit)["CR-2026-0001"]
        assert check["PaymentType"] == "Check"
        assert check["DocNumber"] == "1042"
        assert check["PrivateNote"] == "CR-2026-0001"
        assert check["PrintStatus"] == "NotSet"
        assert check["AccountRef"] == {"value": "35"}
        assert "Credit" not in check
        # The others record no check, so they stay cash expenses.
        assert _bodies(intuit)["PR-2026-0001"]["PaymentType"] == "Cash"
        assert _bodies(intuit)["ER-2026-0001"]["PaymentType"] == "Cash"

    async def test_a_check_with_a_blank_number_posts_with_none(
        self, db_session, books, configured, intuit
    ):
        (await _check(db_session, books["org_id"])).check_number = "  "
        await db_session.flush()
        await _run(db_session, books["org_id"], intuit)

        check = _bodies(intuit)["CR-2026-0001"]
        assert check["PaymentType"] == "Check"
        assert "DocNumber" not in check

    async def test_a_check_number_longer_than_quickbooks_allows_is_refused(
        self, db_session, books, configured, intuit
    ):
        (await _check(db_session, books["org_id"])).check_number = "9" * 22
        await db_session.flush()
        await _run(db_session, books["org_id"], intuit)

        posting = (await _postings(db_session, books["org_id"]))["CR-2026-0001"]
        assert posting.status == "failed"
        assert "21 characters" in (posting.last_error or "")
        assert "CR-2026-0001" not in _bodies(intuit)

    async def test_a_card_paid_category_posts_as_a_credit_card_expense(
        self, db_session, books, configured, intuit
    ):
        for mapping in (books["training_map"], books["fuel_map"]):
            mapping.qb_offset_account_name = "Visa"
        await db_session.flush()
        await _run(db_session, books["org_id"], intuit)

        bodies = _bodies(intuit)
        for number in ("PR-2026-0001", "ER-2026-0001"):
            assert bodies[number]["PaymentType"] == "CreditCard"
            assert bodies[number]["AccountRef"] == {"value": "40"}
            assert bodies[number]["Credit"] is False
            assert bodies[number]["DocNumber"] == number
        postings = await _postings(db_session, books["org_id"])
        assert postings["PR-2026-0001"].status == "posted"
        assert postings["ER-2026-0001"].status == "posted"
        # A check cannot be drawn on a card account.
        assert postings["CR-2026-0001"].status == "failed"
        assert "a check is paid from a bank account" in (
            postings["CR-2026-0001"].last_error or ""
        )
        assert "CR-2026-0001" not in bodies

    async def test_card_payments_posted_live_stay_out_of_the_csv_file(
        self, db_session, books, configured, intuit
    ):
        for mapping in (books["training_map"], books["fuel_map"]):
            mapping.qb_offset_account_name = "Visa"
        await db_session.flush()
        await _run(db_session, books["org_id"], intuit)

        rows = await _rows(db_session, books["org_id"], books["user_id"])
        # Only the refused check is left for the file.
        assert {row[0] for row in rows} == {"CR-2026-0001"}

    async def test_a_paid_from_account_neither_bank_nor_card_is_refused(
        self, db_session, books, configured, intuit
    ):
        for mapping in (books["training_map"], books["fuel_map"]):
            mapping.qb_offset_account_name = "Training Expense"
        await db_session.flush()
        await _run(db_session, books["org_id"], intuit)

        postings = (await _postings(db_session, books["org_id"])).values()
        assert {p.status for p in postings} == {"failed"}
        assert all(
            "not a Bank or Credit Card account" in (p.last_error or "")
            or "a check is paid from a bank account" in (p.last_error or "")
            for p in postings
        )
        assert intuit.calls("/purchase") == []

    async def test_a_purchase_request_with_no_vendor_is_refused_before_sending(
        self, db_session, books, configured, intuit
    ):
        books["purchase"].vendor = None
        await db_session.flush()
        await _run(db_session, books["org_id"], intuit)

        posting = (await _postings(db_session, books["org_id"]))["PR-2026-0001"]
        assert posting.status == "failed"
        assert "has no vendor" in (posting.last_error or "")


@pytest.fixture
async def connected(db_session, books):
    await _connect(db_session, books["org_id"])
    return books


class TestWhatIsPosted:
    async def test_payments_before_post_from_are_left_to_the_csv_export(
        self, db_session, books, configured, intuit
    ):
        await _connect(db_session, books["org_id"], post_from=PAID + timedelta(days=1))
        counts = await _run(db_session, books["org_id"], intuit)

        assert counts["queued"] == 0
        assert intuit.purchases == {}
        assert len(await _rows(db_session, books["org_id"], books["user_id"])) == 8

    async def test_a_payment_already_in_a_csv_file_is_not_posted(
        self, db_session, books, configured, intuit
    ):
        await _rows(db_session, books["org_id"], books["user_id"])
        await _connect(db_session, books["org_id"])
        counts = await _run(db_session, books["org_id"], intuit)

        assert counts["queued"] == 0
        assert intuit.purchases == {}

    async def test_posted_payments_never_go_in_the_csv_file(
        self, db_session, books, configured, intuit
    ):
        await _connect(db_session, books["org_id"])
        await _run(db_session, books["org_id"], intuit)

        assert await _rows(db_session, books["org_id"], books["user_id"]) == []
        again = await _rows(
            db_session, books["org_id"], books["user_id"], include_exported=True
        )
        assert again == []

    async def test_a_refused_posting_can_go_in_the_csv_file_instead(
        self, db_session, books, configured, intuit
    ):
        await _connect(db_session, books["org_id"])
        books["purchase"].vendor = None
        await db_session.flush()
        await _run(db_session, books["org_id"], intuit)

        rows = await _rows(db_session, books["org_id"], books["user_id"])
        assert {row[0] for row in rows} == {"PR-2026-0001"}
        # The file carried it, so a later run does not send it too.
        await _make_due(db_session, books["org_id"])
        await _run(db_session, books["org_id"], intuit)
        posting = (await _postings(db_session, books["org_id"]))["PR-2026-0001"]
        assert posting.status == "superseded"
        with pytest.raises(ValueError, match="Only a posting QuickBooks refused"):
            await sync.retry_posting(db_session, books["org_id"], posting.id)

    async def test_a_check_voided_before_it_was_sent_is_not_sent(
        self, db_session, books, configured, intuit
    ):
        await _connect(db_session, books["org_id"])
        await sync.enqueue(db_session, books["org_id"], PAID - timedelta(days=1))
        check = (
            await db_session.execute(
                select(CheckRequest).where(
                    CheckRequest.organization_id == books["org_id"]
                )
            )
        ).scalar_one()
        check.status = "voided"
        await db_session.commit()
        await _run(db_session, books["org_id"], intuit)

        posting = (await _postings(db_session, books["org_id"]))["CR-2026-0001"]
        assert posting.status == "superseded"
        assert "CR-2026-0001" not in _bodies(intuit)

    async def test_an_unconfigured_server_posts_nothing(
        self, db_session, books, intuit, monkeypatch
    ):
        monkeypatch.setattr(settings, "QBO_CLIENT_ID", None)
        await _connect(db_session, books["org_id"])
        counts = await _run(db_session, books["org_id"], intuit)

        assert counts == {"skipped": "not_configured"}
        assert intuit.requests == []
        status = await sync.connection_status(db_session, books["org_id"])
        assert status["configured"] is False

    async def test_a_disconnected_department_posts_nothing(
        self, db_session, books, configured, intuit
    ):
        counts = await _run(db_session, books["org_id"], intuit)
        assert counts == {"skipped": "not_connected"}
        assert intuit.requests == []

    async def test_a_changed_environment_asks_for_reconnecting(
        self, db_session, books, configured, intuit, monkeypatch
    ):
        await _connect(db_session, books["org_id"])
        monkeypatch.setattr(settings, "QBO_ENVIRONMENT", "production")
        counts = await _run(db_session, books["org_id"], intuit)

        assert counts == {"skipped": "environment_changed"}
        assert intuit.requests == []
        connection = await _connection(db_session, books["org_id"])
        assert connection.status == sync.RECONNECT_REQUIRED

    async def test_a_second_run_while_one_holds_the_lease_does_nothing(
        self, db_session, books, configured, intuit
    ):
        await _connect(db_session, books["org_id"])
        connection = await _connection(db_session, books["org_id"])
        connection.sync_lease_until = datetime.now(timezone.utc) + timedelta(minutes=5)
        await db_session.commit()

        counts = await _run(db_session, books["org_id"], intuit)
        assert counts == {"skipped": "busy"}
        assert intuit.requests == []


class TestOrganizationScoping:
    async def test_a_run_touches_only_its_own_department(
        self, db_session, configured, intuit
    ):
        mine = await make_books(db_session)
        theirs = await make_books(db_session)
        await _connect(db_session, mine["org_id"])
        await _connect(db_session, theirs["org_id"])
        await _run(db_session, mine["org_id"], intuit)

        assert len(await _postings(db_session, mine["org_id"])) == 3
        assert await _postings(db_session, theirs["org_id"]) == {}
        # Their unsent payments still go in their own CSV file.
        assert len(await _rows(db_session, theirs["org_id"], theirs["user_id"])) == 8

    async def test_another_departments_posting_cannot_be_listed_or_retried(
        self, db_session, configured, intuit
    ):
        mine = await make_books(db_session)
        theirs = await make_books(db_session)
        await _connect(db_session, theirs["org_id"])
        theirs["purchase"].vendor = None
        await db_session.flush()
        await _run(db_session, theirs["org_id"], intuit)
        failed = (await _postings(db_session, theirs["org_id"]))["PR-2026-0001"]

        assert await sync.list_postings(db_session, mine["org_id"]) == []
        with pytest.raises(LookupError):
            await sync.retry_posting(db_session, mine["org_id"], failed.id)


async def _treasurer(db: AsyncSession, org_id: str, permissions=("finance.manage",)):
    user_id = await _user(db, org_id)
    position_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, permissions) "
            "VALUES (:id, :org, :name, :slug, :perms)"
        ),
        {
            "id": position_id,
            "org": org_id,
            "name": f"Treasurer {position_id[:6]}",
            "slug": f"treasurer-{position_id[:8]}",
            "perms": json.dumps(list(permissions)),
        },
    )
    await db.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": user_id, "p": position_id},
    )
    await db.flush()
    return user_id


def _state_of(url: str) -> str:
    return parse_qs(urlsplit(url).query)["state"][0]


class TestConnect:
    async def _begin(self, db, org_id, user_id) -> tuple[str, str]:
        url, nonce = await sync.begin_connect(db, org_id, user_id)
        return _state_of(url), nonce

    async def _complete(self, db, intuit, **kwargs):
        defaults = {"code": "code-1", "realm_id": REALM, "error": None}
        defaults.update(kwargs)
        async with intuit.client() as http:
            return await sync.complete_connect(db, http, **defaults)

    async def test_a_completed_connect_stores_the_company_and_encrypted_tokens(
        self, db_session, configured, intuit
    ):
        org_id = await _org(db_session)
        user_id = await _treasurer(db_session, org_id)
        state, nonce = await self._begin(db_session, org_id, user_id)

        await self._complete(db_session, intuit, state=state, nonce_cookie=nonce)

        connection = await _connection(db_session, org_id)
        assert connection.status == sync.CONNECTED
        assert connection.realm_id == REALM
        assert connection.environment == "sandbox"
        assert connection.refresh_token == "refresh-0"
        assert connection.connected_by == user_id
        assert connection.post_from is not None
        raw = (
            await db_session.execute(
                text(
                    "SELECT access_token, refresh_token FROM quickbooks_connections "
                    "WHERE organization_id = :o"
                ),
                {"o": org_id},
            )
        ).one()
        assert raw.access_token != "access-0"
        assert raw.refresh_token != "refresh-0"
        assert "refresh-0" not in raw.refresh_token

    async def test_the_state_works_once(self, db_session, configured, intuit):
        org_id = await _org(db_session)
        user_id = await _treasurer(db_session, org_id)
        state, nonce = await self._begin(db_session, org_id, user_id)
        await self._complete(db_session, intuit, state=state, nonce_cookie=nonce)

        with pytest.raises(sync.QuickBooksConnectError, match="invalid_state"):
            await self._complete(db_session, intuit, state=state, nonce_cookie=nonce)
        exchanges = [r for r in intuit.requests if str(r.url) == TOKEN_URL]
        assert len(exchanges) == 1

    async def test_a_state_without_its_cookie_is_refused(
        self, db_session, configured, intuit
    ):
        org_id = await _org(db_session)
        user_id = await _treasurer(db_session, org_id)
        state, _ = await self._begin(db_session, org_id, user_id)

        with pytest.raises(sync.QuickBooksConnectError, match="invalid_state"):
            await self._complete(
                db_session, intuit, state=state, nonce_cookie="another-browser"
            )
        assert intuit.requests == []

    async def test_a_forged_state_is_refused(self, db_session, configured, intuit):
        org_id = await _org(db_session)
        user_id = await _treasurer(db_session, org_id)
        _, nonce = await self._begin(db_session, org_id, user_id)
        forged = jwt.encode(
            {
                "purpose": sync.STATE_PURPOSE,
                "org": org_id,
                "usr": user_id,
                "nonce": nonce,
                "exp": int(time.time()) + 60,
            },
            "not-the-server-key-but-long-enough-for-hs256",
            algorithm="HS256",
        )
        with pytest.raises(sync.QuickBooksConnectError, match="invalid_state"):
            await self._complete(db_session, intuit, state=forged, nonce_cookie=nonce)

    async def test_another_providers_state_is_refused(
        self, db_session, configured, intuit
    ):
        org_id = await _org(db_session)
        user_id = await _treasurer(db_session, org_id)
        _, nonce = await self._begin(db_session, org_id, user_id)
        other = jwt.encode(
            {
                "purpose": "google_calendar_connect",
                "org": org_id,
                "usr": user_id,
                "nonce": nonce,
                "exp": int(time.time()) + 60,
            },
            settings.SECRET_KEY,
            algorithm=settings.ALGORITHM,
        )
        with pytest.raises(sync.QuickBooksConnectError, match="invalid_state"):
            await self._complete(db_session, intuit, state=other, nonce_cookie=nonce)

    async def test_an_expired_attempt_is_refused(
        self, db_session, configured, intuit, monkeypatch
    ):
        org_id = await _org(db_session)
        user_id = await _treasurer(db_session, org_id)
        state, nonce = await self._begin(db_session, org_id, user_id)
        connection = await _connection(db_session, org_id)
        pending = json.loads(connection.pending_attempt or "{}")
        pending["exp"] = int(time.time()) - 1
        connection.pending_attempt = json.dumps(pending)
        await db_session.commit()

        with pytest.raises(sync.QuickBooksConnectError, match="expired_state"):
            await self._complete(db_session, intuit, state=state, nonce_cookie=nonce)

    async def test_someone_who_lost_finance_manage_cannot_finish(
        self, db_session, configured, intuit
    ):
        org_id = await _org(db_session)
        user_id = await _treasurer(db_session, org_id, permissions=("finance.view",))
        state, nonce = await self._begin(db_session, org_id, user_id)

        with pytest.raises(sync.QuickBooksConnectError, match="not_authorized"):
            await self._complete(db_session, intuit, state=state, nonce_cookie=nonce)
        assert intuit.requests == []

    async def test_declining_on_intuits_page_connects_nothing(
        self, db_session, configured, intuit
    ):
        org_id = await _org(db_session)
        user_id = await _treasurer(db_session, org_id)
        state, nonce = await self._begin(db_session, org_id, user_id)

        with pytest.raises(sync.QuickBooksConnectError, match="access_denied"):
            await self._complete(
                db_session,
                intuit,
                state=state,
                nonce_cookie=nonce,
                code=None,
                error="access_denied",
            )
        assert (await _connection(db_session, org_id)).status == sync.DISCONNECTED

    async def test_no_company_means_no_connection(self, db_session, configured, intuit):
        org_id = await _org(db_session)
        user_id = await _treasurer(db_session, org_id)
        state, nonce = await self._begin(db_session, org_id, user_id)

        with pytest.raises(sync.QuickBooksConnectError, match="missing_company"):
            await self._complete(
                db_session, intuit, state=state, nonce_cookie=nonce, realm_id=None
            )
        assert intuit.requests == []


class TestDisconnect:
    async def test_disconnect_revokes_and_returns_unsent_payments_to_the_file(
        self, db_session, books, configured, intuit
    ):
        await _connect(db_session, books["org_id"])
        await sync.enqueue(db_session, books["org_id"], PAID - timedelta(days=1))
        async with intuit.client() as http:
            revoked = await sync.disconnect(db_session, http, books["org_id"])

        assert revoked is True
        (revoke,) = [r for r in intuit.requests if str(r.url) == REVOKE_URL]
        assert json.loads(revoke.content) == {"token": "refresh-0"}
        connection = await _connection(db_session, books["org_id"])
        assert connection.status == sync.DISCONNECTED
        assert connection.access_token is None
        assert connection.refresh_token is None
        assert await _postings(db_session, books["org_id"]) == {}
        assert len(await _rows(db_session, books["org_id"], books["user_id"])) == 8

    async def test_a_posting_awaiting_a_retry_survives_disconnect(
        self, db_session, books, configured, intuit
    ):
        await _connect(db_session, books["org_id"])
        intuit.purchase_faults = ["drop_after_create"]
        await _run(db_session, books["org_id"], intuit)
        async with intuit.client() as http:
            await sync.disconnect(db_session, http, books["org_id"])

        statuses = sorted(
            p.status for p in (await _postings(db_session, books["org_id"])).values()
        )
        assert statuses == ["posted", "posted", "retrying"]
        # Kept out of the CSV file: QuickBooks may already hold it.
        rows = await _rows(db_session, books["org_id"], books["user_id"])
        assert rows == []


async def _api(db: AsyncSession, org_id: str, permissions) -> AsyncClient:
    user_id = await _treasurer(db, org_id, permissions)
    user = await db.get(User, user_id)
    await db.refresh(user, ["positions"])
    app = FastAPI()
    app.include_router(qbo_endpoints.router, prefix="/finance/quickbooks")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


class TestEndpoints:
    async def test_start_sets_the_nonce_cookie_on_the_callback_path(
        self, db_session, configured
    ):
        org_id = await _org(db_session)
        async with await _api(db_session, org_id, ["finance.manage"]) as client:
            response = await client.post("/finance/quickbooks/oauth/start")

        assert response.status_code == 200
        url = response.json()["authorizationUrl"]
        assert url.startswith("https://appcenter.intuit.com/connect/oauth2?")
        cookie = response.headers["set-cookie"]
        assert "qbo_oauth_nonce=" in cookie
        assert "Path=/api/v1/finance/quickbooks/" in cookie
        assert "HttpOnly" in cookie

    async def test_start_is_refused_when_not_configured(self, db_session, monkeypatch):
        monkeypatch.setattr(settings, "QBO_CLIENT_ID", None)
        org_id = await _org(db_session)
        async with await _api(db_session, org_id, ["finance.manage"]) as client:
            response = await client.post("/finance/quickbooks/oauth/start")
        assert response.status_code == 400
        assert "QBO_CLIENT_ID" in response.json()["detail"]

    async def test_start_needs_finance_manage(self, db_session, configured):
        org_id = await _org(db_session)
        async with await _api(db_session, org_id, ["finance.view"]) as client:
            response = await client.post("/finance/quickbooks/oauth/start")
        assert response.status_code == 403

    async def test_a_bad_callback_redirects_back_with_the_reason(
        self, db_session, configured
    ):
        org_id = await _org(db_session)
        async with await _api(db_session, org_id, ["finance.manage"]) as client:
            response = await client.get(
                "/finance/quickbooks/oauth/callback",
                params={"code": "c", "state": "garbage", "realmId": REALM},
            )
        assert response.status_code == 302
        assert response.headers["location"].endswith(
            "/finance/settings/quickbooks?quickbooks_error=invalid_state"
        )

    async def test_connection_reports_not_configured(self, db_session, monkeypatch):
        monkeypatch.setattr(settings, "QBO_CLIENT_SECRET", "")
        org_id = await _org(db_session)
        async with await _api(db_session, org_id, ["finance.view"]) as client:
            response = await client.get("/finance/quickbooks/connection")
        assert response.status_code == 200
        body = response.json()
        assert body["configured"] is False
        assert body["status"] == "disconnected"
        assert body["counts"]["posted"] == 0

    async def test_postings_filter_by_payment(
        self, db_session, books, configured, intuit
    ):
        await _connect(db_session, books["org_id"])
        await _run(db_session, books["org_id"], intuit)
        purchase_id = books["purchase"].id
        async with await _api(db_session, books["org_id"], ["finance.view"]) as client:
            response = await client.get(
                "/finance/quickbooks/postings",
                params={"paymentType": "purchase_request", "paymentId": purchase_id},
            )
        assert response.status_code == 200
        (row,) = response.json()
        assert row["documentNumber"] == "PR-2026-0001"
        assert row["status"] == "posted"
        assert row["qbPurchaseId"] in intuit.purchases

    async def test_retry_needs_finance_manage(self, db_session, books, configured):
        async with await _api(db_session, books["org_id"], ["finance.view"]) as client:
            response = await client.post(
                f"/finance/quickbooks/postings/{uuid.uuid4()}/retry"
            )
        assert response.status_code == 403


class TestKeepingTheConnection:
    async def test_a_quiet_department_renews_its_grant_before_it_expires(
        self, db_session, configured, intuit
    ):
        org_id = await _org(db_session)
        await _connect(db_session, org_id)
        connection = await _connection(db_session, org_id)
        connection.refresh_token_expires_at = datetime.now(timezone.utc) + timedelta(
            days=10
        )
        await db_session.commit()

        await _run(db_session, org_id, intuit)

        assert intuit.refresh_count == 1
        connection = await _connection(db_session, org_id)
        assert connection.refresh_token == "refresh-1"
        expires = connection.refresh_token_expires_at
        assert expires is not None
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        assert expires - datetime.now(timezone.utc) > timedelta(days=99)

    async def test_a_grant_with_time_left_is_not_renewed(
        self, db_session, configured, intuit
    ):
        org_id = await _org(db_session)
        await _connect(db_session, org_id)
        connection = await _connection(db_session, org_id)
        connection.refresh_token_expires_at = datetime.now(timezone.utc) + timedelta(
            days=90
        )
        await db_session.commit()

        await _run(db_session, org_id, intuit)

        assert intuit.requests == []

"""The Intuit calls, against a mock transport shaped like Intuit's documentation.

No request leaves the process. Each fixture response is the shape Intuit's
pages show (see the module docstring of app/services/quickbooks_online_client.py
for the URLs): the token response of "Set up OAuth 2.0", the
``{"QueryResponse": {...}}`` of a query, the ``{"Fault": {"Error": [...]}}`` of
a refused request, and an entity create answered as ``{"<Entity>": {...}}``.
"""

import base64
import json
from decimal import Decimal
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from app.core.config import Settings, settings
from app.services import quickbooks_online_client as qbo

pytestmark = [pytest.mark.unit]

CREDS = qbo.Credentials(
    client_id="client-abc",
    client_secret="secret-xyz",
    redirect_uri="https://app.example.org/api/v1/finance/quickbooks/oauth/callback",
    environment="sandbox",
)

TOKEN_RESPONSE = {
    "token_type": "bearer",
    "expires_in": 3600,
    "refresh_token": "Q011-new-refresh",
    "x_refresh_token_expires_in": 8640000,
    "access_token": "eyJ-access",
}


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _accounting(http: httpx.AsyncClient) -> qbo.AccountingClient:
    return qbo.AccountingClient(
        http, environment="sandbox", realm_id="9130350", access_token="tok"
    )


class TestConfiguration:
    def test_blank_credentials_mean_not_configured(self, monkeypatch):
        monkeypatch.setattr(settings, "QBO_CLIENT_ID", "id")
        monkeypatch.setattr(settings, "QBO_CLIENT_SECRET", "")
        monkeypatch.setattr(settings, "QBO_REDIRECT_URI", "https://x/cb")
        assert qbo.configured_credentials() is None
        with pytest.raises(qbo.QuickBooksNotConfigured):
            qbo.require_credentials()

    def test_all_three_set_is_configured(self, monkeypatch):
        monkeypatch.setattr(settings, "QBO_CLIENT_ID", "id")
        monkeypatch.setattr(settings, "QBO_CLIENT_SECRET", "secret")
        monkeypatch.setattr(settings, "QBO_REDIRECT_URI", "https://x/cb")
        monkeypatch.setattr(settings, "QBO_ENVIRONMENT", "production")
        creds = qbo.configured_credentials()
        assert creds == qbo.Credentials("id", "secret", "https://x/cb", "production")

    def test_environment_must_be_sandbox_or_production(self):
        with pytest.raises(ValueError, match="QBO_ENVIRONMENT must be"):
            Settings(QBO_ENVIRONMENT="staging")
        assert Settings(QBO_ENVIRONMENT=" Production ").QBO_ENVIRONMENT == (
            "production"
        )


class TestOAuth:
    def test_authorization_url_asks_for_the_accounting_scope_only(self):
        url = qbo.authorization_url(CREDS, "signed-state")
        parts = urlsplit(url)
        query = parse_qs(parts.query)
        assert f"{parts.scheme}://{parts.netloc}{parts.path}" == (
            "https://appcenter.intuit.com/connect/oauth2"
        )
        assert query == {
            "client_id": ["client-abc"],
            "response_type": ["code"],
            "scope": ["com.intuit.quickbooks.accounting"],
            "redirect_uri": [CREDS.redirect_uri],
            "state": ["signed-state"],
        }

    async def test_code_exchange_posts_the_form_with_basic_auth(self):
        seen: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return httpx.Response(200, json=TOKEN_RESPONSE)

        async with _client(handler) as http:
            tokens = await qbo.exchange_code(http, CREDS, "auth-code-1")

        (request,) = seen
        assert str(request.url) == (
            "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
        )
        expected = base64.b64encode(b"client-abc:secret-xyz").decode()
        assert request.headers["Authorization"] == f"Basic {expected}"
        assert parse_qs(request.content.decode()) == {
            "grant_type": ["authorization_code"],
            "code": ["auth-code-1"],
            "redirect_uri": [CREDS.redirect_uri],
        }
        assert tokens.access_token == "eyJ-access"
        assert tokens.refresh_token == "Q011-new-refresh"
        assert tokens.access_expires_at is not None
        assert tokens.refresh_expires_at is not None
        lifetime = tokens.refresh_expires_at - tokens.access_expires_at
        assert round(lifetime.total_seconds()) == 8640000 - 3600

    async def test_refresh_returns_the_rotated_refresh_token(self):
        def handler(request: httpx.Request) -> httpx.Response:
            assert parse_qs(request.content.decode()) == {
                "grant_type": ["refresh_token"],
                "refresh_token": ["Q011-old"],
            }
            return httpx.Response(200, json=TOKEN_RESPONSE)

        async with _client(handler) as http:
            tokens = await qbo.refresh_tokens(http, CREDS, "Q011-old")
        assert tokens.refresh_token == "Q011-new-refresh"

    async def test_invalid_grant_means_reconnect(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(400, json={"error": "invalid_grant"})

        async with _client(handler) as http:
            with pytest.raises(qbo.QuickBooksAuthError):
                await qbo.refresh_tokens(http, CREDS, "Q011-old")

    async def test_token_endpoint_outage_is_transient(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(503)

        async with _client(handler) as http:
            with pytest.raises(qbo.QuickBooksTransient):
                await qbo.refresh_tokens(http, CREDS, "Q011-old")

    async def test_revoke_sends_the_token_as_json(self):
        seen: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return httpx.Response(200)

        async with _client(handler) as http:
            assert await qbo.revoke_token(http, CREDS, "Q011-refresh") is True
        (request,) = seen
        assert str(request.url) == (
            "https://developer.api.intuit.com/v2/oauth2/tokens/revoke"
        )
        assert json.loads(request.content) == {"token": "Q011-refresh"}

    async def test_revoke_refused_is_reported_not_raised(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(400, json={"error": "invalid_token"})

        async with _client(handler) as http:
            assert await qbo.revoke_token(http, CREDS, "gone") is False


class TestAccountingCalls:
    async def test_purchase_create_carries_requestid_and_minorversion(self):
        seen: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return httpx.Response(
                200, json={"Purchase": {"Id": "252", "SyncToken": "0"}, "time": "t"}
            )

        body = {"PaymentType": "Cash", "AccountRef": {"value": "35"}, "Line": []}
        async with _client(handler) as http:
            created = await _accounting(http).create_purchase(body, "req-1")

        (request,) = seen
        assert request.method == "POST"
        assert request.url.path == "/v3/company/9130350/purchase"
        assert request.url.host == "sandbox-quickbooks.api.intuit.com"
        assert dict(request.url.params) == {"requestid": "req-1", "minorversion": "75"}
        assert request.headers["Authorization"] == "Bearer tok"
        assert request.headers["Content-Type"] == "application/json"
        assert json.loads(request.content) == body
        assert created["Id"] == "252"

    async def test_production_uses_the_production_host(self):
        seen: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return httpx.Response(200, json={"Vendor": {"Id": "7"}})

        async with _client(handler) as http:
            client = qbo.AccountingClient(
                http, environment="production", realm_id="1", access_token="t"
            )
            await client.create_vendor("Red Cross", "req-2-v")
        assert seen[0].url.host == "quickbooks.api.intuit.com"
        assert json.loads(seen[0].content) == {"DisplayName": "Red Cross"}

    async def test_a_fault_is_a_rejection_with_its_code(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                400,
                json={
                    "Fault": {
                        "Error": [
                            {
                                "Message": "Duplicate Name Exists Error",
                                "Detail": "The name supplied already exists.",
                                "code": "6240",
                                "element": "",
                            }
                        ],
                        "type": "ValidationFault",
                    },
                    "time": "2017-09-29T09:17:31.892-07:00",
                },
            )

        async with _client(handler) as http:
            with pytest.raises(qbo.QuickBooksRejected) as raised:
                await _accounting(http).create_vendor("Red Cross", "req-3")
        assert raised.value.code == "6240"
        assert str(raised.value) == (
            "Duplicate Name Exists Error - The name supplied already exists."
        )

    @pytest.mark.parametrize(
        ("status", "error"),
        [
            (429, qbo.QuickBooksRateLimited),
            (401, qbo.QuickBooksAuthError),
            (403, qbo.QuickBooksAuthError),
            (500, qbo.QuickBooksTransient),
            (503, qbo.QuickBooksTransient),
        ],
    )
    async def test_status_codes_map_to_what_the_caller_does(self, status, error):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(status, json={})

        async with _client(handler) as http:
            with pytest.raises(error):
                await _accounting(http).create_purchase({}, "req-4")

    async def test_a_dropped_connection_is_transient(self):
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("no answer", request=request)

        async with _client(handler) as http:
            with pytest.raises(qbo.QuickBooksTransient):
                await _accounting(http).create_purchase({}, "req-5")

    async def test_a_success_without_the_record_is_not_taken_as_created(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"time": "t"})

        async with _client(handler) as http:
            with pytest.raises(qbo.QuickBooksTransient):
                await _accounting(http).create_purchase({}, "req-6")

    async def test_query_pages_through_a_thousand_at_a_time(self):
        statements: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            statement = request.url.params["query"]
            statements.append(statement)
            first = "STARTPOSITION 1 " in statement
            count = qbo.QUERY_PAGE_SIZE if first else 3
            vendors = [{"Id": str(i), "DisplayName": f"V{i}"} for i in range(count)]
            return httpx.Response(
                200,
                json={"QueryResponse": {"Vendor": vendors, "startPosition": 1}},
            )

        async with _client(handler) as http:
            vendors = await _accounting(http).list_vendors()

        assert statements == [
            "SELECT * FROM Vendor STARTPOSITION 1 MAXRESULTS 1000",
            "SELECT * FROM Vendor STARTPOSITION 1001 MAXRESULTS 1000",
        ]
        assert len(vendors) == qbo.QUERY_PAGE_SIZE + 3

    async def test_an_empty_query_response_is_an_empty_list(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"QueryResponse": {}, "time": "t"})

        async with _client(handler) as http:
            assert await _accounting(http).list_accounts() == []

    async def test_an_entity_outside_the_allowlist_is_refused_unsent(self):
        sent: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            sent.append(request)
            return httpx.Response(200, json={"QueryResponse": {}})

        async with _client(handler) as http:
            with pytest.raises(ValueError, match="cannot be queried"):
                await _accounting(http).query("Vendor WHERE Active = false")

        assert sent == []

    def test_request_ids_longer_than_intuit_allows_are_refused(self):
        with pytest.raises(ValueError, match="1 to 50 characters"):
            qbo._request_id("x" * 51)


class TestPurchaseBody:
    """The Purchase each payment type becomes. The values are Intuit's v3
    schema's (see the client module docstring): PaymentType Cash, Check or
    CreditCard; a check's number in DocNumber; PrintStatus NotSet on a check
    so it does not wait in QuickBooks' print queue; Credit false on a card
    charge."""

    LINES = [("60", Decimal("240.50")), ("61", Decimal("15.00"))]

    def _lines(self):
        return [
            {
                "Amount": 240.5,
                "DetailType": "AccountBasedExpenseLineDetail",
                "AccountBasedExpenseLineDetail": {"AccountRef": {"value": "60"}},
            },
            {
                "Amount": 15.0,
                "DetailType": "AccountBasedExpenseLineDetail",
                "AccountBasedExpenseLineDetail": {"AccountRef": {"value": "61"}},
            },
        ]

    def test_cash_is_unchanged(self):
        body = qbo.purchase_body(
            payment_type=qbo.PAYMENT_TYPE_CASH,
            account_id="35",
            txn_date="2026-03-10",
            doc_number="PR-2026-0001",
            lines=self.LINES,
        )
        assert body == {
            "PaymentType": "Cash",
            "AccountRef": {"value": "35"},
            "TxnDate": "2026-03-10",
            "DocNumber": "PR-2026-0001",
            "Line": self._lines(),
        }

    def test_a_check_carries_its_number_and_is_not_queued_to_print(self):
        body = qbo.purchase_body(
            payment_type=qbo.PAYMENT_TYPE_CHECK,
            account_id="35",
            txn_date="2026-03-11",
            doc_number="1042",
            private_note="CR-2026-0001",
            lines=self.LINES,
        )
        assert body == {
            "PaymentType": "Check",
            "AccountRef": {"value": "35"},
            "TxnDate": "2026-03-11",
            "DocNumber": "1042",
            "PrivateNote": "CR-2026-0001",
            "PrintStatus": "NotSet",
            "Line": self._lines(),
        }

    def test_a_check_with_no_number_sends_none(self):
        body = qbo.purchase_body(
            payment_type=qbo.PAYMENT_TYPE_CHECK,
            account_id="35",
            txn_date="2026-03-11",
            doc_number=None,
            private_note="CR-2026-0001",
            lines=self.LINES,
        )
        assert "DocNumber" not in body
        assert body["PaymentType"] == "Check"

    def test_a_card_payment_is_a_charge_on_the_card_account(self):
        body = qbo.purchase_body(
            payment_type=qbo.PAYMENT_TYPE_CREDIT_CARD,
            account_id="40",
            txn_date="2026-03-12",
            doc_number="ER-2026-0001",
            lines=self.LINES,
        )
        assert body == {
            "PaymentType": "CreditCard",
            "AccountRef": {"value": "40"},
            "TxnDate": "2026-03-12",
            "DocNumber": "ER-2026-0001",
            "Credit": False,
            "Line": self._lines(),
        }

    def test_each_payment_type_names_the_account_type_it_is_paid_from(self):
        assert qbo.PAID_FROM_ACCOUNT_TYPE == {
            "Cash": "Bank",
            "Check": "Bank",
            "CreditCard": "Credit Card",
        }

    def test_a_number_longer_than_quickbooks_allows_is_refused(self):
        with pytest.raises(ValueError, match="21 characters"):
            qbo.purchase_body(
                payment_type=qbo.PAYMENT_TYPE_CHECK,
                account_id="35",
                txn_date="2026-03-11",
                doc_number="1" * 22,
                lines=self.LINES,
            )

    def test_an_unknown_payment_type_is_refused(self):
        with pytest.raises(ValueError, match="payment type"):
            qbo.purchase_body(
                payment_type="Expense",
                account_id="35",
                txn_date="2026-03-11",
                doc_number="X",
                lines=self.LINES,
            )

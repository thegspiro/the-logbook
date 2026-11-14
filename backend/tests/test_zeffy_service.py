"""Zeffy client: webhook signatures, payment parsing and the HTTP wrapper.

Signatures follow Zeffy's published scheme: ``Zeffy-Signature: t=<unix>,v1=<hex>``
where v1 is HMAC-SHA256 of ``"{t}.{raw body}"`` under the ``whsec_`` secret.
Amounts arrive in integer cents. Nothing here touches the network.
"""

import hashlib
import hmac
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

from app.services.integration_services import zeffy_service
from app.services.integration_services.zeffy_service import (
    ZeffyClient,
    ZeffyError,
    ZeffyRateLimited,
    cents,
    parse_payment,
    redact_payment,
    verify_signature,
)

pytestmark = pytest.mark.unit

SECRET = "whsec_test_secret"
BODY = b'{"id":"evt_1","type":"payment.completed","data":{"id":"pay_1"}}'
NOW = 1_800_000_000


def _sign(body: bytes, t: int, secret: str = SECRET) -> str:
    digest = hmac.new(secret.encode(), f"{t}.".encode() + body, hashlib.sha256)
    return f"t={t},v1={digest.hexdigest()}"


def payment(**overrides):
    base = {
        "id": "pay_1",
        "object": "payment",
        "created": NOW,
        "amount": 12550,
        "eligible_amount": 12550,
        "currency": "usd",
        "status": "succeeded",
        "type": "online",
        "refund_status": "none",
        "refunds": [],
        "dispute": None,
        "description": "Pancake Breakfast",
        "contact": "contact_1",
        "payment_method": {"type": "card", "brand": "visa", "last4": "4242"},
        "buyer": {
            "email": "pat@example.org",
            "first_name": "Pat",
            "last_name": "Donor",
            "is_corporate": False,
            "company_name": None,
            "address": {"line1": "1 Main St"},
        },
        "discount": None,
        "campaign_type": "ticketing",
        "campaign_id": "camp_1",
        "campaign_category": "event",
        "parent_campaign_id": None,
        "team_id": None,
        "buyer_questions": [{"question": "Allergies?", "answer": "peanuts"}],
        "items": [
            {"type": "ticket", "amount": 5000, "questions": [{"answer": "x"}]},
            {"type": "ticket", "amount": 5000, "questions": []},
            {
                "type": "additional_donation",
                "amount": 2550,
                "tribute": {"type": "in_memory_of", "honouree_name": "Chief Ray"},
            },
        ],
        "occurrence_id": None,
        "receipt_url": "https://zeffy.example/receipt/1",
        "recurring": None,
        "fund": None,
        "metadata": {},
    }
    base.update(overrides)
    return base


class TestVerifySignature:
    def test_accepts_a_fresh_valid_signature(self):
        assert verify_signature(BODY, _sign(BODY, NOW), SECRET, now=NOW + 10)

    def test_rejects_a_signature_from_another_secret(self):
        header = _sign(BODY, NOW, secret="whsec_someone_else")
        assert not verify_signature(BODY, header, SECRET, now=NOW)

    def test_rejects_a_modified_body(self):
        header = _sign(BODY, NOW)
        assert not verify_signature(BODY + b" ", header, SECRET, now=NOW)

    def test_rejects_a_stale_timestamp(self):
        header = _sign(BODY, NOW)
        assert not verify_signature(BODY, header, SECRET, now=NOW + 301)

    def test_rejects_when_no_secret_is_configured(self):
        assert not verify_signature(BODY, _sign(BODY, NOW), "", now=NOW)

    @pytest.mark.parametrize(
        "header", [None, "", "garbage", "t=abc,v1=00", f"t={NOW}", "v1=00"]
    )
    def test_rejects_a_malformed_header(self, header):
        assert not verify_signature(BODY, header, SECRET, now=NOW)

    def test_any_matching_v1_is_accepted(self):
        valid = _sign(BODY, NOW).split(",v1=")[1]
        header = f"t={NOW},v1={'0' * 64},v1={valid}"
        assert verify_signature(BODY, header, SECRET, now=NOW)


class TestParsePayment:
    def test_converts_cents_once(self):
        parsed = parse_payment(payment())
        assert parsed.amount == Decimal("125.50")
        assert parsed.net_amount == Decimal("125.50")
        assert parsed.currency == "USD"

    def test_reads_the_fields_the_ledger_keeps(self):
        parsed = parse_payment(payment())
        assert parsed.zeffy_payment_id == "pay_1"
        assert parsed.campaign_id == "camp_1"
        assert parsed.campaign_category == "event"
        assert parsed.ticket_count == 2
        assert parsed.payer_name == "Pat Donor"
        assert parsed.payer_email == "pat@example.org"
        assert parsed.payment_method_type == "card"
        assert (parsed.tribute_type, parsed.tribute_name) == (
            "in_memory_of",
            "Chief Ray",
        )
        assert parsed.paid_at is not None
        assert int(parsed.paid_at.timestamp()) == NOW

    def test_only_succeeded_refunds_reduce_the_net(self):
        parsed = parse_payment(
            payment(
                refund_status="partial",
                refunds=[
                    {"amount": 2000, "status": "succeeded"},
                    {"amount": 5000, "status": "pending"},
                    {"amount": 1000, "status": "failed"},
                ],
            )
        )
        assert parsed.refunded_amount == Decimal("20.00")
        assert parsed.net_amount == Decimal("105.50")
        assert parsed.counts

    @pytest.mark.parametrize(
        "overrides",
        [
            {"status": "pending"},
            {"status": "failed"},
            {"refund_status": "full"},
            {"dispute": {"status": "lost", "amount": 12550}},
            {"refunds": [{"amount": 12550, "status": "succeeded"}]},
        ],
    )
    def test_money_the_department_does_not_hold_does_not_count(self, overrides):
        assert not parse_payment(payment(**overrides)).counts

    def test_an_open_dispute_still_counts(self):
        parsed = parse_payment(payment(dispute={"status": "needs_response"}))
        assert parsed.counts

    def test_a_corporate_buyer_is_named_by_company(self):
        parsed = parse_payment(
            payment(
                buyer={
                    "first_name": "Pat",
                    "last_name": "Donor",
                    "is_corporate": True,
                    "company_name": "Main St Hardware",
                }
            )
        )
        assert parsed.payer_name == "Main St Hardware"
        assert parsed.payer_company == "Main St Hardware"

    def test_a_recurring_interval_is_read_only_for_a_recurring_payment(self):
        recurring = {"is_recurring": True, "interval": "monthly"}
        assert parse_payment(payment(recurring=recurring)).recurring_interval == (
            "monthly"
        )
        assert parse_payment(payment()).recurring_interval is None

    def test_a_payment_with_no_id_is_refused(self):
        with pytest.raises(ZeffyError):
            parse_payment(payment(id=None))

    @pytest.mark.parametrize(
        ("value", "expected"),
        [(None, "0"), (True, "0"), ("abc", "0"), (1, "0.01"), (199999, "1999.99")],
    )
    def test_cents(self, value, expected):
        assert cents(value) == Decimal(expected)


class TestRedactPayment:
    def test_removes_contact_details_and_answers(self):
        original = payment()
        redacted = redact_payment(original)
        assert "email" not in redacted["buyer"]
        assert "address" not in redacted["buyer"]
        assert "buyer_questions" not in redacted
        assert all("questions" not in item for item in redacted["items"])
        # The amounts and the buyer's name survive for support.
        assert redacted["amount"] == 12550
        assert redacted["buyer"]["first_name"] == "Pat"
        # The original is untouched.
        assert original["buyer"]["email"] == "pat@example.org"


class _FakeResponse:
    def __init__(self, status_code, body=None, headers=None):
        self.status_code = status_code
        self._body = body if body is not None else {}
        self.headers = headers or {}

    def json(self):
        return self._body


class _FakeClient:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url, params=None, headers=None):
        self.calls.append((url, params or {}, headers or {}))
        return self._responses.pop(0)


def _fake_http(client):
    return patch.object(
        zeffy_service, "create_integration_client", MagicMock(return_value=client)
    )


class TestZeffyClient:
    async def test_get_payment_sends_the_key_and_quotes_the_id(self):
        client = _FakeClient([_FakeResponse(200, {"id": "a/b"})])
        with _fake_http(client):
            body = await ZeffyClient("key-1").get_payment("a/b")
        assert body == {"id": "a/b"}
        url, _, headers = client.calls[0]
        assert url == "https://api.zeffy.com/api/v1/payments/a%2Fb"
        assert headers["Authorization"] == "Bearer key-1"

    async def test_a_missing_payment_is_none(self):
        with _fake_http(_FakeClient([_FakeResponse(404)])):
            assert await ZeffyClient("k").get_payment("gone") is None

    async def test_a_rejected_key_says_so(self):
        with _fake_http(_FakeClient([_FakeResponse(401)])):
            with pytest.raises(ZeffyError, match="rejected the API key"):
                await ZeffyClient("k").ping()

    async def test_a_rate_limit_carries_retry_after(self):
        response = _FakeResponse(429, headers={"Retry-After": "60"})
        with _fake_http(_FakeClient([response])):
            with pytest.raises(ZeffyRateLimited) as caught:
                await ZeffyClient("k").get_payment("p")
        assert caught.value.retry_after == 60

    async def test_list_payments_page_passes_the_window_and_cursor(self):
        client = _FakeClient([_FakeResponse(200, {"data": [], "has_more": False})])
        with _fake_http(client):
            await ZeffyClient("k").list_payments_page(
                campaign_id="camp_1", created_gte=10, created_lt=20, starting_after="p9"
            )
        _, params, _ = client.calls[0]
        assert params == {
            "limit": 100,
            "created[gte]": 10,
            "created[lt]": 20,
            "campaign": "camp_1",
            "starting_after": "p9",
        }

    async def test_list_campaigns_follows_the_cursor(self):
        client = _FakeClient(
            [
                _FakeResponse(
                    200, {"data": [{"id": "c1"}], "has_more": True, "next_cursor": "c1"}
                ),
                _FakeResponse(200, {"data": [{"id": "c2"}], "has_more": False}),
            ]
        )
        with _fake_http(client):
            campaigns = await ZeffyClient("k").list_campaigns()
        assert [c["id"] for c in campaigns] == ["c1", "c2"]
        assert client.calls[1][1]["starting_after"] == "c1"

    def test_no_key_is_refused_before_any_request(self):
        with pytest.raises(ZeffyError):
            ZeffyClient("")

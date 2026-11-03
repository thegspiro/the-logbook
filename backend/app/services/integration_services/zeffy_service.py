"""
Zeffy Integration Service

Read-only client for Zeffy's public API (https://api.zeffy.com/api/docs), plus
the two pure functions every caller shares: webhook signature verification and
turning a Zeffy payment object into the fields the Logbook stores.

What Zeffy documents, and what this module relies on:

* Bearer API key, one quota per Zeffy organization: 100 requests a minute and
  20 a second. A 429 carries ``Retry-After``; we stop the run and let the next
  one continue rather than sleeping inside a request or a scheduled task.
* Amounts are integer **cents**. Converting once, here, is the whole defence
  against a hundredfold error elsewhere.
* List endpoints page with ``starting_after`` / ``next_cursor`` and accept
  ``created[gte]`` / ``created[lt]`` in Unix seconds. The sort order is not
  documented, so nothing here depends on it.
* Webhooks are signed: ``Zeffy-Signature: t=<unix>,v1=<hex>`` where ``v1`` is
  HMAC-SHA256 of ``"{t}.{raw body}"`` under the ``whsec_`` signing secret.
"""

import copy
import hashlib
import hmac
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import httpx

from app.models.integration import Integration
from app.services.integration_services.base import create_integration_client

API_BASE = "https://api.zeffy.com/api/v1"

_TIMEOUT = httpx.Timeout(15.0, connect=10.0)
_PAGE_SIZE = 100
# Campaign listing is for the linking screen; a department with more than a
# thousand campaigns sees the first thousand.
_CAMPAIGN_MAX_PAGES = 10

# Zeffy recommends five minutes. A delivery signed longer ago than this is
# refused even with a valid signature, so a captured request cannot be
# replayed later.
SIGNATURE_TOLERANCE_SECONDS = 5 * 60

_CENT = Decimal("0.01")


class ZeffyError(Exception):
    """A Zeffy API call failed. The message is written for the treasurer."""


class ZeffyRateLimited(ZeffyError):
    """Zeffy answered 429. ``retry_after`` is its own suggested wait, in seconds."""

    def __init__(self, retry_after: Optional[int]) -> None:
        super().__init__(
            "Zeffy's rate limit was reached; the rest will be read on the next run."
        )
        self.retry_after = retry_after


# ======================================================================
# Webhook signatures
# ======================================================================


def verify_signature(
    raw_body: bytes,
    signature_header: Optional[str],
    secret: Optional[str],
    now: Optional[float] = None,
) -> bool:
    """Whether a webhook delivery was signed by Zeffy with this secret.

    False for anything short of a fresh, matching signature: no secret
    configured, a missing or malformed header, a timestamp outside the
    tolerance, or a mismatch. Every ``v1`` value present is tried, so a header
    carrying more than one signature still verifies.
    """
    if not secret or not signature_header:
        return False

    timestamp: Optional[str] = None
    signatures: List[str] = []
    for part in signature_header.split(","):
        key, sep, value = part.strip().partition("=")
        if not sep:
            continue
        if key == "t":
            timestamp = value
        elif key == "v1" and value:
            signatures.append(value)
    if timestamp is None or not signatures:
        return False
    try:
        signed_at = int(timestamp)
    except ValueError:
        return False
    current = time.time() if now is None else now
    if abs(current - signed_at) > SIGNATURE_TOLERANCE_SECONDS:
        return False

    expected = hmac.new(
        secret.encode(), f"{timestamp}.".encode() + raw_body, hashlib.sha256
    ).hexdigest()
    return any(hmac.compare_digest(expected, candidate) for candidate in signatures)


# ======================================================================
# Payment parsing
# ======================================================================


@dataclass(frozen=True)
class ParsedPayment:
    """The fields of a Zeffy payment the Logbook stores and acts on."""

    zeffy_payment_id: str
    campaign_id: Optional[str]
    parent_campaign_id: Optional[str]
    campaign_title: Optional[str]
    campaign_category: Optional[str]
    payment_type: Optional[str]
    status: Optional[str]
    refund_status: Optional[str]
    dispute_status: Optional[str]
    amount: Decimal
    refunded_amount: Decimal
    currency: str
    ticket_count: int
    paid_at: Optional[datetime]
    payer_first_name: Optional[str]
    payer_last_name: Optional[str]
    payer_company: Optional[str]
    payer_email: Optional[str]
    payment_method_type: Optional[str]
    recurring_interval: Optional[str]
    tribute_type: Optional[str]
    tribute_name: Optional[str]
    receipt_url: Optional[str]

    @property
    def payer_name(self) -> Optional[str]:
        if self.payer_company:
            return self.payer_company
        name = " ".join(p for p in (self.payer_first_name, self.payer_last_name) if p)
        return name or None

    @property
    def net_amount(self) -> Decimal:
        """What the department kept: the amount less every refund that went through."""
        return max(self.amount - self.refunded_amount, Decimal("0"))

    @property
    def counts(self) -> bool:
        """Whether the department holds this money now.

        A payment counts once Zeffy reports it succeeded, and stops counting
        when it is fully refunded or a dispute is lost. ``net_amount`` covers a
        partial refund.
        """
        if self.status != "succeeded":
            return False
        if self.refund_status == "full" or self.net_amount <= 0:
            return False
        return self.dispute_status != "lost"


def cents(value: Any) -> Decimal:
    """Zeffy's integer cents as dollars. Anything unreadable is zero."""
    if value is None or isinstance(value, bool):
        return Decimal("0")
    try:
        return (Decimal(str(value)) / 100).quantize(_CENT, rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _text(value: Any, limit: int) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text[:limit] if text else None


def _timestamp(value: Any) -> Optional[datetime]:
    if value is None or isinstance(value, bool):
        return None
    try:
        return datetime.fromtimestamp(float(value), tz=timezone.utc)
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def as_dict(value: Any) -> Dict[str, Any]:
    """``value`` if it is a JSON object, else an empty one.

    Zeffy sends ``null`` for an absent nested object (no dispute, no
    recurrence), so every nested read goes through here.
    """
    return value if isinstance(value, dict) else {}


def parse_payment(payment: Dict[str, Any]) -> ParsedPayment:
    """Read a Zeffy payment object. Raises ZeffyError if it has no id."""
    payment_id = _text(payment.get("id"), 120)
    if not payment_id:
        raise ZeffyError("Zeffy sent a payment with no id")

    refunded = sum(
        (
            cents(refund.get("amount"))
            for refund in payment.get("refunds") or []
            if isinstance(refund, dict) and refund.get("status") == "succeeded"
        ),
        Decimal("0"),
    )
    items = [i for i in payment.get("items") or [] if isinstance(i, dict)]
    tribute = next(
        (i["tribute"] for i in items if isinstance(i.get("tribute"), dict)), None
    )
    buyer = as_dict(payment.get("buyer"))
    dispute = as_dict(payment.get("dispute"))
    method = as_dict(payment.get("payment_method"))
    recurring = as_dict(payment.get("recurring"))

    return ParsedPayment(
        zeffy_payment_id=payment_id,
        campaign_id=_text(payment.get("campaign_id"), 120),
        parent_campaign_id=_text(payment.get("parent_campaign_id"), 120),
        campaign_title=_text(payment.get("description"), 255),
        campaign_category=_text(payment.get("campaign_category"), 30),
        payment_type=_text(payment.get("type"), 20),
        status=_text(payment.get("status"), 30),
        refund_status=_text(payment.get("refund_status"), 10),
        dispute_status=_text(dispute.get("status"), 20),
        amount=cents(payment.get("amount")),
        refunded_amount=refunded,
        currency=(_text(payment.get("currency"), 3) or "USD").upper(),
        ticket_count=sum(1 for i in items if i.get("type") == "ticket"),
        paid_at=_timestamp(payment.get("created")),
        payer_first_name=_text(buyer.get("first_name"), 100),
        payer_last_name=_text(buyer.get("last_name"), 100),
        payer_company=(
            _text(buyer.get("company_name"), 200) if buyer.get("is_corporate") else None
        ),
        payer_email=_text(buyer.get("email"), 255),
        payment_method_type=_text(method.get("type"), 30),
        recurring_interval=(
            _text(recurring.get("interval"), 20)
            if recurring.get("is_recurring")
            else None
        ),
        tribute_type=_text((tribute or {}).get("type"), 20),
        tribute_name=_text((tribute or {}).get("honouree_name"), 255),
        receipt_url=_text(payment.get("receipt_url"), 500),
    )


def redact_payment(payment: Dict[str, Any]) -> Dict[str, Any]:
    """A copy of a Zeffy payment safe to keep for support.

    The buyer's email is stored encrypted in its own column, and their mailing
    address and checkout answers are never needed, so none of them is kept in
    the plaintext JSON.
    """
    redacted = copy.deepcopy(payment)
    buyer = redacted.get("buyer")
    if isinstance(buyer, dict):
        buyer.pop("email", None)
        buyer.pop("address", None)
    redacted.pop("buyer_questions", None)
    for item in redacted.get("items") or []:
        if isinstance(item, dict):
            item.pop("questions", None)
    return redacted


# ======================================================================
# API client
# ======================================================================


def api_key_from_integration(integration: Integration) -> str:
    return integration.get_secret("api_key") or ""


def webhook_secret_from_integration(integration: Integration) -> str:
    return integration.get_secret("webhook_secret") or ""


class ZeffyClient:
    """Thin wrapper over the three read endpoints the integration uses."""

    def __init__(self, api_key: str, base_url: str = API_BASE) -> None:
        if not api_key:
            raise ZeffyError("No Zeffy API key is configured")
        self._api_key = api_key
        self._base_url = base_url

    async def _get(
        self, path: str, params: Optional[Dict[str, Any]] = None
    ) -> Optional[Dict[str, Any]]:
        """GET a path; None on 404, ZeffyError on any other failure."""
        try:
            async with create_integration_client(timeout=_TIMEOUT) as client:
                response = await client.get(
                    f"{self._base_url}{path}",
                    params=params,
                    headers={
                        "Authorization": f"Bearer {self._api_key}",
                        "Accept": "application/json",
                    },
                )
        except httpx.HTTPError as exc:
            raise ZeffyError("Zeffy could not be reached") from exc

        if response.status_code == 404:
            return None
        if response.status_code == 401:
            raise ZeffyError(
                "Zeffy rejected the API key. Generate a new one under Settings → "
                "Integrations in Zeffy and paste it here."
            )
        if response.status_code == 429:
            retry_after = response.headers.get("Retry-After")
            raise ZeffyRateLimited(
                int(retry_after) if retry_after and retry_after.isdigit() else None
            )
        if response.status_code >= 400:
            raise ZeffyError(f"Zeffy returned {response.status_code}")
        try:
            body = response.json()
        except ValueError as exc:
            raise ZeffyError("Zeffy returned a response that was not JSON") from exc
        if not isinstance(body, dict):
            raise ZeffyError("Zeffy returned an unexpected response")
        return body

    async def ping(self) -> None:
        """Read one campaign, which proves the key without moving any data."""
        if await self._get("/campaigns", {"limit": 1}) is None:
            raise ZeffyError("Zeffy did not answer the campaigns request")

    async def get_payment(self, payment_id: str) -> Optional[Dict[str, Any]]:
        """The payment's current state, or None if Zeffy has no such payment.

        Zeffy documents a 404 here as "the payment was deleted".
        """
        return await self._get(f"/payments/{quote(payment_id, safe='')}")

    async def list_payments_page(
        self,
        *,
        campaign_id: Optional[str],
        created_gte: int,
        created_lt: int,
        starting_after: Optional[str] = None,
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {
            "limit": _PAGE_SIZE,
            "created[gte]": created_gte,
            "created[lt]": created_lt,
        }
        if campaign_id:
            params["campaign"] = campaign_id
        if starting_after:
            params["starting_after"] = starting_after
        return await self._get("/payments", params) or {}

    async def list_campaigns(self) -> List[Dict[str, Any]]:
        campaigns: List[Dict[str, Any]] = []
        cursor: Optional[str] = None
        for _ in range(_CAMPAIGN_MAX_PAGES):
            params: Dict[str, Any] = {"limit": _PAGE_SIZE}
            if cursor:
                params["starting_after"] = cursor
            body = await self._get("/campaigns", params) or {}
            campaigns.extend(c for c in body.get("data") or [] if isinstance(c, dict))
            cursor = body.get("next_cursor")
            if not body.get("has_more") or not cursor:
                break
        return campaigns


async def test_connection(integration: Integration) -> str:
    """Prove the API key works by reading one page of campaigns."""
    await ZeffyClient(api_key_from_integration(integration)).ping()
    message = "Connected to Zeffy."
    if not webhook_secret_from_integration(integration):
        message += (
            " No webhook signing secret is set, so payments arrive only on the"
            " hourly sync. Add the webhook in Zeffy and paste its whsec_ secret"
            " here for payments to arrive within seconds."
        )
    return message

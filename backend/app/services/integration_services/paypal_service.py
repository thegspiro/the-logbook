"""
PayPal Integration Service

Reconciliation only — this application never takes a payment. A department
connects its own PayPal *Business* account; PayPal then tells us what it
received, and we match those captures against store orders.

Why webhooks rather than polling: a capture notification arrives seconds after
the member pays, which is what makes "mark paid" disappear from the
quartermaster's queue on its own. The Transaction Search API lags by up to
several hours and needs an extra account permission, so it serves only as the
backfill for captures the webhook missed (see the end of this module).

Signature verification is delegated to PayPal's own
``/v1/notifications/verify-webhook-signature`` endpoint rather than validating
the certificate chain locally. That is the vendor-supported path: it keys the
check on the webhook id the department configured, and it cannot be fooled by a
forged ``PAYPAL-CERT-URL`` header the way a hand-rolled verifier can.
"""

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Mapping, Optional, Tuple
from urllib.parse import quote

import httpx
from loguru import logger

from app.models.integration import Integration
from app.schemas.integration import PAYPAL_AUTO_APPLY_DEFAULT
from app.services.integration_services.base import create_integration_client

# PayPal publishes one host per environment; there is no per-tenant endpoint.
_API_HOSTS = {
    "sandbox": "https://api-m.sandbox.paypal.com",
    "live": "https://api-m.paypal.com",
}

_TIMEOUT = httpx.Timeout(15.0, connect=10.0)

# The headers PayPal signs. All five are required by the verify API; a request
# missing any of them cannot have come from PayPal.
_SIGNATURE_HEADERS = (
    "paypal-auth-algo",
    "paypal-cert-url",
    "paypal-transmission-id",
    "paypal-transmission-sig",
    "paypal-transmission-time",
)


class PayPalError(Exception):
    """A PayPal API call failed or the integration is misconfigured."""


def paypal_auto_apply(config: Dict[str, Any]) -> bool:
    """Whether a matched capture settles its order without a human.

    The department's stored choice, or the default when its config was
    saved without one. Only a literal ``False`` turns it off: the config is
    validated as a bool on save, and a stray non-bool must not silently
    disable settlement either. The webhook and the backfill both read it
    here, so a capture settles the same way whichever path recorded it.
    """
    value = config.get("auto_apply_payments", PAYPAL_AUTO_APPLY_DEFAULT)
    return value is not False


def api_base(environment: Optional[str]) -> str:
    """Resolve the API host for an environment, defaulting to sandbox.

    Defaulting to sandbox is deliberate: a config that has lost its
    environment should not silently start talking to the live account.
    """
    return _API_HOSTS.get((environment or "sandbox").lower(), _API_HOSTS["sandbox"])


def credentials_from_integration(
    integration: Integration,
) -> Tuple[str, str, str, str]:
    """Pull (base_url, client_id, client_secret, webhook_id) off an integration."""
    config = integration.config or {}
    client_id = integration.get_secret("client_id") or config.get("client_id") or ""
    client_secret = (
        integration.get_secret("client_secret") or config.get("client_secret") or ""
    )
    webhook_id = config.get("webhook_id") or integration.get_secret("webhook_id") or ""
    return (
        api_base(config.get("environment")),
        client_id,
        client_secret,
        webhook_id,
    )


async def get_access_token(base_url: str, client_id: str, client_secret: str) -> str:
    """Exchange the REST app credentials for a bearer token."""
    if not client_id or not client_secret:
        raise PayPalError("PayPal client ID and secret are required")

    async with create_integration_client(timeout=_TIMEOUT) as client:
        response = await client.post(
            f"{base_url}/v1/oauth2/token",
            auth=(client_id, client_secret),
            data={"grant_type": "client_credentials"},
            headers={"Accept": "application/json"},
        )
    if response.status_code == 401:
        raise PayPalError(
            "PayPal rejected these credentials. Check the client ID and secret, "
            "and that they belong to the selected environment."
        )
    if response.status_code >= 400:
        raise PayPalError(f"PayPal returned {response.status_code} requesting a token")

    token = response.json().get("access_token")
    if not token:
        raise PayPalError("PayPal did not return an access token")
    return token


async def test_connection(integration: Integration) -> str:
    """Verify the stored credentials by fetching a token."""
    base_url, client_id, client_secret, webhook_id = credentials_from_integration(
        integration
    )
    await get_access_token(base_url, client_id, client_secret)

    environment = (integration.config or {}).get("environment", "sandbox")
    message = f"Connected to PayPal ({environment})."
    if not webhook_id:
        # Credentials alone get you nothing: without the webhook id we cannot
        # verify a delivery, so say so rather than reporting a bare success.
        message += (
            " No webhook ID is set yet, so incoming payments cannot be verified"
            " or matched. Add the webhook in the PayPal dashboard and paste its"
            " ID here."
        )
    return message


async def verify_webhook_signature(
    integration: Integration,
    headers: Mapping[str, str],
    event_body: Dict[str, Any],
) -> bool:
    """Ask PayPal whether this delivery genuinely came from them.

    Returns False (rather than raising) for anything that is not an explicit
    SUCCESS: a missing header, a misconfigured webhook id, or a transport
    failure all mean "do not trust this payload".
    """
    base_url, client_id, client_secret, webhook_id = credentials_from_integration(
        integration
    )
    if not webhook_id:
        logger.warning("PayPal webhook received but no webhook_id is configured")
        return False

    lowered = {k.lower(): v for k, v in headers.items()}
    missing = [h for h in _SIGNATURE_HEADERS if not lowered.get(h)]
    if missing:
        logger.warning(f"PayPal webhook missing signature headers: {missing}")
        return False

    try:
        token = await get_access_token(base_url, client_id, client_secret)
        async with create_integration_client(timeout=_TIMEOUT) as client:
            response = await client.post(
                f"{base_url}/v1/notifications/verify-webhook-signature",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={
                    "auth_algo": lowered["paypal-auth-algo"],
                    "cert_url": lowered["paypal-cert-url"],
                    "transmission_id": lowered["paypal-transmission-id"],
                    "transmission_sig": lowered["paypal-transmission-sig"],
                    "transmission_time": lowered["paypal-transmission-time"],
                    "webhook_id": webhook_id,
                    "webhook_event": event_body,
                },
            )
    except PayPalError as exc:
        logger.error(f"PayPal signature verification could not authenticate: {exc}")
        return False
    except Exception as exc:
        logger.error(f"PayPal signature verification failed: {exc}")
        return False

    if response.status_code >= 400:
        logger.error(f"PayPal verify-webhook-signature returned {response.status_code}")
        return False
    return response.json().get("verification_status") == "SUCCESS"


# ======================================================================
# Capture parsing
# ======================================================================


def _first_nonempty(*values: Optional[str]) -> Optional[str]:
    for value in values:
        if value and str(value).strip():
            return str(value).strip()
    return None


def extract_capture(event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Flatten a PAYMENT.CAPTURE.COMPLETED event into the fields we need.

    Returns None for any other event type, so the caller can acknowledge
    deliveries it does not act on without special-casing each one.
    """
    if event.get("event_type") != "PAYMENT.CAPTURE.COMPLETED":
        return None

    resource = event.get("resource") or {}
    amount = resource.get("amount") or {}
    payer = (resource.get("payer") or {}) or (
        (resource.get("supplementary_data") or {}).get("payer") or {}
    )
    payer_name = payer.get("name") or {}

    try:
        value = Decimal(str(amount.get("value", "0")))
    except Exception:
        value = Decimal("0")

    return {
        "capture_id": resource.get("id"),
        "event_id": event.get("id"),
        "amount": value,
        "currency": (amount.get("currency_code") or "USD").upper(),
        # invoice_id is what a department controls when it raises a PayPal
        # invoice; custom_id is what an integrator sets on a Checkout order.
        # Either can carry our order number.
        "invoice_id": _first_nonempty(resource.get("invoice_id")),
        "custom_id": _first_nonempty(resource.get("custom_id")),
        "note": _first_nonempty(
            resource.get("note_to_payee"),
            (resource.get("supplementary_data") or {}).get("note"),
        ),
        "payer_email": _first_nonempty(payer.get("email_address")),
        "payer_name": _first_nonempty(
            " ".join(
                part
                for part in (
                    payer_name.get("given_name"),
                    payer_name.get("surname"),
                )
                if part
            )
        ),
        "created_at": resource.get("create_time"),
    }


# ======================================================================
# Reconciliation backfill (SF-backfill)
# ======================================================================
#
# The webhook is the primary path. When PayPal's verify API is unreachable the
# webhook answers 401, PayPal eventually stops retrying, and the capture never
# reaches the ledger. The backfill finds those captures again.
#
# Two calls, deliberately. Transaction Search only *discovers* candidate ids —
# it is the one API that lists what the account received, but it lags by hours
# and describes a transaction rather than a capture. Each candidate is then
# re-read from the Payments API's capture endpoint, the same object a
# PAYMENT.CAPTURE.COMPLETED webhook carries as its ``resource``, and only a
# capture that endpoint reports COMPLETED is recorded. So the amount, currency
# and the references an order is matched on come from the same source, in the
# same shape, as a verified webhook — the backfill cannot settle an order on
# anything the webhook would not have.

# Transaction Search pages are bounded so one run cannot stall the scheduler
# on a high-volume account; anything beyond is picked up by the next run while
# it is still inside the lookback window.
_SEARCH_PAGE_SIZE = 100
_SEARCH_MAX_PAGES = 20
# Transaction status "S" is PayPal's "successful" — pending, denied and
# reversed transactions have nothing to reconcile.
_SEARCH_SUCCESS_STATUS = "S"


def _paypal_timestamp(moment: datetime) -> str:
    """The ISO 8601 form Transaction Search accepts (offset, no microseconds)."""
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S%z")


def _search_entry(detail: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """One Transaction Search row as a candidate, or None if it is not one.

    Outgoing money (a negative amount — a refund the department issued, a
    payout) is never a payment to reconcile.
    """
    info = detail.get("transaction_info") or {}
    transaction_id = _first_nonempty(info.get("transaction_id"))
    if not transaction_id:
        return None
    try:
        value = Decimal(str((info.get("transaction_amount") or {}).get("value", "0")))
    except Exception:
        return None
    if value <= 0:
        return None
    payer = detail.get("payer_info") or {}
    payer_name = payer.get("payer_name") or {}
    return {
        "transaction_id": transaction_id,
        "payer_email": _first_nonempty(payer.get("email_address")),
        "payer_name": _first_nonempty(
            payer_name.get("alternate_full_name"),
            " ".join(
                part
                for part in (payer_name.get("given_name"), payer_name.get("surname"))
                if part
            ),
        ),
    }


async def search_incoming_transactions(
    base_url: str,
    token: str,
    start: datetime,
    end: datetime,
) -> List[Dict[str, Any]]:
    """List successful incoming transactions between ``start`` and ``end``.

    Returns ``[{"transaction_id", "payer_email", "payer_name"}]``. Raises
    PayPalError when the account has not granted the Transaction Search
    permission, so the caller can say so instead of reporting nothing found.
    """
    found: List[Dict[str, Any]] = []
    async with create_integration_client(timeout=_TIMEOUT) as client:
        for page in range(1, _SEARCH_MAX_PAGES + 1):
            response = await client.get(
                f"{base_url}/v1/reporting/transactions",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/json",
                },
                params={
                    "start_date": _paypal_timestamp(start),
                    "end_date": _paypal_timestamp(end),
                    "transaction_status": _SEARCH_SUCCESS_STATUS,
                    "fields": "transaction_info,payer_info",
                    "page_size": str(_SEARCH_PAGE_SIZE),
                    "page": str(page),
                },
            )
            if response.status_code in (401, 403):
                raise PayPalError(
                    "PayPal refused Transaction Search for this account. Enable "
                    "the Transaction Search permission on the PayPal REST app so "
                    "missed payments can be recovered."
                )
            if response.status_code >= 400:
                raise PayPalError(
                    f"PayPal returned {response.status_code} searching transactions"
                )
            body = response.json() or {}
            for detail in body.get("transaction_details") or []:
                entry = _search_entry(detail)
                if entry is not None:
                    found.append(entry)
            if page >= int(body.get("total_pages") or 1):
                return found
    logger.warning(
        "PayPal Transaction Search hit the {}-page bound; the rest is left for "
        "the next run",
        _SEARCH_MAX_PAGES,
    )
    return found


async def fetch_completed_capture(
    base_url: str, token: str, capture_id: str
) -> Optional[Dict[str, Any]]:
    """Re-read one capture from the Payments API; None unless COMPLETED.

    A transaction id that is not a capture (PayPal lists more than captures)
    answers 404 and is skipped. A refunded or reversed capture is skipped too:
    the webhook records only PAYMENT.CAPTURE.COMPLETED, and the backfill must
    not record money the department no longer holds.
    """
    async with create_integration_client(timeout=_TIMEOUT) as client:
        response = await client.get(
            f"{base_url}/v2/payments/captures/{quote(capture_id, safe='')}",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
            },
        )
    if response.status_code == 404:
        return None
    if response.status_code >= 400:
        raise PayPalError(f"PayPal returned {response.status_code} reading a capture")
    capture = response.json() or {}
    if capture.get("status") != "COMPLETED" or capture.get("id") != capture_id:
        return None
    return capture

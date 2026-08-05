"""
PayPal Integration Service

Reconciliation only — this application never takes a payment. A department
connects its own PayPal *Business* account; PayPal then tells us what it
received, and we match those captures against store orders.

Why webhooks rather than polling: a capture notification arrives seconds after
the member pays, which is what makes "mark paid" disappear from the
quartermaster's queue on its own. The Transaction Search API would also work
but lags by up to several hours and needs an extra account permission.

Signature verification is delegated to PayPal's own
``/v1/notifications/verify-webhook-signature`` endpoint rather than validating
the certificate chain locally. That is the vendor-supported path: it keys the
check on the webhook id the department configured, and it cannot be fooled by a
forged ``PAYPAL-CERT-URL`` header the way a hand-rolled verifier can.
"""

from decimal import Decimal
from typing import Any, Dict, Mapping, Optional, Tuple

import httpx
from loguru import logger

from app.models.integration import Integration

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

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
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
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
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

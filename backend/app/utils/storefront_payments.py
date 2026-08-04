"""
Storefront payment-link helpers.

Venmo and PayPal are settled out-of-band for volunteer departments (no
merchant API), so what the store can do is hand the member a *prefilled deep
link* and a reference string, then let a quartermaster reconcile the receipt.
These helpers build those links.

Security note: the resulting URL is rendered as an anchor in a member-facing
page **and** in outbound email. The handles behind it are typed by an
administrator, so the URL builders here are strict allowlists — a stored
``javascript:`` or attacker-controlled host must never reach a member's inbox.
"""

import re
from decimal import Decimal
from typing import Optional
from urllib.parse import quote, urlparse

# Venmo usernames are 5-30 chars of letters, digits, dashes and underscores.
_VENMO_HANDLE_RE = re.compile(r"^[A-Za-z0-9_-]{3,30}$")
_PAYPAL_HOSTS = {"paypal.me", "www.paypal.me"}
_PAYPAL_SLUG_RE = re.compile(r"^[A-Za-z0-9]{1,40}$")


def _format_amount(amount: Optional[Decimal]) -> Optional[str]:
    """Render a positive amount as a bare ``12.34`` string, else None."""
    if amount is None:
        return None
    try:
        value = Decimal(amount)
    except (TypeError, ValueError):
        return None
    if value <= 0:
        return None
    return f"{value.quantize(Decimal('0.01')):f}"


def normalize_venmo_handle(handle: Optional[str]) -> Optional[str]:
    """Return a bare, syntactically valid Venmo handle, or None."""
    if not handle:
        return None
    cleaned = handle.strip().lstrip("@")
    if not _VENMO_HANDLE_RE.match(cleaned):
        return None
    return cleaned


def build_venmo_url(
    handle: Optional[str],
    amount: Optional[Decimal] = None,
    note: Optional[str] = None,
) -> Optional[str]:
    """Build a Venmo deep link that opens prefilled to pay the department.

    Returns None when the handle is missing or malformed rather than emitting a
    half-built link that would 404 for the member.
    """
    normalized = normalize_venmo_handle(handle)
    if not normalized:
        return None

    url = f"https://venmo.com/{quote(normalized)}?txn=pay"
    formatted = _format_amount(amount)
    if formatted:
        url += f"&amount={formatted}"
    if note:
        url += f"&note={quote(note, safe='')}"
    return url


def normalize_paypal_me(value: Optional[str]) -> Optional[str]:
    """Accept a paypal.me URL or a bare slug; return a canonical https URL.

    Anything that is not an https paypal.me link (or a plain alphanumeric
    slug) is rejected — administrators occasionally paste a full checkout URL
    or, in the worst case, something hostile.
    """
    if not value:
        return None
    candidate = value.strip()
    if not candidate:
        return None

    if "/" not in candidate and ":" not in candidate:
        slug = candidate.lstrip("@")
        return f"https://paypal.me/{slug}" if _PAYPAL_SLUG_RE.match(slug) else None

    parsed = urlparse(candidate if "//" in candidate else f"https://{candidate}")
    if parsed.scheme not in ("http", "https"):
        return None
    if (parsed.hostname or "").lower() not in _PAYPAL_HOSTS:
        return None
    slug = parsed.path.strip("/").split("/")[0]
    if not _PAYPAL_SLUG_RE.match(slug):
        return None
    return f"https://paypal.me/{slug}"


def build_paypal_url(
    paypal_me: Optional[str],
    amount: Optional[Decimal] = None,
) -> Optional[str]:
    """Build a PayPal.Me link, appending the amount when one is known."""
    base = normalize_paypal_me(paypal_me)
    if not base:
        return None
    formatted = _format_amount(amount)
    return f"{base}/{formatted}" if formatted else base

"""
Storefront payment-link helpers.

Venmo, Cash App and Zelle are settled out-of-band for volunteer departments
(no merchant API), so what the store can do is hand the member a *prefilled
deep link* and a reference string, then let a quartermaster reconcile the
receipt. These helpers build those links.

Zelle is the exception with no link at all: it lives inside each bank's own
app and publishes no web or deep-link scheme, so the most a member can be
given is the department's registered handle to type in. That is why
``normalize_zelle_handle`` returns a handle rather than a URL — inventing a
zelle.com link would send members to a page that cannot pay anybody.

Security note: the resulting URL is rendered as an anchor in a member-facing
page **and** in outbound email. The handles behind it are typed by an
administrator, so the URL builders here are strict allowlists — a stored
``javascript:`` or attacker-controlled host must never reach a member's inbox.
"""

import re
from decimal import Decimal
from typing import Any, Dict, List, Optional, Set
from urllib.parse import quote, urlparse

from app.models.storefront import StorePaymentMethod, StoreSettings

# Venmo usernames are 5-30 chars of letters, digits, dashes and underscores.
_VENMO_HANDLE_RE = re.compile(r"^[A-Za-z0-9_-]{3,30}$")
_PAYPAL_HOSTS = {"paypal.me", "www.paypal.me"}
_PAYPAL_SLUG_RE = re.compile(r"^[A-Za-z0-9]{1,40}$")
# Cash App $cashtags are 1-20 chars, must start with a letter, and are
# case-insensitive letters/digits/underscores after that.
_CASHTAG_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,19}$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s.]+\.[^@\s]+$")


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


def normalize_cashtag(value: Optional[str]) -> Optional[str]:
    """Return a bare, syntactically valid Cash App $cashtag, or None.

    Accepts what an administrator is likely to paste: ``$dept``, ``dept``, or
    a full ``cash.app/$dept`` URL.
    """
    if not value:
        return None
    candidate = value.strip()
    if not candidate:
        return None

    if "/" in candidate or ":" in candidate:
        parsed = urlparse(candidate if "//" in candidate else f"https://{candidate}")
        if (parsed.hostname or "").lower() not in ("cash.app", "www.cash.app"):
            return None
        candidate = parsed.path.strip("/").split("/")[0]

    cleaned = candidate.lstrip("$")
    return cleaned if _CASHTAG_RE.match(cleaned) else None


def build_cash_app_url(
    cashtag: Optional[str],
    amount: Optional[Decimal] = None,
) -> Optional[str]:
    """Build a Cash App link, appending the amount when one is known.

    Cash App takes the amount as a path segment rather than a query parameter,
    and carries no note field — the member has to type the order number, which
    is why the reference is always shown next to the button.
    """
    normalized = normalize_cashtag(cashtag)
    if not normalized:
        return None
    formatted = _format_amount(amount)
    base = f"https://cash.app/${quote(normalized)}"
    return f"{base}/{formatted}" if formatted else base


def normalize_zelle_handle(value: Optional[str]) -> Optional[str]:
    """Return a Zelle handle (email or US phone) in a displayable form, or None.

    Zelle registers against an email address or a mobile number. Phone numbers
    are normalized to a plain 10-digit string so a member reading it off a
    screen types the same thing regardless of how the administrator entered it.
    """
    if not value:
        return None
    candidate = value.strip()
    if not candidate:
        return None

    if _EMAIL_RE.match(candidate):
        return candidate.lower()

    digits = re.sub(r"\D", "", candidate)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10:
        return None
    return f"({digits[0:3]}) {digits[3:6]}-{digits[6:]}"


def build_payment_option(
    method: StorePaymentMethod,
    settings: StoreSettings,
    balance: Decimal,
    reference: str,
) -> Optional[Dict[str, Any]]:
    """Describe one way to settle, or None when it is not configured.

    Returning None for an unconfigured method is what keeps a dead button
    off the member's screen: a department that lists Venmo but never enters
    a handle would otherwise show a link that goes nowhere.
    """
    if method == StorePaymentMethod.VENMO:
        url = build_venmo_url(settings.venmo_handle, balance, reference)
        if not url:
            return None
        return {
            "method": method.value,
            "label": "Venmo",
            "handle": f"@{normalize_venmo_handle(settings.venmo_handle)}",
            "payment_url": url,
            "instructions": None,
            # Venmo carries our note through, so the member does not have
            # to remember to type the order number.
            "prefills_reference": True,
        }

    if method == StorePaymentMethod.PAYPAL:
        url = build_paypal_url(settings.paypal_me_url, balance)
        handle = normalize_paypal_me(settings.paypal_me_url) or settings.paypal_email
        if not url and not handle:
            return None
        return {
            "method": method.value,
            "label": "PayPal",
            "handle": handle,
            "payment_url": url,
            "instructions": None,
            "prefills_reference": False,
        }

    if method == StorePaymentMethod.CASH_APP:
        url = build_cash_app_url(settings.cash_app_cashtag, balance)
        if not url:
            return None
        return {
            "method": method.value,
            "label": "Cash App",
            "handle": f"${normalize_cashtag(settings.cash_app_cashtag)}",
            "payment_url": url,
            "instructions": None,
            "prefills_reference": False,
        }

    if method == StorePaymentMethod.ZELLE:
        handle = normalize_zelle_handle(settings.zelle_handle)
        if not handle:
            return None
        return {
            "method": method.value,
            "label": "Zelle",
            "handle": handle,
            # Zelle runs inside each bank's own app and publishes no
            # deep-link scheme, so there is nothing to link to.
            "payment_url": None,
            "instructions": settings.zelle_instructions,
            "prefills_reference": False,
        }

    if method == StorePaymentMethod.CHECK:
        return {
            "method": method.value,
            "label": "Check",
            "handle": settings.check_payable_to,
            "payment_url": None,
            "instructions": settings.check_mailing_address,
            "prefills_reference": False,
        }

    if method == StorePaymentMethod.CASH:
        return {
            "method": method.value,
            "label": "Cash",
            "handle": None,
            "payment_url": None,
            "instructions": settings.cash_instructions,
            "prefills_reference": False,
        }

    if method == StorePaymentMethod.PAYROLL_DEDUCTION:
        return {
            "method": method.value,
            "label": "Payroll deduction",
            "handle": None,
            "payment_url": None,
            "instructions": settings.payroll_deduction_instructions,
            "prefills_reference": False,
        }

    if method == StorePaymentMethod.OTHER:
        return {
            "method": method.value,
            "label": "Other",
            "handle": None,
            "payment_url": None,
            "instructions": settings.other_payment_instructions,
            "prefills_reference": False,
        }

    return None


def build_payment_options(
    settings: StoreSettings, balance: Decimal, reference: str
) -> List[Dict[str, Any]]:
    """Every configured way to settle, in the order the department listed.

    A member who picked Venmo at checkout and then found the department had
    also enabled Cash App should not have to place the order again to use
    it — the money only has to arrive, and by what route is the member's
    business.
    """
    accepted = settings.accepted_payment_methods or []
    options: List[Dict[str, Any]] = []
    seen: Set[StorePaymentMethod] = set()
    for raw in accepted:
        try:
            method = StorePaymentMethod(str(raw).lower())
        except ValueError:
            # A method removed from the enum should not break the store.
            continue
        if method in seen:
            continue
        seen.add(method)
        option = build_payment_option(method, settings, balance, reference)
        if option:
            options.append(option)
    return options

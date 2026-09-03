"""
The personal-information boundary.

Every tool result passes through ``redact()`` before it leaves the process.
Tools already project explicit allowlists of fields; this is the second net,
so that a field added to a model or a service response later cannot leak
through a tool nobody remembered to update. It works by key name at every
depth of the result, which is what makes it enforceable by a test rather
than by review: ``tests/test_mcp_redaction.py`` asserts each name below is
stripped wherever it appears, and that no tool module mentions one.

What is denied, and why:

* contact details — work and personal email, phone and mobile, fax, home
  address. The department decided (2026-09-03) that even the work email
  stays out, so a member's inbox is never reachable through an assistant.
* identity and life details — date of birth, photo, emergency contacts,
  membership number, certification numbers, login username, OAuth subject.
* medical content — provider, result summary, raw result data. The
  medical-screening switch exposes compliance *status* only.
* credentials and tokens — anything ending in ``_hash``, ``_secret``,
  ``_token`` or ``_password``, MFA material, reset tokens.
* recipients and telemetry — attendee/recipient email lists, IP address,
  user agent, a member's own notification and visibility preferences.

Field names are one half. Free-text values are the other: every string in
a result is scrubbed of email addresses and phone numbers, since a note or
a document body can carry either however its field is named.
"""

import re
from typing import Any, Iterable, Optional

DENIED_FIELDS: frozenset[str] = frozenset(
    {
        # Contact
        "email",
        "personal_email",
        "user_email",
        "phone",
        "mobile",
        "fax",
        "address",
        "home_address",
        "address_street",
        "address_line1",
        "address_line2",
        "address_city",
        "address_state",
        "address_zip",
        "address_country",
        # Identity and life details
        "date_of_birth",
        "dob",
        "birth_date",
        "photo_url",
        "emergency_contacts",
        "emergency_contact",
        "next_of_kin",
        "membership_number",
        "previous_membership_number",
        "certification_number",
        "username",
        "oauth_subject",
        "oauth_provider",
        "ssn",
        "social_security_number",
        "drivers_license",
        "drivers_license_number",
        "referral_source",
        "interest_reason",
        # Medical content
        "provider_name",
        "result_summary",
        "result_data",
        "medical_conditions",
        "medications",
        "allergies",
        "blood_type",
        # Credentials
        "password",
        "password_hash",
        "mfa_secret",
        "mfa_backup_codes",
        "password_reset_token",
        "calendar_feed_token",
        "key_hash",
        # Recipients and telemetry
        "attendee_emails",
        "email_recipients",
        "recipient_emails",
        "ip_address",
        "user_agent",
        "notification_preferences",
        "profile_visibility",
        "dietary_restrictions",
        "accessibility_needs",
    }
)

# A key that ends with one of these is a credential whatever its prefix.
DENIED_SUFFIXES: tuple[str, ...] = ("_hash", "_secret", "_token", "_password")

# A key that starts with one of these belongs to a home address or an
# emergency contact however the rest of it is spelled.
DENIED_PREFIXES: tuple[str, ...] = ("emergency_", "address_", "home_address")


def is_denied_field(name: str) -> bool:
    key = name.lower()
    if key in DENIED_FIELDS:
        return True
    if key.endswith(DENIED_SUFFIXES):
        return True
    return key.startswith(DENIED_PREFIXES)


# Free text — a description, a note, a document body — can carry contact
# details someone typed in. Field names cannot catch those, so string values
# are scrubbed for the two shapes that are recognisable on their own: email
# addresses and phone numbers. Anything else in free text (a street address
# written out, a diagnosis) is not detectable and is why only *published*
# content is exposed at all.
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
# A phone number written the way people write them: international with a
# country code, North American with an area code, or a local seven-digit
# number, with groups separated by spaces, dots, dashes, slashes or
# parentheses (020/7946/0958 is a common European spelling).
# Requiring the separators is deliberate — a bare run of digits is as likely
# to be a serial number or an asset tag as a phone number.
_PHONE_FORMATTED_RE = re.compile(
    r"(?<![\w-])(?:"
    # International: a country code then two to four separated groups
    # (+44 20 7946 0958, +1 555 123 4567, +49 30 1234567).
    r"\+\d{1,3}(?:[\s./-]?\d{2,5}){2,4}"
    r"|"
    # North American with area code: (555) 123-4567, 555-123-4567,
    # 555.123.4567, optional leading 1.
    r"(?:1[\s./-])?(?:\(\d{3}\)\s?|\d{3}[\s./-])\d{3}[\s./-]\d{4}"
    r"|"
    # Local seven-digit: 555-0100, 555.0100 (separator required).
    r"\d{3}[.-]\d{4}"
    r")(?![\w-])"
)
# National formats without a country code, which is how most of the world
# writes its own numbers: three to five separated groups (020 7946 0958,
# 912 34 567, 01 23 45 67 89), or a leading-zero trunk prefix followed by
# the subscriber number (020 79460958). The grouped form is checked by
# ``_is_national_phone`` so that a date written with separators or a figure
# grouped in thousands is left alone.
_PHONE_NATIONAL_GROUPED_RE = re.compile(
    r"(?<![\w-])\(?\d{2,5}\)?(?:[\s./-]\d{2,5}){2,4}(?![\w-])"
)
_PHONE_NATIONAL_TRUNK_RE = re.compile(r"(?<![\w-])0\d{1,4}[\s./-]\d{6,9}(?![\w-])")
_DATE_SHAPES = (
    re.compile(r"\d{1,2}[\s./-]\d{1,2}[\s./-]\d{4}"),
    re.compile(r"\d{4}[\s./-]\d{1,2}[\s./-]\d{1,2}"),
)


def _is_national_phone(match: "re.Match[str]") -> bool:
    raw = match.group(0)
    digits = sum(ch.isdigit() for ch in raw)
    if not 8 <= digits <= 15:
        return False
    if any(shape.fullmatch(raw) for shape in _DATE_SHAPES):
        return False
    # 10 000 000 or 1 500 000: a figure grouped in thousands, not a number
    # to dial. Only a one- or two-digit leading group counts as a figure —
    # a nine-digit 612 345 678 is how several countries write a phone
    # number, and a leading group of three or more is treated as one.
    groups = re.split(r"[\s./-]", raw.strip("()"))
    if len(groups) > 1 and len(groups[0]) <= 2 and all(len(g) == 3 for g in groups[1:]):
        return False
    return True


def _scrub_national(text: str) -> str:
    text = _PHONE_NATIONAL_GROUPED_RE.sub(
        lambda m: PHONE_PLACEHOLDER if _is_national_phone(m) else m.group(0), text
    )
    return _PHONE_NATIONAL_TRUNK_RE.sub(PHONE_PLACEHOLDER, text)


# Bare runs: seven to eleven digits — a local number, an eight- or
# nine-digit national number (91234567), or an area code and number with
# or without the leading 1. Six digits or fewer is a date, a count or a
# code far more often than a phone number; twelve or more is a barcode or
# an order number.
_PHONE_BARE_RE = re.compile(r"(?<![\w-])\+?\d{7,11}(?![\w-])")
EMAIL_PLACEHOLDER = "[email removed]"
PHONE_PLACEHOLDER = "[phone removed]"

# Fields whose value is an identifier by definition — an asset tag, a
# serial number, a barcode — where a ten-digit run *is* the value rather
# than a phone number typed into prose. Only these keep a bare run; every
# other string, including a free-text field whose whole value is the
# number and any string with no field name at all, has it scrubbed. The
# decision is made by field, never by the shape of the value, because
# "5551234567" alone looks the same in a description and in a barcode.
IDENTIFIER_FIELDS: frozenset[str] = frozenset(
    {
        "id",
        "asset_tag",
        "serial_number",
        "barcode",
        "sku",
        "upc",
        "vin",
        "key_prefix",
        "purchase_order",
        "license_plate",
    }
)
IDENTIFIER_SUFFIXES: tuple[str, ...] = ("_id", "_number", "_code", "_tag", "_sku")


def is_identifier_field(name: str) -> bool:
    key = name.lower()
    return key in IDENTIFIER_FIELDS or key.endswith(IDENTIFIER_SUFFIXES)


def scrub_text(text: str, *, identifier: bool = False) -> str:
    """Replace email addresses and phone numbers inside free text.

    ``identifier`` says the value came from an identifier field (see
    ``IDENTIFIER_FIELDS``); a bare digit run is then left alone. Formatted
    numbers and email addresses are replaced either way.
    """
    if "@" in text:
        text = _EMAIL_RE.sub(EMAIL_PLACEHOLDER, text)
    if any(ch.isdigit() for ch in text):
        text = _PHONE_FORMATTED_RE.sub(PHONE_PLACEHOLDER, text)
        text = _scrub_national(text)
        if not identifier:
            text = _PHONE_BARE_RE.sub(PHONE_PLACEHOLDER, text)
    return text


def redact(value: Any) -> Any:
    """Return ``value`` with every denied key removed at every depth and
    every string value scrubbed of email addresses and phone numbers.

    Dicts lose denied keys; lists, tuples and sets are walked; strings are
    scrubbed; everything else is returned as-is. Dict keys that are not
    strings are kept.
    """
    return _redact(value, None)


def _redact(value: Any, field: Optional[str]) -> Any:
    if isinstance(value, dict):
        return {
            key: _redact(inner, key if isinstance(key, str) else None)
            for key, inner in value.items()
            if not (isinstance(key, str) and is_denied_field(key))
        }
    if isinstance(value, (list, tuple, set, frozenset)):
        # An element of a list has no field name, so it is prose.
        return [_redact(inner, None) for inner in value]
    if isinstance(value, str):
        return scrub_text(
            value, identifier=field is not None and is_identifier_field(field)
        )
    return value


def denied_fields_in(names: Iterable[str]) -> list[str]:
    """The subset of ``names`` the boundary would strip — for tests."""
    return sorted({n for n in names if is_denied_field(n)})

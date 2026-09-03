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
from typing import Any, Iterable

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
# A phone number written the way people write them: groups separated by
# spaces, dots, dashes or parentheses, optional country code. Requiring the
# separators is deliberate — a bare run of digits is as likely to be a
# serial number or an asset tag as a phone number.
_PHONE_FORMATTED_RE = re.compile(
    r"(?<![\w-])(?:\+?\d{1,3}[\s.-])?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?![\w-])"
)
# A bare ten- or eleven-digit run is scrubbed only inside prose (a string
# with whitespace), where "call 5551234567" is a phone number and a lone
# "5551234567" in an asset-tag field is not.
_PHONE_BARE_RE = re.compile(r"(?<![\w-])\+?\d{10,11}(?![\w-])")
EMAIL_PLACEHOLDER = "[email removed]"
PHONE_PLACEHOLDER = "[phone removed]"


def scrub_text(text: str) -> str:
    """Replace email addresses and phone numbers inside free text."""
    if "@" in text:
        text = _EMAIL_RE.sub(EMAIL_PLACEHOLDER, text)
    if any(ch.isdigit() for ch in text):
        text = _PHONE_FORMATTED_RE.sub(PHONE_PLACEHOLDER, text)
        if any(ch.isspace() for ch in text):
            text = _PHONE_BARE_RE.sub(PHONE_PLACEHOLDER, text)
    return text


def redact(value: Any) -> Any:
    """Return ``value`` with every denied key removed at every depth and
    every string value scrubbed of email addresses and phone numbers.

    Dicts lose denied keys; lists, tuples and sets are walked; strings are
    scrubbed; everything else is returned as-is. Dict keys that are not
    strings are kept.
    """
    if isinstance(value, dict):
        return {
            key: redact(inner)
            for key, inner in value.items()
            if not (isinstance(key, str) and is_denied_field(key))
        }
    if isinstance(value, (list, tuple, set, frozenset)):
        return [redact(inner) for inner in value]
    if isinstance(value, str):
        return scrub_text(value)
    return value


def denied_fields_in(names: Iterable[str]) -> list[str]:
    """The subset of ``names`` the boundary would strip — for tests."""
    return sorted({n for n in names if is_denied_field(n)})

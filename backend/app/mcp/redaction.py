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
"""

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


def redact(value: Any) -> Any:
    """Return ``value`` with every denied key removed at every depth.

    Dicts lose denied keys; lists, tuples and sets are walked; everything
    else is returned as-is. Dict keys that are not strings are kept.
    """
    if isinstance(value, dict):
        return {
            key: redact(inner)
            for key, inner in value.items()
            if not (isinstance(key, str) and is_denied_field(key))
        }
    if isinstance(value, (list, tuple, set, frozenset)):
        return [redact(inner) for inner in value]
    return value


def denied_fields_in(names: Iterable[str]) -> list[str]:
    """The subset of ``names`` the boundary would strip — for tests."""
    return sorted({n for n in names if is_denied_field(n)})

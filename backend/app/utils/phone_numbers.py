"""
What a member's phone or mobile number may look like (W04-7).

Lenient on purpose: digits, a leading ``+``, spaces, dashes, dots and
parentheses, and an extension written ``ext 12``, ``ext. 12``, ``x12`` or
``#12``. Seven to fifteen digits before the extension — short enough for a
local number, long enough for E.164. That accepts "(703) 555-0101",
"+1 703 555 0101" and "703.555.0101 ext 4", and refuses "call me maybe".

Strict E.164 was considered and declined: it refuses extensions, which
members at a desk line use, and the formatting nearly every stored value
already has.

Applied to **new writes only**. A save that sends back the value already
stored is accepted unchanged, so a member whose number predates this rule can
still save the rest of their profile; they meet the rule when they change the
number.
"""

import re
from typing import Optional

_EXTENSION = re.compile(r"\s*(?:ext\.?|x|#)\s*\d{1,6}\s*$", re.IGNORECASE)
_NUMBER_BODY = re.compile(r"^\+?[\d\s\-.()]+$")
MIN_DIGITS = 7
MAX_DIGITS = 15

INVALID_PHONE_MESSAGE = (
    "Enter a phone number using digits, spaces, dashes or parentheses, with an "
    "optional leading + and extension (for example 703-555-0101 ext 4)."
)


def _digits(value: str) -> int:
    return sum(ch.isdigit() for ch in value)


def is_valid_member_phone(value: str) -> bool:
    body = _EXTENSION.sub("", value.strip())
    if not body or not _NUMBER_BODY.match(body):
        return False
    # A "+" only leads; "+1 (703)" is a number, "703+555" is not.
    if "+" in body[1:]:
        return False
    return MIN_DIGITS <= _digits(body) <= MAX_DIGITS


def validate_member_phone(
    value: Optional[str], stored: Optional[str] = None
) -> Optional[str]:
    """Return the cleaned value to store, or raise ``ValueError``.

    Blank clears the number (``None``). A value equal to what is already
    stored passes untouched — new writes only (see the module docstring).
    """
    cleaned = (value or "").strip()
    if not cleaned:
        return None
    if stored is not None and cleaned == stored.strip():
        return stored
    if not is_valid_member_phone(cleaned):
        raise ValueError(INVALID_PHONE_MESSAGE)
    return cleaned

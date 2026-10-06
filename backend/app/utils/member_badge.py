"""
Member badge codes.

A printed or on-screen member badge used to carry the membership number, or a
short form of the member's id — both of which every member can read off the
directory, so anyone could print a working copy of a colleague's badge. A
badge now carries a random code the server issues and keeps, which cannot be
derived from anything a member can see, and which an officer can reissue to
cancel a lost badge.

Codes look like ``MB-7KQ2W9HXRT``: a fixed prefix, so a scanner (and a person
reading the printed digits) can tell a badge from an asset tag, then ten
characters from an alphabet without the look-alikes 0/O, 1/I/L and U/V. Twenty-nine
symbols to the tenth power is about 4.2e14 codes per organization — guessing
one through an authenticated, rate-limited lookup is not a practical attack.
"""

import json
import secrets
from typing import Optional

BADGE_CODE_PREFIX = "MB-"
BADGE_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTWXYZ"
BADGE_CODE_RANDOM_LENGTH = 10
BADGE_CODE_LENGTH = len(BADGE_CODE_PREFIX) + BADGE_CODE_RANDOM_LENGTH

# The legacy short id: the member's UUID without dashes, first twelve
# characters, upper-cased. Printed on badges for members with no membership
# number before badge codes existed; still accepted while the department
# allows old badges.
LEGACY_SHORT_ID_LENGTH = 12

# A scanner hands over whatever the symbol held. Anything longer than this is
# not a badge from this system, and is refused before it reaches a query.
MAX_SCANNED_LENGTH = 512


def generate_badge_code() -> str:
    return BADGE_CODE_PREFIX + "".join(
        secrets.choice(BADGE_CODE_ALPHABET) for _ in range(BADGE_CODE_RANDOM_LENGTH)
    )


def normalize_scanned_code(raw: str) -> str:
    """The scanned value trimmed and upper-cased.

    Keyboard-wedge scanners add trailing whitespace or a carriage return, and
    a person typing a code from a damaged badge may use lower case.
    """
    return raw.strip().upper()


def is_badge_code(code: str) -> bool:
    """Whether *code* (already normalized) has the shape of an issued code."""
    if len(code) != BADGE_CODE_LENGTH or not code.startswith(BADGE_CODE_PREFIX):
        return False
    return all(ch in BADGE_CODE_ALPHABET for ch in code[len(BADGE_CODE_PREFIX) :])


def legacy_short_id(user_id: str) -> str:
    return user_id.replace("-", "")[:LEGACY_SHORT_ID_LENGTH].upper()


def legacy_qr_member_id(raw: str) -> Optional[str]:
    """The member id from a legacy digital-card QR, or ``None``.

    The old card encoded ``{"type": "member_id", "id": ...}`` built in the
    browser, so the id in it is a claim, never proof; the caller still has to
    find that member in its own organization.
    """
    try:
        payload = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(payload, dict) or payload.get("type") != "member_id":
        return None
    member_id = payload.get("id")
    return member_id if isinstance(member_id, str) and member_id else None

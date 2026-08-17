"""
Breached-password detection via the Have I Been Pwned range API.

Complexity rules (length, character classes, no sequences) say nothing about
whether a password has already appeared in a public breach corpus, and the
hardcoded ``common_passwords`` list in ``validate_password_strength`` covers only
a few dozen of the hundreds of millions that have. ``Firetruck2024!`` satisfies
every complexity rule the platform enforces and appears in breach corpora — it
is exactly the kind of password a station full of people picks, and exactly what
credential stuffing tries first.

**k-anonymity — what actually leaves the process.** The password is hashed with
SHA-1 locally and only the first **five hex characters** of that hash are sent.
The API answers with every suffix sharing that prefix (~400-800 hashes) and the
match is made here, in memory. The provider never sees the password, its full
hash, or which of the returned suffixes was the one being asked about. SHA-1 is
correct here despite being broken for collision resistance: it is the corpus's
index, not a password-storage decision, and a preimage attack on a value that is
never transmitted buys an attacker nothing.

**Fail-open, deliberately.** If the provider is unreachable, times out, or
answers with anything unparseable, the password is accepted. This is a
supplementary control layered on top of complexity rules, password history, MFA,
and lockout; a third-party outage must not lock every member of a fire
department out of setting a password during an incident. The failure is logged
so operators can alert on degraded enforcement.

Disabled by default (``BREACHED_PASSWORD_CHECK_ENABLED``) since it requires
outbound network access some deployments do not permit.
"""

import hashlib

import httpx
from loguru import logger

from app.core.config import settings


def _hash_prefix_and_suffix(password: str) -> tuple[str, str]:
    """Return the (5-char prefix, remaining suffix) of the password's SHA-1.

    Uppercase hex throughout: the API returns uppercase suffixes and the
    comparison below is a plain string match.

    ``usedforsecurity=False`` is accurate, not a way to quiet the linter: this
    SHA-1 is the breach corpus's lookup index, fixed by the provider's API, and
    the digest is never stored, compared against a stored credential, or used to
    authenticate anything. Password storage is bcrypt/Argon2, elsewhere. Marking
    it also keeps the hash usable on FIPS builds, where an unmarked SHA-1 raises.
    """
    digest = hashlib.sha1(password.encode("utf-8"), usedforsecurity=False).hexdigest()
    return digest[:5].upper(), digest[5:].upper()


def _parse_range_response(body: str, suffix: str) -> int:
    """Find *suffix* in a range response and return its breach count.

    The body is one ``SUFFIX:COUNT`` per line. Returns 0 when the suffix is
    absent — that is the "not breached" answer, not an error. Malformed lines
    are skipped rather than failing the whole lookup, since one bad line must
    not turn a real hit elsewhere in the response into a silent pass.
    """
    for line in body.splitlines():
        candidate, _, count = line.strip().partition(":")
        if candidate.upper() != suffix:
            continue
        try:
            return int(count)
        except ValueError:
            logger.warning("Breached-password API returned a non-numeric count")
            return 0
    return 0


async def get_breach_count(password: str) -> int:
    """Return how many times *password* appears in breach corpora.

    Returns 0 both when the password is genuinely absent and when the lookup
    could not be completed (see the fail-open note in the module docstring).
    """
    if not settings.BREACHED_PASSWORD_CHECK_ENABLED:
        return 0
    if not password:
        return 0

    prefix, suffix = _hash_prefix_and_suffix(password)

    try:
        async with httpx.AsyncClient(
            timeout=settings.BREACHED_PASSWORD_TIMEOUT_SECONDS
        ) as client:
            response = await client.get(
                f"{settings.BREACHED_PASSWORD_API_URL.rstrip('/')}/{prefix}",
                headers={
                    # Documented by HIBP; asks the API to pad the response with
                    # decoy hashes so an observer cannot infer anything from the
                    # response size.
                    "Add-Padding": "true",
                    "User-Agent": "TheLogbook-PasswordCheck",
                },
            )
            response.raise_for_status()
            return _parse_range_response(response.text, suffix)
    except Exception as exc:
        # Fail open — never block a password change on a third-party outage.
        logger.warning(f"Breached-password lookup unavailable, allowing: {exc}")
        return 0


async def check_password_not_breached(password: str) -> tuple[bool, str | None]:
    """Validate *password* against breach corpora.

    Returns ``(is_valid, error_message)`` to match the shape of
    ``validate_password_strength`` so call sites can chain the two identically.

    The message deliberately does not report the breach count. A precise count
    tells an attacker who can reach a password-change form how common a
    candidate is — a free oracle over the corpus — and it does not help the
    member, who needs to pick a different password either way.
    """
    count = await get_breach_count(password)
    if count >= settings.BREACHED_PASSWORD_MIN_COUNT and count > 0:
        return False, (
            "This password has appeared in a known data breach and cannot be "
            "used. Please choose a different password."
        )
    return True, None

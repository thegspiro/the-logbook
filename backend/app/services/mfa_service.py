"""
Multi-factor authentication (TOTP) service.

Handles TOTP secret generation, provisioning URIs for authenticator apps,
code verification, and one-time recovery codes. The secret and recovery
codes are stored encrypted on the User model (see User.mfa_secret /
User.mfa_backup_codes properties).
"""

import hashlib
import hmac
import secrets
import time

import pyotp

# Recovery codes: human-friendly, single-use. 10 codes of 10 hex chars.
RECOVERY_CODE_COUNT = 10
_RECOVERY_CODE_BYTES = 5  # 10 hex chars


def generate_secret() -> str:
    """Generate a new base32 TOTP secret."""
    return pyotp.random_base32()


def provisioning_uri(secret: str, account_name: str, issuer: str) -> str:
    """Build the otpauth:// URI an authenticator app encodes as a QR code."""
    return pyotp.TOTP(secret).provisioning_uri(
        name=account_name, issuer_name=issuer
    )


def verify_totp(secret: str, code: str) -> bool:
    """Verify a 6-digit TOTP code, allowing one step of clock drift (±30s)."""
    if not secret or not code:
        return False
    code = code.strip().replace(" ", "")
    if not code.isdigit():
        return False
    return pyotp.TOTP(secret).verify(code, valid_window=1)


def verify_totp_get_timestep(
    secret: str, code: str, *, last_timestep: int | None = None
) -> int | None:
    """Verify a TOTP code and return the matched time-step, or ``None``.

    The time-step is ``unix_time // period`` — a monotonically increasing integer
    that identifies which 30-second window produced the code. Callers persist the
    returned value and pass it back as ``last_timestep`` on the next attempt.

    When ``last_timestep`` is provided, a code whose step is ``<= last_timestep``
    is rejected as a **replay** even if it is otherwise valid. This closes the
    window in which a captured or observed code could be submitted a second time
    while still inside its ±30s validity window. Comparison is constant-time.

    Mirrors ``verify_totp``'s ``valid_window=1`` (one step of clock drift each
    way) so legitimate users with mild clock skew still succeed.
    """
    if not secret or not code:
        return None
    code = code.strip().replace(" ", "")
    if not code.isdigit():
        return None

    totp = pyotp.TOTP(secret)
    period = totp.interval or 30
    current_step = int(time.time()) // period

    for step in (current_step - 1, current_step, current_step + 1):
        candidate = totp.at(step * period)
        if hmac.compare_digest(candidate, code):
            if last_timestep is not None and step <= last_timestep:
                return None  # already-consumed step — treat as replay
            return step
    return None


def generate_recovery_codes(count: int = RECOVERY_CODE_COUNT) -> list[str]:
    """Generate single-use recovery codes (formatted ``xxxxx-xxxxx``)."""
    codes = []
    for _ in range(count):
        raw = secrets.token_hex(_RECOVERY_CODE_BYTES)
        codes.append(f"{raw[:5]}-{raw[5:]}")
    return codes


def normalize_recovery_code(code: str) -> str:
    """Normalize user-entered recovery codes for comparison."""
    return (code or "").strip().lower().replace(" ", "")


def hash_recovery_code(code: str) -> str:
    """Return the SHA-256 hex hash of a normalized recovery code.

    Recovery codes are secrets used only for equality checks, so they are stored
    HASHED (irreversible) rather than reversibly encrypted — a DB read plus the
    encryption key must not yield usable codes.
    """
    return hashlib.sha256(normalize_recovery_code(code).encode()).hexdigest()


def find_matching_recovery_code(
    candidate: str, stored_codes: list[str]
) -> str | None:
    """Return the stored entry matching *candidate*, or None, in constant time.

    Compares against every stored entry without early-exit to avoid leaking, via
    timing, which/whether a code matched. Backward compatible: matches both new
    hashed entries and any legacy plaintext entries written before hashing was
    introduced, so existing users' recovery codes keep working until rotated.
    """
    target_hash = hash_recovery_code(candidate)
    target_norm = normalize_recovery_code(candidate)
    match: str | None = None
    for stored in stored_codes:
        stored_norm = normalize_recovery_code(stored)
        # New scheme: stored_norm is the code's hash. Legacy: stored_norm is the
        # normalized plaintext code. Each entry can only match one branch.
        if hmac.compare_digest(stored_norm, target_hash) or hmac.compare_digest(
            stored_norm, target_norm
        ):
            match = stored
    return match

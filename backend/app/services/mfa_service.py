"""
Multi-factor authentication (TOTP) service.

Handles TOTP secret generation, provisioning URIs for authenticator apps,
code verification, and one-time recovery codes. The secret and recovery
codes are stored encrypted on the User model (see User.mfa_secret /
User.mfa_backup_codes properties).
"""

import secrets

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

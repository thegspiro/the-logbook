"""
Security Utilities

Comprehensive security functions for password hashing, encryption,
and other security-critical operations. Implements security controls
aligned with HIPAA requirements.
"""

import base64
import hashlib
import re
import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHash, VerificationError, VerifyMismatchError
from cryptography.exceptions import InvalidTag
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from loguru import logger

from app.core.config import settings

# ============================================
# Password Hashing (Argon2)
# ============================================

# Argon2 is recommended by OWASP and is resistant to GPU attacks
password_hasher = PasswordHasher(
    time_cost=3,  # Number of iterations
    memory_cost=65536,  # Memory usage in KB (64 MB)
    parallelism=4,  # Number of parallel threads
    hash_len=32,  # Length of the hash in bytes
    salt_len=16,  # Length of the salt in bytes
)


def hash_password(password: str, *, skip_validation: bool = False) -> str:
    """
    Hash a password using Argon2id

    SECURITY: Argon2id is the winner of the Password Hashing Competition
    and provides resistance against both side-channel and GPU attacks.

    Args:
        password: Plain text password
        skip_validation: If True, skip password strength validation.
            Used for admin-generated temporary passwords that may not
            meet user-facing complexity requirements.

    Returns:
        Hashed password string

    Raises:
        ValueError: If password doesn't meet complexity requirements
    """
    if not skip_validation:
        is_valid, error_msg = validate_password_strength(password)
        if not is_valid:
            raise ValueError(error_msg)

    # Hash the password
    return password_hasher.hash(password)


def verify_password(password: str, hashed_password: str) -> tuple[bool, str | None]:
    """
    Verify a password against its hash and rehash if parameters have changed.

    Args:
        password: Plain text password to verify
        hashed_password: Previously hashed password

    Returns:
        Tuple of (matches, new_hash) where new_hash is a rehashed password
        if the current hash uses outdated parameters, or None otherwise.
    """
    try:
        password_hasher.verify(hashed_password, password)

        # Rehash if argon2 parameters have changed since this hash was created
        new_hash = None
        if password_hasher.check_needs_rehash(hashed_password):
            new_hash = password_hasher.hash(password)

        return True, new_hash
    except (VerifyMismatchError, VerificationError, InvalidHash):
        return False, None


def validate_password_strength(password: str) -> tuple[bool, str | None]:
    """
    Validate password meets complexity requirements for HIPAA compliance.

    Requirements based on NIST SP 800-63B and HIPAA Security Rule:
    - Minimum length: 12 characters (configurable)
    - At least one uppercase letter
    - At least one lowercase letter
    - At least one number
    - At least one special character
    - Not a common/breached password
    - No sequential characters (e.g., '123', 'abc')
    - No repeated characters (e.g., 'aaa')

    Args:
        password: Password to validate

    Returns:
        Tuple of (is_valid, error_message)
        - is_valid: True if password meets all requirements
        - error_message: None if valid, otherwise description of failures
    """
    errors = []

    # Check maximum length first to prevent DoS via hashing very long inputs
    if len(password) > settings.PASSWORD_MAX_LENGTH:
        errors.append(
            f"Password must be no more than {settings.PASSWORD_MAX_LENGTH} characters long"
        )
        return False, errors[0]

    # Check length
    if len(password) < settings.PASSWORD_MIN_LENGTH:
        errors.append(
            f"Password must be at least {settings.PASSWORD_MIN_LENGTH} characters long"
        )

    # Check uppercase
    if settings.PASSWORD_REQUIRE_UPPERCASE and not re.search(r"[A-Z]", password):
        errors.append("Password must contain at least one uppercase letter")

    # Check lowercase
    if settings.PASSWORD_REQUIRE_LOWERCASE and not re.search(r"[a-z]", password):
        errors.append("Password must contain at least one lowercase letter")

    # Check numbers
    if settings.PASSWORD_REQUIRE_NUMBERS and not re.search(r"\d", password):
        errors.append("Password must contain at least one number")

    # Check special characters
    if settings.PASSWORD_REQUIRE_SPECIAL and not re.search(
        r'[!@#$%^&*()_+\-=\[\]{};\':"\\|,.<>\/?~`]', password
    ):
        errors.append("Password must contain at least one special character")

    # Check for sequential characters (3+ in a row)
    sequential_patterns = [
        "012",
        "123",
        "234",
        "345",
        "456",
        "567",
        "678",
        "789",
        "abc",
        "bcd",
        "cde",
        "def",
        "efg",
        "fgh",
        "ghi",
        "hij",
        "ijk",
        "jkl",
        "klm",
        "lmn",
        "mno",
        "nop",
        "opq",
        "pqr",
        "qrs",
        "rst",
        "stu",
        "tuv",
        "uvw",
        "vwx",
        "wxy",
        "xyz",
    ]
    password_lower = password.lower()
    for pattern in sequential_patterns:
        if pattern in password_lower:
            errors.append(
                "Password cannot contain sequential characters (e.g., '123', 'abc')"
            )
            break

    # Check for repeated characters (3+ in a row)
    if re.search(r"(.)\1{2,}", password):
        errors.append("Password cannot contain 3 or more repeated characters")

    # Check for common passwords (expanded list for security)
    common_passwords = [
        "password",
        "12345678",
        "123456789",
        "1234567890",
        "qwerty",
        "admin",
        "letmein",
        "welcome",
        "monkey",
        "dragon",
        "master",
        "password123",
        "password1",
        "password!",
        "iloveyou",
        "sunshine",
        "princess",
        "admin123",
        "qwerty123",
        "login",
        "passw0rd",
        "baseball",
        "football",
        "shadow",
        "michael",
        "batman",
        "trustno1",
        "whatever",
        "freedom",
        "mustang",
        "jennifer",
        "jordan",
        "harley",
        "ranger",
        "thomas",
        "robert",
        "soccer",
        "hockey",
        "killer",
        "george",
        "charlie",
        "andrew",
        "daniel",
        "joshua",
        "matthew",
        "firedepart",
        "firehouse",
        "firefighter",
        "rescue",
        "engine",
        "ladder",
        "station",
        "department",
        "emergency",
        "medic",
        "ems",
        "ambulance",
    ]
    if password_lower in common_passwords:
        errors.append("Password is too common. Please choose a stronger password")

    # Check for keyboard patterns
    keyboard_patterns = [
        "qwerty",
        "asdfgh",
        "zxcvbn",
        "qazwsx",
        "qweasd",
        "!@#$%^",
        "1qaz2wsx",
        "1234qwer",
        "asdf1234",
    ]
    for pattern in keyboard_patterns:
        if pattern in password_lower:
            errors.append("Password cannot contain keyboard patterns")
            break

    if errors:
        # Format errors clearly - prefix with count if multiple
        if len(errors) == 1:
            error_message = errors[0]
        else:
            error_message = (
                f"Password requirements not met ({len(errors)} issues): "
                + "; ".join(errors)
            )

        return False, error_message

    return True, None


def generate_temporary_password(length: int = 16) -> str:
    """
    Generate a temporary password that is guaranteed to pass
    validate_password_strength().

    The password always contains at least one character from each required
    category (uppercase, lowercase, digit, special) and is validated before
    being returned.  If the random fill happens to introduce a sequential or
    repeated pattern the generator retries (up to 20 attempts) until a clean
    password is produced.

    Args:
        length: Desired password length (minimum 12, clamped automatically).

    Returns:
        A temporary password string that passes all strength checks.

    Raises:
        RuntimeError: If a compliant password cannot be generated after
            multiple attempts (should never happen in practice).
    """
    length = max(length, settings.PASSWORD_MIN_LENGTH)

    upper = string.ascii_uppercase
    lower = string.ascii_lowercase
    digits = string.digits
    specials = "!@#$%^&*"
    all_chars = upper + lower + digits + specials

    for _ in range(20):
        # Guarantee at least one from each required category
        chars: list[str] = [
            secrets.choice(upper),
            secrets.choice(lower),
            secrets.choice(digits),
            secrets.choice(specials),
        ]
        # Fill the rest randomly
        chars.extend(secrets.choice(all_chars) for _ in range(length - len(chars)))
        # Shuffle so the guaranteed chars aren't always at the front
        secrets.SystemRandom().shuffle(chars)

        candidate = "".join(chars)
        is_valid, _ = validate_password_strength(candidate)
        if is_valid:
            return candidate

    raise RuntimeError("Failed to generate a compliant temporary password")


# ============================================
# Data Encryption (AES-256-GCM)
# ============================================
#
# New ciphertext uses AES-256-GCM (AEAD: confidentiality + integrity in one
# pass), marked with a version prefix. Values written by the previous scheme
# (Fernet = AES-128-CBC + HMAC-SHA256) remain readable, so NO re-encryption is
# required for correctness — `scripts/reencrypt_to_aesgcm.py` migrates existing
# rows to GCM in the background, after which Fernet read support can be removed.


def get_encryption_salt() -> bytes:
    """
    Get installation-specific salt for key derivation.

    SECURITY: Each installation MUST have a unique salt set via ENCRYPTION_SALT.
    This prevents rainbow table attacks across installations.

    Returns:
        Salt bytes for key derivation
    """
    salt = settings.ENCRYPTION_SALT

    if not salt:
        if settings.ENVIRONMENT in ("production", "staging"):
            raise RuntimeError(
                "ENCRYPTION_SALT must be set in production. "
                'Generate one with: python -c "import secrets; print(secrets.token_hex(16))"'
            )
        # Fallback for development only - log warning
        logger.warning(
            "SECURITY WARNING: ENCRYPTION_SALT not set. "
            "Using fallback salt. This is insecure for production!"
        )
        # Use a hash of SECRET_KEY as fallback (still unique per installation if SECRET_KEY is set)
        salt = hashlib.sha256(settings.SECRET_KEY.encode()).hexdigest()[:32]

    return salt.encode()


# PBKDF2 work factors.
#
# The iteration count is part of the ciphertext's identity: change it and the
# derived key changes, so every existing value becomes undecryptable. Both
# counts are therefore permanent — V2 for new writes, V1 retained forever to
# read anything written before the bump. The `$gcm1$` / `$gcm2$` markers on
# each value say which one produced it.
#
# Honest scope: PBKDF2 iterations defend a *low-entropy* input against brute
# force. A properly generated ENCRYPTION_KEY (64 hex chars) has 256 bits of
# entropy and is not brute-forceable at any iteration count. This raise is
# defense in depth for installations that set a weak key, or that fall back to
# deriving the salt from SECRET_KEY — plus it puts the KDF on OWASP's current
# recommendation, which auditors do check.
_KDF_ITERATIONS_V1 = 100_000
_KDF_ITERATIONS_V2 = 600_000


def _derive_key_bytes(
    key: str | None = None, iterations: int = _KDF_ITERATIONS_V2
) -> bytes:
    """Derive the raw 32-byte data-encryption key from settings.

    PBKDF2-HMAC-SHA256 over ENCRYPTION_KEY (or an explicit ``key``, used for
    the legacy-key decrypt ring) with the installation-specific salt. Both
    the AES-256-GCM cipher (raw 32 bytes) and the legacy Fernet cipher
    (base64 form) derive from this single function, so a value written under
    either scheme decrypts with the same configured key.

    ``iterations`` selects the work factor. Callers reading old ciphertext
    must pass ``_KDF_ITERATIONS_V1``; new writes take the default.
    """
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=get_encryption_salt(),
        iterations=iterations,
    )
    return kdf.derive((key or settings.ENCRYPTION_KEY).encode())


def _get_legacy_keys() -> list[str]:
    """Previous ENCRYPTION_KEY values still allowed for DECRYPTION only.

    Set via ENCRYPTION_KEYS_LEGACY (comma-separated) during a key rotation;
    new writes always use the current key. See docs/KEY_ROTATION.md.
    """
    raw = getattr(settings, "ENCRYPTION_KEYS_LEGACY", "") or ""
    return [k.strip() for k in raw.split(",") if k.strip()]


def get_encryption_key() -> bytes:
    """
    Get or derive the base64-encoded encryption key used by the legacy Fernet
    cipher (retained to decrypt data written before the AES-256-GCM migration).

    Returns:
        url-safe base64 of the 32-byte derived key (Fernet key format)
    """
    # Pinned to V1: every Fernet value predates the iteration bump, so the
    # only key that can read them is the one that wrote them.
    return base64.urlsafe_b64encode(_derive_key_bytes(iterations=_KDF_ITERATIONS_V1))


# Lazy-initialized ciphers. Avoids crashing at import time if ENCRYPTION_KEY is
# not yet configured (e.g. during testing or initial setup).
_cipher: Fernet | None = None

# Version markers prepended to AES-256-GCM ciphertext. The `$` characters are
# not valid url-safe base64, so a marked value can never collide with a legacy
# Fernet token (which is base64 and starts with `gAAAAA`).
#
# gcm1 = AES-256-GCM, key derived at 100k PBKDF2 iterations (read-only)
# gcm2 = AES-256-GCM, key derived at 600k PBKDF2 iterations (current)
_GCM_PREFIX_V1 = "$gcm1$"
_GCM_PREFIX_V2 = "$gcm2$"
# What new writes use.
_GCM_PREFIX = _GCM_PREFIX_V2

# Marker → the KDF work factor that produced that value's key.
_GCM_PREFIX_ITERATIONS = {
    _GCM_PREFIX_V1: _KDF_ITERATIONS_V1,
    _GCM_PREFIX_V2: _KDF_ITERATIONS_V2,
}
# GCM nonce length: 96 bits is the NIST-recommended size for a random nonce.
_GCM_NONCE_BYTES = 12


# Decrypt-ring cipher caches, keyed by (key string, KDF work factor). The work
# factor is part of the cache key because the same ENCRYPTION_KEY derives two
# different AES keys at V1 and V2 — caching on the key string alone would
# return the wrong cipher for whichever version was requested second.
# PBKDF2 at these iteration counts is deliberately slow: derive each once.
_legacy_aesgcms: dict[tuple[str, int], AESGCM] = {}
_legacy_fernets: dict[str, Fernet] = {}
# Current-key GCM ciphers by work factor, so reading a `$gcm1$` value under the
# *current* key does not re-derive on every call.
_aesgcms_by_iterations: dict[int, AESGCM] = {}


def _get_cipher() -> Fernet:
    """Legacy Fernet cipher — used only to DECRYPT pre-migration ciphertext."""
    global _cipher
    if _cipher is None:
        _cipher = Fernet(get_encryption_key())
    return _cipher


def _get_aesgcm(iterations: int = _KDF_ITERATIONS_V2) -> AESGCM:
    """Current-key GCM cipher at the given KDF work factor."""
    if iterations not in _aesgcms_by_iterations:
        _aesgcms_by_iterations[iterations] = AESGCM(
            _derive_key_bytes(iterations=iterations)
        )
    return _aesgcms_by_iterations[iterations]


def _get_legacy_aesgcm(key: str, iterations: int = _KDF_ITERATIONS_V2) -> AESGCM:
    cache_key = (key, iterations)
    if cache_key not in _legacy_aesgcms:
        _legacy_aesgcms[cache_key] = AESGCM(
            _derive_key_bytes(key, iterations=iterations)
        )
    return _legacy_aesgcms[cache_key]


def _get_legacy_fernet(key: str) -> Fernet:
    # Fernet values all predate the iteration bump — pin to V1.
    if key not in _legacy_fernets:
        _legacy_fernets[key] = Fernet(
            base64.urlsafe_b64encode(
                _derive_key_bytes(key, iterations=_KDF_ITERATIONS_V1)
            )
        )
    return _legacy_fernets[key]


def reset_encryption_ciphers() -> None:
    """Drop all cached ciphers so the next use re-derives from settings.

    Needed after ENCRYPTION_KEY / ENCRYPTION_KEYS_LEGACY change at runtime
    (key-rotation tooling, tests) — the module-level caches would otherwise
    keep encrypting under the old key.
    """
    global _cipher
    _cipher = None
    _aesgcms_by_iterations.clear()
    _legacy_aesgcms.clear()
    _legacy_fernets.clear()


def encrypt_data(data: str) -> str:
    """
    Encrypt sensitive data using AES-256-GCM (authenticated encryption).

    HIPAA Compliance: PHI is encrypted at rest with AES-256 in GCM mode, which
    provides both confidentiality and integrity (a tampered ciphertext fails to
    decrypt). A fresh random 96-bit nonce is generated per call. The output is
    version-marked so it can be told apart from legacy Fernet ciphertext on read.

    Args:
        data: Plain text data to encrypt

    Returns:
        Version-marked, base64-encoded ciphertext (nonce ‖ ciphertext ‖ tag)
    """
    if not data:
        return ""

    nonce = secrets.token_bytes(_GCM_NONCE_BYTES)
    ciphertext = _get_aesgcm().encrypt(nonce, data.encode(), None)
    return _GCM_PREFIX + base64.urlsafe_b64encode(nonce + ciphertext).decode()


def decrypt_data(encrypted_data: str) -> str:
    """
    Decrypt data produced by encrypt_data().

    Dispatches on the version marker: AES-256-GCM for new values, and the legacy
    Fernet cipher for values written before the GCM migration (kept readable so
    no re-encryption is required for correctness).

    Args:
        encrypted_data: Version-marked GCM ciphertext, or a legacy Fernet token

    Returns:
        Decrypted plain text data

    Raises:
        cryptography.exceptions.InvalidTag: GCM auth/integrity failure (tamper or
            wrong key) — fail closed, never return unverified plaintext.
        cryptography.fernet.InvalidToken: legacy value is not a valid Fernet
            token (e.g. legacy plaintext) — callers may treat this as a
            backward-compat passthrough.
    """
    if not encrypted_data:
        return ""

    for prefix, iterations in _GCM_PREFIX_ITERATIONS.items():
        if not encrypted_data.startswith(prefix):
            continue
        # The marker, not the current default, decides the work factor: a
        # `$gcm1$` value is only readable with a key derived at V1.
        raw = base64.urlsafe_b64decode(encrypted_data[len(prefix) :])
        nonce, ciphertext = raw[:_GCM_NONCE_BYTES], raw[_GCM_NONCE_BYTES:]
        try:
            return _get_aesgcm(iterations).decrypt(nonce, ciphertext, None).decode()
        except InvalidTag:
            # Key-rotation ring: values written before a rotation decrypt
            # under a legacy key. GCM authentication guarantees only the
            # right key can succeed, so trying the ring never weakens the
            # fail-closed contract — if no key verifies, re-raise.
            for legacy_key in _get_legacy_keys():
                try:
                    return (
                        _get_legacy_aesgcm(legacy_key, iterations)
                        .decrypt(nonce, ciphertext, None)
                        .decode()
                    )
                except InvalidTag:
                    continue
            raise

    # Legacy Fernet (AES-128-CBC + HMAC) ciphertext written before the migration.
    try:
        return _get_cipher().decrypt(encrypted_data.encode()).decode()
    except InvalidToken:
        for legacy_key in _get_legacy_keys():
            try:
                return (
                    _get_legacy_fernet(legacy_key)
                    .decrypt(encrypted_data.encode())
                    .decode()
                )
            except InvalidToken:
                continue
        raise


def decrypts_with_current_key(encrypted_data: str) -> bool:
    """Whether a stored value is written under the CURRENT key and scheme.

    False means the value depends on a legacy ring key, uses a superseded
    scheme, or doesn't decrypt at all — the rotation script uses this to find
    rows needing rewrite.

    A `$gcm1$` value reports False even though the current key *can* read it:
    its key was derived at the old work factor, so rewriting it is what moves
    the row onto the current KDF. That gives the iteration bump a migration
    path through the tooling that already exists.
    """
    if not encrypted_data:
        return True
    try:
        if encrypted_data.startswith(_GCM_PREFIX_V2):
            raw = base64.urlsafe_b64decode(encrypted_data[len(_GCM_PREFIX_V2) :])
            nonce, ciphertext = raw[:_GCM_NONCE_BYTES], raw[_GCM_NONCE_BYTES:]
            _get_aesgcm().decrypt(nonce, ciphertext, None)
        elif encrypted_data.startswith(_GCM_PREFIX_V1):
            return False
        else:
            _get_cipher().decrypt(encrypted_data.encode())
        return True
    except (InvalidTag, InvalidToken, ValueError):
        return False


# ============================================
# JWT Token Management
# ============================================


def create_access_token(
    data: dict[str, Any], expires_delta: timedelta | None = None
) -> str:
    """
    Create a JWT access token

    Args:
        data: Dictionary of claims to encode in the token
        expires_delta: Optional custom expiration time

    Returns:
        Encoded JWT token string
    """
    to_encode = data.copy()

    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(
            minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
        )

    to_encode.update(
        {"exp": expire, "iat": datetime.now(timezone.utc), "type": "access"}
    )

    encoded_jwt = jwt.encode(
        to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM
    )
    return encoded_jwt


def create_mfa_pending_token(user_id: str, minutes: int = 5) -> str:
    """Create a short-lived token marking a password-verified MFA challenge.

    This token is NOT a session token: it only authorizes completing the MFA
    second factor (verified via decode_token + type == 'mfa_pending'), never
    API access.
    """
    now = datetime.now(timezone.utc)
    to_encode = {
        "sub": str(user_id),
        "exp": now + timedelta(minutes=minutes),
        "iat": now,
        "type": "mfa_pending",
    }
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_refresh_token(data: dict[str, Any]) -> str:
    """
    Create a JWT refresh token with longer expiration

    Args:
        data: Dictionary of claims to encode in the token

    Returns:
        Encoded JWT refresh token string
    """
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(
        days=settings.REFRESH_TOKEN_EXPIRE_DAYS
    )

    to_encode.update(
        {"exp": expire, "iat": datetime.now(timezone.utc), "type": "refresh"}
    )

    encoded_jwt = jwt.encode(
        to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM
    )
    return encoded_jwt


def decode_token(token: str) -> dict[str, Any]:
    """
    Decode and validate a JWT token's signature and expiry.

    NOTE: This only verifies the signature and `exp`. It does NOT check the
    token type (access vs refresh) or whether a server-side session still
    exists. For authentication/authorization, use
    AuthService.get_user_from_token, which performs those checks.

    Args:
        token: JWT token string

    Returns:
        Dictionary of decoded claims

    Raises:
        JWTError: If token is invalid or expired
    """
    # SEC: Hardcode accepted algorithms to prevent algorithm confusion attacks.
    # Never allow "none" or asymmetric algorithms when using symmetric signing.
    _ALLOWED_ALGORITHMS = ["HS256"]
    # SEC: Require an expiry claim so a token minted without `exp` (which would
    # otherwise never expire) is rejected. Every issuer in this codebase sets
    # exp, so this only closes the malformed/forged-without-exp case.
    payload = jwt.decode(
        token,
        settings.SECRET_KEY,
        algorithms=_ALLOWED_ALGORITHMS,
        options={"require": ["exp"]},
    )
    return payload


# ============================================
# Security Utilities
# ============================================


def generate_secure_token(length: int = 32) -> str:
    """
    Generate a cryptographically secure random token

    Args:
        length: Length of the token in bytes

    Returns:
        URL-safe base64 encoded token
    """
    return secrets.token_urlsafe(length)


def generate_verification_code(length: int = 6) -> str:
    """
    Generate a numeric verification code for email/SMS verification

    Args:
        length: Number of digits

    Returns:
        Numeric string of specified length
    """
    return "".join([str(secrets.randbelow(10)) for _ in range(length)])


def hash_data_sha256(data: str) -> str:
    """
    Create SHA-256 hash of data (for integrity verification)

    Args:
        data: Data to hash

    Returns:
        Hexadecimal hash string
    """
    return hashlib.sha256(data.encode()).hexdigest()


def verify_hash_chain(previous_hash: str, current_data: str, current_hash: str) -> bool:
    """
    Verify integrity of a hash chain (used for audit logs)

    Args:
        previous_hash: Hash of previous entry
        current_data: Data of current entry
        current_hash: Hash to verify

    Returns:
        True if hash chain is valid
    """
    expected_hash = hashlib.sha256(
        f"{previous_hash}{current_data}".encode()
    ).hexdigest()

    # Use constant-time comparison to prevent timing side-channel attacks
    return secrets.compare_digest(expected_hash, current_hash)


def sanitize_input(text: str, max_length: int = 1000) -> str:
    """
    Sanitize user input to prevent injection attacks

    Args:
        text: User input text
        max_length: Maximum allowed length

    Returns:
        Sanitized text
    """
    if not text:
        return ""

    # Trim to max length
    text = text[:max_length]

    # Remove null bytes
    text = text.replace("\x00", "")

    # Remove control characters except common whitespace
    allowed_control = {"\n", "\r", "\t"}
    text = "".join(
        char for char in text if char in allowed_control or char.isprintable()
    )

    return text.strip()


def mask_sensitive_data(data: str, visible_chars: int = 4) -> str:
    """
    Mask sensitive data for logging purposes

    Example: "1234567890" -> "******7890"

    Args:
        data: Data to mask
        visible_chars: Number of characters to show at end

    Returns:
        Masked string
    """
    if not data or len(data) <= visible_chars:
        return "***"

    return "*" * (len(data) - visible_chars) + data[-visible_chars:]


# ============================================
# Rate Limiting Helpers
# ============================================


async def is_rate_limited(
    key: str,
    limit: int,
    window_seconds: int,
    fail_closed: bool = True,
) -> bool:
    """
    Check if a key has exceeded rate limit using Redis sliding window.

    Uses Redis for distributed rate limiting across multiple instances.

    Args:
        key: Unique key to track (e.g., IP address, user ID)
        limit: Maximum number of requests allowed in the window
        window_seconds: Time window in seconds
        fail_closed: If True (default), deny requests when Redis is
                     unavailable.  This is the safe default for
                     security-critical paths (login, registration).

    Returns:
        True if rate limit exceeded, False otherwise
    """
    import time

    from app.core.cache import cache_manager

    if not cache_manager.is_connected or not cache_manager.redis_client:
        if fail_closed:
            logger.warning(
                "Rate limiting fail-closed: Redis not connected, denying request"
            )
            return True
        logger.debug("Rate limiting disabled - Redis not connected")
        return False

    try:
        redis_client = cache_manager.redis_client
        rate_limit_key = f"rate_limit:{key}"
        current_time = time.time()
        window_start = current_time - window_seconds

        # Use a Redis pipeline for atomic operations
        pipe = redis_client.pipeline()

        # Remove old entries outside the window
        pipe.zremrangebyscore(rate_limit_key, 0, window_start)

        # Count requests in current window
        pipe.zcard(rate_limit_key)

        # Add current request with timestamp as score
        pipe.zadd(rate_limit_key, {str(current_time): current_time})

        # Set expiry on the key to auto-cleanup
        pipe.expire(rate_limit_key, window_seconds)

        # Execute pipeline
        results = await pipe.execute()

        # Get the count (second command result, before adding current request)
        request_count = results[1]

        if request_count >= limit:
            logger.warning(
                f"Rate limit exceeded for key: {key} ({request_count}/{limit} requests)"
            )
            return True

        return False

    except Exception as e:
        logger.error(f"Rate limiting error: {e}")
        if fail_closed:
            logger.warning("Rate limiting fail-closed on error, denying request")
            return True
        return False

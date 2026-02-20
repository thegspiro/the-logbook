"""
Security Utilities

Comprehensive security functions for password hashing, encryption,
and other security-critical operations. HIPAA compliant.
"""

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHash
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.backends import default_backend
import jwt
from jwt.exceptions import InvalidTokenError as JWTError
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
import secrets
import base64
import hashlib
import re

from app.core.config import settings


# ============================================
# Password Hashing (Argon2)
# ============================================

# Argon2 is recommended by OWASP and is resistant to GPU attacks
password_hasher = PasswordHasher(
    time_cost=3,        # Number of iterations
    memory_cost=65536,  # Memory usage in KB (64 MB)
    parallelism=4,      # Number of parallel threads
    hash_len=32,        # Length of the hash in bytes
    salt_len=16         # Length of the salt in bytes
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

    # Check length
    if len(password) < settings.PASSWORD_MIN_LENGTH:
        errors.append(f"Password must be at least {settings.PASSWORD_MIN_LENGTH} characters long")

    # Check uppercase
    if settings.PASSWORD_REQUIRE_UPPERCASE and not re.search(r'[A-Z]', password):
        errors.append("Password must contain at least one uppercase letter")

    # Check lowercase
    if settings.PASSWORD_REQUIRE_LOWERCASE and not re.search(r'[a-z]', password):
        errors.append("Password must contain at least one lowercase letter")

    # Check numbers
    if settings.PASSWORD_REQUIRE_NUMBERS and not re.search(r'\d', password):
        errors.append("Password must contain at least one number")

    # Check special characters
    if settings.PASSWORD_REQUIRE_SPECIAL and not re.search(r'[!@#$%^&*()_+\-=\[\]{};\':"\\|,.<>\/?~`]', password):
        errors.append("Password must contain at least one special character")

    # Check for sequential characters (3+ in a row)
    sequential_patterns = [
        '012', '123', '234', '345', '456', '567', '678', '789',
        'abc', 'bcd', 'cde', 'def', 'efg', 'fgh', 'ghi', 'hij',
        'ijk', 'jkl', 'klm', 'lmn', 'mno', 'nop', 'opq', 'pqr',
        'qrs', 'rst', 'stu', 'tuv', 'uvw', 'vwx', 'wxy', 'xyz'
    ]
    password_lower = password.lower()
    for pattern in sequential_patterns:
        if pattern in password_lower:
            errors.append("Password cannot contain sequential characters (e.g., '123', 'abc')")
            break

    # Check for repeated characters (3+ in a row)
    if re.search(r'(.)\1{2,}', password):
        errors.append("Password cannot contain 3 or more repeated characters")

    # Check for common passwords (expanded list for security)
    common_passwords = [
        'password', '12345678', '123456789', '1234567890', 'qwerty', 'admin',
        'letmein', 'welcome', 'monkey', 'dragon', 'master', 'password123',
        'password1', 'password!', 'iloveyou', 'sunshine', 'princess', 'admin123',
        'qwerty123', 'login', 'passw0rd', 'baseball', 'football', 'shadow',
        'michael', 'batman', 'trustno1', 'whatever', 'freedom', 'mustang',
        'jennifer', 'jordan', 'harley', 'ranger', 'thomas', 'robert', 'soccer',
        'hockey', 'killer', 'george', 'charlie', 'andrew', 'daniel', 'joshua',
        'matthew', 'firedepart', 'firehouse', 'firefighter', 'rescue', 'engine',
        'ladder', 'station', 'department', 'emergency', 'medic', 'ems', 'ambulance'
    ]
    if password_lower in common_passwords:
        errors.append("Password is too common. Please choose a stronger password")

    # Check for keyboard patterns
    keyboard_patterns = [
        'qwerty', 'asdfgh', 'zxcvbn', 'qazwsx', 'qweasd', '!@#$%^',
        '1qaz2wsx', '1234qwer', 'asdf1234'
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
            error_message = f"Password requirements not met ({len(errors)} issues): " + "; ".join(errors)

        return False, error_message

    return True, None


# ============================================
# Data Encryption (AES-256)
# ============================================

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
        if settings.ENVIRONMENT == "production":
            raise RuntimeError(
                "ENCRYPTION_SALT must be set in production. "
                "Generate one with: python -c \"import secrets; print(secrets.token_hex(16))\""
            )
        # Fallback for development only - log warning
        import logging
        logging.warning(
            "SECURITY WARNING: ENCRYPTION_SALT not set. "
            "Using fallback salt. This is insecure for production!"
        )
        # Use a hash of SECRET_KEY as fallback (still unique per installation if SECRET_KEY is set)
        salt = hashlib.sha256(settings.SECRET_KEY.encode()).hexdigest()[:32]

    return salt.encode()


def get_encryption_key() -> bytes:
    """
    Get or derive encryption key from settings.

    SECURITY: Uses PBKDF2 with installation-specific salt to derive
    a secure encryption key from the configured ENCRYPTION_KEY.

    Returns:
        32-byte encryption key for AES-256
    """
    key = settings.ENCRYPTION_KEY.encode()

    # Always derive key using PBKDF2 with installation-specific salt
    # This ensures consistent key derivation and adds salt protection
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=get_encryption_salt(),
        iterations=100000,
        backend=default_backend()
    )
    derived_key = kdf.derive(key)

    return base64.urlsafe_b64encode(derived_key)


# Initialize Fernet cipher with encryption key
cipher = Fernet(get_encryption_key())


def encrypt_data(data: str) -> str:
    """
    Encrypt sensitive data using AES-256

    HIPAA Compliance: All PHI (Protected Health Information) must be
    encrypted at rest using AES-256 or equivalent encryption.

    Args:
        data: Plain text data to encrypt

    Returns:
        Encrypted data as base64 string
    """
    if not data:
        return ""

    encrypted = cipher.encrypt(data.encode())
    return encrypted.decode()


def decrypt_data(encrypted_data: str) -> str:
    """
    Decrypt data encrypted with encrypt_data()

    Args:
        encrypted_data: Encrypted data as base64 string

    Returns:
        Decrypted plain text data

    Raises:
        cryptography.fernet.InvalidToken: If data is corrupted or key is wrong
    """
    if not encrypted_data:
        return ""

    decrypted = cipher.decrypt(encrypted_data.encode())
    return decrypted.decode()


# ============================================
# JWT Token Management
# ============================================

def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
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
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode.update({
        "exp": expire,
        "iat": datetime.utcnow(),
        "type": "access"
    })

    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


def create_refresh_token(data: Dict[str, Any]) -> str:
    """
    Create a JWT refresh token with longer expiration

    Args:
        data: Dictionary of claims to encode in the token

    Returns:
        Encoded JWT refresh token string
    """
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

    to_encode.update({
        "exp": expire,
        "iat": datetime.utcnow(),
        "type": "refresh"
    })

    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


def decode_token(token: str) -> Dict[str, Any]:
    """
    Decode and validate a JWT token

    Args:
        token: JWT token string

    Returns:
        Dictionary of decoded claims

    Raises:
        JWTError: If token is invalid or expired
    """
    payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
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
    return ''.join([str(secrets.randbelow(10)) for _ in range(length)])


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

    return expected_hash == current_hash


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
    text = text.replace('\x00', '')

    # Remove control characters except common whitespace
    allowed_control = {'\n', '\r', '\t'}
    text = ''.join(char for char in text if char in allowed_control or char.isprintable())

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
    fail_closed: bool = False,
) -> bool:
    """
    Check if a key has exceeded rate limit using Redis sliding window.

    Uses Redis for distributed rate limiting across multiple instances.

    Args:
        key: Unique key to track (e.g., IP address, user ID)
        limit: Maximum number of requests allowed in the window
        window_seconds: Time window in seconds
        fail_closed: If True, deny requests when Redis is unavailable.
                     Use True for security-critical paths (login, registration).

    Returns:
        True if rate limit exceeded, False otherwise
    """
    from app.core.cache import cache_manager
    from loguru import logger
    import time

    if not cache_manager.is_connected or not cache_manager.redis_client:
        if fail_closed:
            logger.warning("Rate limiting fail-closed: Redis not connected, denying request")
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
            logger.warning(f"Rate limit exceeded for key: {key} ({request_count}/{limit} requests)")
            return True

        return False

    except Exception as e:
        logger.error(f"Rate limiting error: {e}")
        if fail_closed:
            logger.warning("Rate limiting fail-closed on error, denying request")
            return True
        return False


def is_rate_limited_sync(key: str, limit: int, window_seconds: int) -> bool:
    """
    Synchronous version of rate limiting check.

    Note: This is a fallback for synchronous contexts. Prefer the async
    version when possible for better performance.

    Args:
        key: Unique key to track (e.g., IP address, user ID)
        limit: Maximum number of requests allowed in the window
        window_seconds: Time window in seconds

    Returns:
        True if rate limit exceeded, False otherwise
    """
    import asyncio

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # If we're in an async context, we can't use run_until_complete
            # Fall back to allowing the request
            return False
        return loop.run_until_complete(is_rate_limited(key, limit, window_seconds))
    except RuntimeError:
        # No event loop available, allow the request
        return False

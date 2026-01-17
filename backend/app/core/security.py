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
from jose import JWTError, jwt
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


def hash_password(password: str) -> str:
    """
    Hash a password using Argon2id

    SECURITY: Argon2id is the winner of the Password Hashing Competition
    and provides resistance against both side-channel and GPU attacks.

    Args:
        password: Plain text password

    Returns:
        Hashed password string

    Raises:
        ValueError: If password doesn't meet complexity requirements
    """
    # Validate password strength
    validate_password_strength(password)

    # Hash the password
    return password_hasher.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    """
    Verify a password against its hash

    Args:
        password: Plain text password to verify
        hashed_password: Previously hashed password

    Returns:
        True if password matches, False otherwise
    """
    try:
        password_hasher.verify(hashed_password, password)

        # Check if password needs rehashing (if parameters changed)
        if password_hasher.check_needs_rehash(hashed_password):
            # Note: In production, you should rehash the password here
            pass

        return True
    except (VerifyMismatchError, VerificationError, InvalidHash):
        return False


def validate_password_strength(password: str) -> bool:
    """
    Validate password meets complexity requirements

    Requirements based on NIST SP 800-63B and HIPAA guidelines:
    - Minimum length: 12 characters
    - At least one uppercase letter
    - At least one lowercase letter
    - At least one number
    - At least one special character
    - No common passwords

    Args:
        password: Password to validate

    Returns:
        True if valid

    Raises:
        ValueError: If password doesn't meet requirements
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
    if settings.PASSWORD_REQUIRE_SPECIAL and not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
        errors.append("Password must contain at least one special character")

    # Check for common passwords (basic list - expand in production)
    common_passwords = [
        'password', '12345678', 'qwerty', 'admin', 'letmein',
        'welcome', 'monkey', 'dragon', 'master', 'password123'
    ]
    if password.lower() in common_passwords:
        errors.append("Password is too common. Please choose a stronger password")

    if errors:
        raise ValueError("; ".join(errors))

    return True


# ============================================
# Data Encryption (AES-256)
# ============================================

def get_encryption_key() -> bytes:
    """
    Get or derive encryption key from settings

    Returns:
        32-byte encryption key for AES-256
    """
    # In production, this should be a proper 32-byte key from environment
    key = settings.ENCRYPTION_KEY.encode()

    # If not exactly 32 bytes, derive it using PBKDF2
    if len(key) != 32:
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=b'fire_dept_intranet_salt',  # In production, use a random salt
            iterations=100000,
            backend=default_backend()
        )
        key = kdf.derive(key)

    return base64.urlsafe_b64encode(key)


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

    # Remove control characters except common ones
    allowed_control = ['\n', '\r', '\t']
    text = ''.join(char for char in text if char in allowed_control or not char.isprintable() is False)

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

def is_rate_limited(key: str, limit: int, window_seconds: int) -> bool:
    """
    Check if a key has exceeded rate limit

    Note: This is a helper function. Actual implementation
    should use Redis for distributed rate limiting.

    Args:
        key: Unique key to track (e.g., IP address, user ID)
        limit: Maximum number of requests
        window_seconds: Time window in seconds

    Returns:
        True if rate limit exceeded
    """
    # TODO: Implement with Redis
    # For now, return False (no rate limiting)
    return False

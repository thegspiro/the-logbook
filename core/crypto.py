"""
Cryptographic utilities for secure token and sensitive data storage
IMPORTANT: All API tokens and secrets are encrypted before database storage
"""
from cryptography.fernet import Fernet
from django.conf import settings
import base64
import hashlib
import logging

logger = logging.getLogger(__name__)


class TokenEncryption:
    """
    Encrypt/decrypt API tokens and sensitive strings
    
    SECURITY NOTE:
    - Uses Fernet (symmetric encryption) with AES-128-CBC
    - Encryption key derived from Django SECRET_KEY
    - Tokens are NEVER stored in plain text in database
    - Each encryption includes timestamp for key rotation support
    """
    
    @staticmethod
    def _get_cipher():
        """
        Get Fernet cipher using SECRET_KEY
        
        Returns:
            Fernet cipher instance
        """
        # Derive 32-byte key from SECRET_KEY
        key_material = settings.SECRET_KEY.encode()
        key = base64.urlsafe_b64encode(
            hashlib.sha256(key_material).digest()
        )
        return Fernet(key)
    
    @staticmethod
    def encrypt(plain_text: str) -> str:
        """
        Encrypt a string (e.g., API token)
        
        Args:
            plain_text: String to encrypt
            
        Returns:
            Base64-encoded encrypted string
            
        Example:
            encrypted = TokenEncryption.encrypt("my-api-token-123")
            # Store encrypted in database
        """
        if not plain_text:
            return ''
        
        try:
            cipher = TokenEncryption._get_cipher()
            encrypted_bytes = cipher.encrypt(plain_text.encode())
            return encrypted_bytes.decode()
        except Exception as e:
            logger.error(f"Encryption failed: {e}")
            raise
    
    @staticmethod
    def decrypt(encrypted_text: str) -> str:
        """
        Decrypt an encrypted string
        
        Args:
            encrypted_text: Encrypted string from database
            
        Returns:
            Original plain text
            
        Example:
            plain_token = TokenEncryption.decrypt(stored_encrypted_value)
        """
        if not encrypted_text:
            return ''
        
        try:
            cipher = TokenEncryption._get_cipher()
            decrypted_bytes = cipher.decrypt(encrypted_text.encode())
            return decrypted_bytes.decode()
        except Exception as e:
            logger.error(f"Decryption failed: {e}")
            raise
    
    @staticmethod
    def rotate_encryption(old_encrypted: str, old_secret_key: str) -> str:
        """
        Re-encrypt data with new SECRET_KEY after key rotation
        
        Args:
            old_encrypted: Data encrypted with old key
            old_secret_key: Previous SECRET_KEY
            
        Returns:
            Data re-encrypted with current SECRET_KEY
        """
        # Temporarily use old key to decrypt
        old_key = base64.urlsafe_b64encode(
            hashlib.sha256(old_secret_key.encode()).digest()
        )
        old_cipher = Fernet(old_key)
        
        # Decrypt with old key
        plain_text = old_cipher.decrypt(old_encrypted.encode()).decode()
        
        # Re-encrypt with new key
        return TokenEncryption.encrypt(plain_text)


class SecureTokenField:
    """
    Descriptor for model fields that store encrypted tokens
    
    Usage in models:
        class UserProfile(models.Model):
            _api_token = models.CharField(max_length=500, blank=True)
            api_token = SecureTokenField('_api_token')
    
    This allows transparent encryption/decryption:
        profile.api_token = "plain-token"  # Automatically encrypted
        token = profile.api_token           # Automatically decrypted
    """
    
    def __init__(self, field_name):
        self.field_name = field_name
    
    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        
        encrypted_value = getattr(obj, self.field_name, '')
        if not encrypted_value:
            return None
        
        try:
            return TokenEncryption.decrypt(encrypted_value)
        except Exception:
            logger.warning(f"Failed to decrypt {self.field_name}")
            return None
    
    def __set__(self, obj, value):
        if value:
            encrypted_value = TokenEncryption.encrypt(value)
            setattr(obj, self.field_name, encrypted_value)
        else:
            setattr(obj, self.field_name, '')


class PasswordHashValidator:
    """
    Additional validation to ensure passwords meet security requirements
    
    NOTE: This is in addition to Django's built-in password hashing.
    Django AUTOMATICALLY hashes all passwords - they are NEVER stored plain text.
    """
    
    @staticmethod
    def validate_strength(password: str) -> tuple[bool, str]:
        """
        Validate password strength beyond Django defaults
        
        Args:
            password: Password to validate
            
        Returns:
            (is_valid, error_message)
        """
        errors = []
        
        # Check length (Django default is 8, we require 12)
        if len(password) < 12:
            errors.append("Password must be at least 12 characters")
        
        # Check for uppercase
        if not any(c.isupper() for c in password):
            errors.append("Password must contain at least one uppercase letter")
        
        # Check for lowercase
        if not any(c.islower() for c in password):
            errors.append("Password must contain at least one lowercase letter")
        
        # Check for digit
        if not any(c.isdigit() for c in password):
            errors.append("Password must contain at least one number")
        
        # Check for special character
        special_chars = "!@#$%^&*()_+-=[]{}|;:,.<>?"
        if not any(c in special_chars for c in password):
            errors.append("Password must contain at least one special character")
        
        if errors:
            return False, " ".join(errors)
        
        return True, "Password is strong"


def generate_secure_token(length: int = 32) -> str:
    """
    Generate a cryptographically secure random token
    
    Args:
        length: Length of token in bytes
        
    Returns:
        Hex-encoded random token
        
    Use for:
        - Password reset tokens
        - API tokens
        - Session tokens
    """
    import secrets
    return secrets.token_hex(length)


def hash_sensitive_identifier(identifier: str) -> str:
    """
    One-way hash for sensitive identifiers (SSN, badge numbers, etc.)
    Use when you need to search/match but don't need original value
    
    Args:
        identifier: Sensitive identifier
        
    Returns:
        SHA256 hash of identifier
        
    Example:
        # Store hashed SSN for duplicate checking
        ssn_hash = hash_sensitive_identifier(ssn)
        # Can check if SSN exists without storing actual SSN
    """
    return hashlib.sha256(identifier.encode()).hexdigest()

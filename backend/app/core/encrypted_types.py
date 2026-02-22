"""
Encrypted SQLAlchemy Column Types

Provides transparent AES-256 encryption/decryption for sensitive database fields.
Uses the existing Fernet cipher from security.py.

When data is written through the ORM, it is encrypted before hitting the database.
When data is read, it is decrypted transparently. Existing plaintext data is handled
gracefully — if decryption fails, the raw value is returned (backward compatibility
during migration).
"""

from sqlalchemy import Text
from sqlalchemy.types import TypeDecorator
from cryptography.fernet import InvalidToken


class EncryptedText(TypeDecorator):
    """
    A Text column that transparently encrypts on write and decrypts on read.

    Uses AES-256 (Fernet) encryption from app.core.security.
    Backward-compatible: if a stored value can't be decrypted (i.e. it's
    legacy plaintext), it is returned as-is.
    """

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        """Encrypt value before storing in database."""
        if value is not None and value != '':
            from app.core.security import encrypt_data
            return encrypt_data(value)
        return value

    def process_result_value(self, value, dialect):
        """Decrypt value when reading from database."""
        if value is not None and value != '':
            try:
                from app.core.security import decrypt_data
                return decrypt_data(value)
            except (InvalidToken, Exception):
                # Backward compatibility: return plaintext if not yet encrypted
                return value
        return value

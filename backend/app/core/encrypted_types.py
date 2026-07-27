"""
Encrypted SQLAlchemy Column Types

Provides transparent authenticated encryption/decryption for sensitive database
fields using AES-256-GCM (via app.core.security). Legacy Fernet-encrypted values
are still decrypted transparently.

When data is written through the ORM, it is encrypted before hitting the database.
When data is read, it is decrypted transparently. Existing plaintext data is handled
gracefully — if decryption fails because the stored value is legacy plaintext
(InvalidToken), the raw value is returned (backward compatibility during migration).
A genuine AES-256-GCM authentication failure raises InvalidTag (not caught here),
so tampered ciphertext fails closed rather than returning unverified bytes.
"""

from cryptography.fernet import InvalidToken
from sqlalchemy import Text
from sqlalchemy.types import TypeDecorator


class EncryptedText(TypeDecorator):
    """
    A Text column that transparently encrypts on write and decrypts on read.

    Uses AES-256-GCM authenticated encryption from app.core.security (legacy
    Fernet values remain readable). Backward-compatible: if a stored value can't
    be decrypted because it is legacy plaintext (InvalidToken), it is returned
    as-is.
    """

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        """Encrypt value before storing in database."""
        if value is not None and value != "":
            from app.core.security import encrypt_data

            return encrypt_data(value)
        return value

    def process_result_value(self, value, dialect):
        """Decrypt value when reading from database."""
        if value is not None and value != "":
            try:
                from app.core.security import decrypt_data

                return decrypt_data(value)
            except InvalidToken:
                # Backward compatibility: a stored value that isn't a valid
                # Fernet token is legacy plaintext — return it as-is. Only
                # InvalidToken is swallowed; a genuine error (missing key,
                # programming bug) now propagates instead of silently serving
                # ciphertext as if it were plaintext.
                return value
        return value

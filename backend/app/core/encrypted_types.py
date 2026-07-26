"""
Encrypted SQLAlchemy Column Types

Provides transparent authenticated encryption/decryption for sensitive database
fields using the Fernet cipher from security.py (AES-128-CBC + HMAC-SHA256).

When data is written through the ORM, it is encrypted before hitting the database.
When data is read, it is decrypted transparently. Existing plaintext data is handled
gracefully — if decryption fails because the stored value is legacy plaintext
(InvalidToken), the raw value is returned (backward compatibility during migration).
"""

from cryptography.fernet import InvalidToken
from sqlalchemy import Text
from sqlalchemy.types import TypeDecorator


class EncryptedText(TypeDecorator):
    """
    A Text column that transparently encrypts on write and decrypts on read.

    Uses Fernet (AES-128-CBC + HMAC-SHA256) authenticated encryption from
    app.core.security. Backward-compatible: if a stored value can't be
    decrypted because it is legacy plaintext (InvalidToken), it is returned
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

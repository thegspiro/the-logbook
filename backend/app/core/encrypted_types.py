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

import json

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


class EncryptedJSON(TypeDecorator):
    """A JSON-valued column stored as an encrypted TEXT string.

    Same transparent-encryption contract as ``EncryptedText`` (AES-256-GCM on
    write, decrypt-or-legacy on read), but the Python value is any JSON-able
    object: it is ``json.dumps``'d before encryption and ``json.loads``'d after
    decryption. Backward compatibility spans two legacy shapes a column
    migrated from ``JSON`` to this type can hold:

    - a value that decrypts cleanly → parse the JSON payload, or
    - a legacy plaintext value (``InvalidToken``) — after a ``JSON``→``TEXT``
      column alter, an existing row is the JSON *text* representation, so it is
      parsed with ``json.loads`` too (falling back to the raw string only if it
      isn't valid JSON).

    Only ``InvalidToken`` is swallowed on the decrypt step; a genuine crypto
    error still propagates (fail closed, matching ``EncryptedText``).
    """

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        from app.core.security import encrypt_data

        return encrypt_data(json.dumps(value))

    def process_result_value(self, value, dialect):
        if value is None or value == "":
            return value
        from app.core.security import decrypt_data

        try:
            payload = decrypt_data(value)
        except InvalidToken:
            # Legacy plaintext (pre-encryption row, now TEXT). It is the JSON
            # text representation of the old JSON column value.
            payload = value
        try:
            return json.loads(payload)
        except (ValueError, TypeError):
            # Not valid JSON (shouldn't happen for well-formed rows) — return
            # the raw decrypted string rather than raising during a read.
            return payload

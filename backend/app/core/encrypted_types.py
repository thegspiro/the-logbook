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
from datetime import date, datetime

from cryptography.fernet import InvalidToken
from sqlalchemy import Text, event
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


class EncryptedDate(TypeDecorator):
    """A calendar date stored as encrypted ISO-8601 TEXT.

    The Python value is a ``datetime.date`` on both sides, so callers, schemas
    and exports are unchanged by the move from a ``DATE`` column. The database
    can no longer compare, sort or range-filter the column: the ciphertext is
    different every time a value is written. Match on another column in SQL and
    compare the decrypted date in Python.

    A row left over from the ``DATE`` column reads back as its ``YYYY-MM-DD``
    text (``InvalidToken`` on decrypt), so the application keeps working before
    the migration's backfill has encrypted it. Anything else that fails to
    decrypt propagates, as for ``EncryptedText``.
    """

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None or value == "":
            return None
        from app.core.security import encrypt_data

        if isinstance(value, datetime):
            value = value.date()
        if isinstance(value, str):
            try:
                value = date.fromisoformat(value.strip())
            except ValueError:
                # Deliberately without the value: a date of birth must not end up
                # in an exception message and from there in a log.
                raise ValueError(
                    "EncryptedDate takes a date or an ISO date string (YYYY-MM-DD)"
                ) from None
        if not isinstance(value, date):
            raise ValueError(
                "EncryptedDate takes a date or an ISO date string, "
                f"not {type(value).__name__}"
            )
        return encrypt_data(value.isoformat())

    def process_result_value(self, value, dialect):
        if value is None or value == "":
            return None
        from app.core.security import decrypt_data

        try:
            plain = decrypt_data(value)
        except InvalidToken:
            plain = value
        return date.fromisoformat(plain.strip()[:10])


def keep_email_fingerprint(email_attribute, fingerprint_name: str) -> None:
    """Recompute ``fingerprint_name`` whenever the email attribute is assigned.

    The fingerprint is what SQL matches on once the email is ciphertext, so it
    has to change with every ORM write of the address, including the one in
    the constructor. A bulk ``update().values(email=...)`` bypasses attribute
    events and must set the fingerprint itself.
    """

    @event.listens_for(email_attribute, "set")
    def _refresh(target, value, _oldvalue, _initiator):
        from app.core.security import email_fingerprint

        setattr(target, fingerprint_name, email_fingerprint(value))

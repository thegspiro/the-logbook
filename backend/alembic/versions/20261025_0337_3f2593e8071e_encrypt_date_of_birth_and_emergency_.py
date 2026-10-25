"""Encrypt date of birth and emergency contacts at rest

``users.date_of_birth`` and ``prospective_members.date_of_birth`` held a
member's or applicant's date of birth as a plain ``DATE``; ``users.emergency_contacts``
held the name, relationship, phone and email of people who are not members as
plain ``JSON``. They are now stored as AES-256-GCM ciphertext through the
``EncryptedDate`` / ``EncryptedJSON`` column types.

Ciphertext is neither a date nor valid JSON, so the three columns become
``TEXT`` first, and then every existing row is encrypted in place:

- a date reads back from the altered column as ``YYYY-MM-DD`` text and is
  encrypted as that text, which is what ``EncryptedDate`` decrypts and parses;
- a contact list reads back as its JSON text and is encrypted as that text,
  which is what ``EncryptedJSON`` decrypts and ``json.loads``.

The backfill is part of the upgrade rather than left to encrypt-on-next-write:
without it the existing values stay readable in the database until each record
is edited. Both steps are safe to run twice. Altering a column that is already ``TEXT``
changes nothing, and a value that already carries the ciphertext prefix is not
encrypted again.

When there are rows to encrypt, ``ENCRYPTION_KEY`` must be set, as it must be
for the backend to start; the migration refuses to run without it rather than
writing ciphertext nobody can read back. An empty database needs no key.

Not searchable afterwards: nothing in the application queried either column in
SQL except the applicant self-match in ``app/api/prospect_privacy.py``, which
now compares the date in Python.

The downgrade decrypts every value and restores ``DATE`` / ``JSON``. A date
that is not valid ISO text, or a contact list that is not valid JSON, stops it
rather than being replaced.

Revision ID: 3f2593e8071e
Revises: 3d67883cd461
Create Date: 2026-10-25 03:37:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "3f2593e8071e"
down_revision: Union[str, None] = "3d67883cd461"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (table, column, type before, type after)
_COLUMNS = [
    ("users", "date_of_birth", sa.Date(), sa.Text()),
    ("users", "emergency_contacts", sa.JSON(), sa.Text()),
    ("prospective_members", "date_of_birth", sa.Date(), sa.Text()),
]

# Frozen on purpose: a migration must keep transforming rows the way it did the
# day it ran, so it does not import the application's prefix constant.
_CIPHERTEXT_PREFIXES = ("$gcm1$", "$gcm2$")


def _is_ciphertext(value: str) -> bool:
    return value.startswith(_CIPHERTEXT_PREFIXES)


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return False
    return column in {c["name"] for c in inspector.get_columns(table)}


def _require_key() -> None:
    from app.core.config import settings

    if not settings.ENCRYPTION_KEY:
        raise RuntimeError(
            "ENCRYPTION_KEY must be set to encrypt date of birth and emergency "
            "contacts; refusing to write ciphertext that cannot be read back."
        )


def _rewrite(table: str, column: str, convert) -> int:
    """Apply ``convert`` to every non-empty value; return how many changed."""
    conn = op.get_bind()
    rows = conn.execute(
        sa.text(f"SELECT id, {column} FROM {table} WHERE {column} IS NOT NULL")
    ).fetchall()
    changed = 0
    for row_id, value in rows:
        if value is None or str(value).strip() == "":
            continue
        new_value = convert(str(value))
        if new_value is None or new_value == value:
            continue
        conn.execute(
            sa.text(f"UPDATE {table} SET {column} = :value WHERE id = :id"),
            {"value": new_value, "id": row_id},
        )
        changed += 1
    return changed


def upgrade() -> None:
    from app.core.security import encrypt_data

    def encrypt_plain(value: str):
        if _is_ciphertext(value):
            return None
        _require_key()
        return encrypt_data(value.strip())

    for table, column, _before, after in _COLUMNS:
        if not _has_column(table, column):
            continue
        # Altered unconditionally: on MariaDB a JSON column reflects as
        # LONGTEXT, so the type cannot say whether its json_valid() check (which
        # would reject ciphertext) is still attached. Converting to TEXT is a
        # no-op on a column that already is one.
        op.alter_column(
            table,
            column,
            existing_type=_before,
            type_=after,
            existing_nullable=True,
        )
        _rewrite(table, column, encrypt_plain)


def downgrade() -> None:
    from app.core.security import decrypt_data

    def decrypt_value(value: str):
        return decrypt_data(value) if _is_ciphertext(value) else None

    for table, column, before, after in reversed(_COLUMNS):
        if not _has_column(table, column):
            continue
        _rewrite(table, column, decrypt_value)
        op.alter_column(
            table,
            column,
            existing_type=after,
            type_=before,
            existing_nullable=True,
        )

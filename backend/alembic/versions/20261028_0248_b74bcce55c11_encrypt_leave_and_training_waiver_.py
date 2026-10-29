"""Encrypt leave and training-waiver reasons at rest

``member_leaves_of_absence.reason`` and ``training_waivers.reason`` hold what a
member told an officer about why they cannot take part: a leave of absence, or a
``medical`` waiver. In practice that is a diagnosis, a treatment, a family
illness or a deployment, in the member's own words. They were plaintext. They
are now stored as AES-256-GCM ciphertext through the transparent
``EncryptedText`` column type, like the screening-record notes.

Both columns are already ``TEXT``, so there is no column change: this migration
only encrypts the rows that exist. It is safe to run twice, because a value that
already carries the ciphertext prefix is not encrypted again. A value that is
NULL, empty or only whitespace is left exactly as it is, so the ``IS NULL``
checks that treat "has a reason" as "has a waiver" keep their meaning.

When there are rows to encrypt ``ENCRYPTION_KEY`` must be set, as it must be for
the backend to start; the migration refuses to run without it rather than
writing ciphertext nobody can read back. An empty database needs no key.

Nothing in the application filters, sorts or searches either column in SQL, so
nothing about reading them changes.

The downgrade decrypts every value back to plaintext.

Revision ID: b74bcce55c11
Revises: 0d9897752425
Create Date: 2026-10-28 02:48:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b74bcce55c11"
down_revision: Union[str, None] = "0d9897752425"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = [
    ("member_leaves_of_absence", "reason"),
    ("training_waivers", "reason"),
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
            "ENCRYPTION_KEY must be set to encrypt leave and waiver reasons; "
            "refusing to write ciphertext that cannot be read back."
        )


def _rewrite(table: str, column: str, convert) -> int:
    """Apply ``convert`` to every non-blank value; return how many changed."""
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
        return encrypt_data(value)

    for table, column in _COLUMNS:
        if _has_column(table, column):
            _rewrite(table, column, encrypt_plain)


def downgrade() -> None:
    from app.core.security import decrypt_data

    def decrypt_value(value: str):
        return decrypt_data(value) if _is_ciphertext(value) else None

    for table, column in reversed(_COLUMNS):
        if _has_column(table, column):
            _rewrite(table, column, decrypt_value)

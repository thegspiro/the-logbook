"""Encrypt the status of a screening record at rest (MS-15)

``screening_records.status`` says how a fitness-for-duty screening came out.
The provider, results and notes beside it were already AES-256-GCM ciphertext
(MS-1), but the status was a plain ENUM, so a database dump or backup still
read "this member — physical — failed". It is now stored through the
``EncryptedEnum`` column type (owner decision 2026-11-04). The screening type,
the dates and the member link stay plaintext for now.

Steps, in this order because each needs the one before:

1. Drop ``idx_screening_rec_status`` on ``(organization_id, status)``. MySQL
   cannot index a TEXT column without a prefix length, and an index on
   ciphertext answers nothing anyway: the same status encrypts differently on
   every write. The application no longer filters on the column in SQL.
2. Convert the column from the ENUM to ``TEXT NOT NULL`` and drop its
   ``'scheduled'`` server default, which would be plaintext. The ORM always
   supplies the value.
3. Encrypt every existing value in place. Safe to run twice: a value that
   already carries the ciphertext prefix is left alone. A legacy member name
   (``PASSED``) is written as its value (``passed``) before encrypting, so it
   reads back as the same status. When there are rows to encrypt,
   ``ENCRYPTION_KEY`` must be set; the migration refuses to run without it
   rather than writing ciphertext nobody can read back. An empty table needs
   no key.

Effect on an upgraded installation: every screening keeps its status, and the
screens that showed it show the same thing. Database backups taken before the
upgrade still hold the statuses in plaintext.

The downgrade decrypts every value, restores the ENUM with its default, and
recreates the index.

Revision ID: 80fa2c83bf9d
Revises: 41ebaa6317e8
Create Date: 2026-11-05 12:02:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "80fa2c83bf9d"
down_revision: Union[str, None] = "41ebaa6317e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "screening_records"
_COLUMN = "status"
_INDEX = "idx_screening_rec_status"

# Frozen on purpose: a migration must keep transforming rows the way it did the
# day it ran, so it does not import the application's enum or prefix constant.
_VALUES = (
    "scheduled",
    "completed",
    "passed",
    "failed",
    "pending_review",
    "waived",
    "expired",
)
_CIPHERTEXT_PREFIXES = ("$gcm1$", "$gcm2$")


def _enum() -> sa.Enum:
    return sa.Enum(*_VALUES, name="screening_status_enum")


def _is_ciphertext(value: str) -> bool:
    return value.startswith(_CIPHERTEXT_PREFIXES)


def _inspector():
    return sa.inspect(op.get_bind())


def _has_column() -> bool:
    inspector = _inspector()
    if _TABLE not in inspector.get_table_names():
        return False
    return _COLUMN in {c["name"] for c in inspector.get_columns(_TABLE)}


def _has_index() -> bool:
    return _INDEX in {i["name"] for i in _inspector().get_indexes(_TABLE)}


def _require_key() -> None:
    from app.core.config import settings

    if not settings.ENCRYPTION_KEY:
        raise RuntimeError(
            "ENCRYPTION_KEY must be set to encrypt screening statuses; "
            "refusing to write ciphertext that cannot be read back."
        )


def _rewrite(convert) -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text(f"SELECT id, {_COLUMN} FROM {_TABLE}")  # nosec B608 - constants
    ).fetchall()
    for row_id, value in rows:
        if value is None or str(value).strip() == "":
            continue
        new_value = convert(str(value))
        if new_value is None or new_value == value:
            continue
        conn.execute(
            sa.text(
                f"UPDATE {_TABLE} SET {_COLUMN} = :value WHERE id = :id"  # nosec B608
            ),
            {"value": new_value, "id": row_id},
        )


def upgrade() -> None:
    if not _has_column():
        return
    from app.core.security import encrypt_data

    if _has_index():
        op.drop_index(_INDEX, table_name=_TABLE)
    op.alter_column(
        _TABLE,
        _COLUMN,
        existing_type=_enum(),
        type_=sa.Text(),
        existing_nullable=False,
        nullable=False,
        existing_server_default="scheduled",
        server_default=None,
    )

    def encrypt_plain(value: str):
        if _is_ciphertext(value):
            return None
        plain = value.strip()
        if plain not in _VALUES and plain.lower() in _VALUES:
            plain = plain.lower()
        _require_key()
        return encrypt_data(plain)

    _rewrite(encrypt_plain)


def downgrade() -> None:
    if not _has_column():
        return
    from app.core.security import decrypt_data

    def decrypt_value(value: str):
        return decrypt_data(value) if _is_ciphertext(value) else None

    _rewrite(decrypt_value)
    op.alter_column(
        _TABLE,
        _COLUMN,
        existing_type=sa.Text(),
        type_=_enum(),
        existing_nullable=False,
        nullable=False,
        server_default="scheduled",
    )
    if not _has_index():
        op.create_index(_INDEX, _TABLE, ["organization_id", _COLUMN])

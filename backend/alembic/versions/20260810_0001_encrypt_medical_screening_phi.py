"""Encrypt medical-screening PHI at rest (MS-1)

Screening records carry protected health information: the examining provider's
name, a free-text result summary, structured result data (scores/measurements),
and reviewer notes. These were stored in plaintext. They are now encrypted at
rest via the transparent ``EncryptedText`` / ``EncryptedJSON`` column types.

Two of the columns need a type change before the data can be encrypted:

- ``provider_name`` was ``VARCHAR(255)``; AES-256-GCM ciphertext (base64, with a
  version marker) is far longer than 255 chars, so it is widened to ``TEXT``.
- ``result_data`` was a native ``JSON`` column; ciphertext is not valid JSON, so
  it is converted to ``TEXT`` (the encrypted types serialize JSON to a string
  before encrypting).

``result_summary`` and ``notes`` are already ``TEXT`` and need no type change.

The column alters run first (a plaintext value must fit / be storable before it
is overwritten with ciphertext), then existing rows are encrypted in place.
Because ``EncryptedText``/``EncryptedJSON`` return legacy plaintext untouched on
an ``InvalidToken`` read, the application keeps working whether or not this
backfill has run — but the backfill is what actually protects the *existing*
PHI, so it is part of the upgrade rather than left to encrypt-on-next-write.

Revision ID: 20260810_0001
Revises: 20260809_0001
Create Date: 2026-08-10 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260810_0001"
down_revision = "20260809_0001"
branch_labels = None
depends_on = None

# Free-text/identity PHI columns — plaintext string in, ciphertext out.
_TEXT_FIELDS = ["provider_name", "result_summary", "notes"]
# Structured PHI — stored as the JSON *text* after the column alter.
_JSON_FIELD = "result_data"


def upgrade() -> None:
    # 1. Widen/convert the columns so ciphertext fits and is storable.
    op.alter_column(
        "screening_records",
        "provider_name",
        existing_type=sa.String(length=255),
        type_=sa.Text(),
        existing_nullable=True,
    )
    op.alter_column(
        "screening_records",
        "result_data",
        existing_type=sa.JSON(),
        type_=sa.Text(),
        existing_nullable=True,
    )

    # 2. Encrypt existing plaintext values in place.
    from app.core.security import encrypt_data

    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            "SELECT id, provider_name, result_summary, notes, result_data "
            "FROM screening_records"
        )
    ).fetchall()

    for row in rows:
        m = row._mapping
        updates = {}
        for field in _TEXT_FIELDS:
            value = m.get(field)
            if value is not None and str(value).strip():
                updates[field] = encrypt_data(value)
        # result_data is now TEXT holding the JSON string representation; encrypt
        # that text directly so an EncryptedJSON read decrypts then json.loads it.
        json_value = m.get(_JSON_FIELD)
        if json_value is not None and str(json_value).strip():
            updates[_JSON_FIELD] = encrypt_data(str(json_value))

        if updates:
            set_clause = ", ".join(f"{k} = :{k}" for k in updates)
            updates["id"] = m.get("id")
            conn.execute(
                sa.text(f"UPDATE screening_records SET {set_clause} WHERE id = :id"),
                updates,
            )


def downgrade() -> None:
    # 1. Decrypt values back to plaintext (best-effort; already-plaintext rows
    #    raise InvalidToken and are left as-is).
    from cryptography.fernet import InvalidToken

    from app.core.security import decrypt_data

    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            "SELECT id, provider_name, result_summary, notes, result_data "
            "FROM screening_records"
        )
    ).fetchall()

    for row in rows:
        m = row._mapping
        updates = {}
        for field in _TEXT_FIELDS + [_JSON_FIELD]:
            value = m.get(field)
            if value is not None and str(value).strip():
                try:
                    updates[field] = decrypt_data(value)
                except InvalidToken:
                    pass  # already plaintext

        if updates:
            set_clause = ", ".join(f"{k} = :{k}" for k in updates)
            updates["id"] = m.get("id")
            conn.execute(
                sa.text(f"UPDATE screening_records SET {set_clause} WHERE id = :id"),
                updates,
            )

    # 2. Restore the original column types.
    op.alter_column(
        "screening_records",
        "result_data",
        existing_type=sa.Text(),
        type_=sa.JSON(),
        existing_nullable=True,
    )
    op.alter_column(
        "screening_records",
        "provider_name",
        existing_type=sa.Text(),
        type_=sa.String(length=255),
        existing_nullable=True,
    )

"""Widen users.mfa_secret to VARCHAR(255) so the ciphertext fits

``users.mfa_secret`` does not hold a TOTP secret — it holds the *encrypted*
form of one. ``User._mfa_secret_encrypted`` maps the column and the
``mfa_secret`` hybrid property runs it through ``encrypt_data`` /
``decrypt_data``.

The initial schema (20260118_0001) created the column as ``VARCHAR(32)``,
sized for a raw base32 TOTP secret. The AES ciphertext is several times that.
On any database built from this chain, enrolling in MFA truncates the
ciphertext at 32 characters and it can never be decrypted again — the write
itself does not error under a non-strict ``sql_mode``, so the failure only
surfaces later as an account that cannot complete MFA.

The model has said ``String(255)`` for some time, so fresh installs built by
``create_all()`` are already correct; startup schema repair could not fix the
older databases because ``_add_missing_model_columns()`` only ever adds
missing columns, never alters existing ones.

Widening is non-destructive. Secrets already truncated stay truncated — they
were unrecoverable the moment they were written — so affected members must
re-enrol in MFA.

Revision ID: 20260805_0011
Revises: 20260805_0010
Create Date: 2026-08-05 00:00:00.000000

"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260805_0011"
down_revision = "20260805_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("users"):
        return
    if "mfa_secret" not in {c["name"] for c in inspector.get_columns("users")}:
        return

    op.alter_column(
        "users",
        "mfa_secret",
        existing_type=sa.String(32),
        type_=sa.String(255),
        existing_nullable=True,
    )


def downgrade() -> None:
    # Narrowing back to 32 would truncate every stored ciphertext and
    # permanently break MFA for every enrolled member.
    pass

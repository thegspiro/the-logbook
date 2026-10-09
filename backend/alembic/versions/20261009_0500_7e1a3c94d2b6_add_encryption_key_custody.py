"""Record administrators' confirmation that the encryption key is kept safe.

Revision ID: 7e1a3c94d2b6
Revises: c0bf0b155719
Create Date: 2026-10-09 05:00:00.000000

Stored files are now encrypted with a key derived from ENCRYPTION_KEY
(docs/FILE_STORAGE_HARDENING.md decision 23). Lose that key and every file
and encrypted field is gone; keep it beside the backups and the backups are
readable by whoever takes them. One row per key fingerprint records that an
administrator confirmed it is stored separately (decision 25). New table, no
existing data touched; downgrade drops it.
"""

import sqlalchemy as sa
from alembic import op

revision = "7e1a3c94d2b6"
down_revision = "c0bf0b155719"
branch_labels = None
depends_on = None

_TABLE = "encryption_key_custody"


def _exists() -> bool:
    return _TABLE in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _exists():
        return
    op.create_table(
        _TABLE,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("key_fingerprint", sa.String(16), nullable=False),
        sa.Column(
            "confirmed_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("confirmed_via", sa.String(20), nullable=False),
        sa.Column(
            "confirmed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("key_fingerprint", name="uq_encryption_key_custody_key"),
    )


def downgrade() -> None:
    if _exists():
        op.drop_table(_TABLE)

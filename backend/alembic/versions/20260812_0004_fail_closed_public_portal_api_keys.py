"""Fail closed for API-key expirations lost by the legacy conversion.

Revision ID: 20260812_0004
Revises: 20260812_0003
Create Date: 2026-08-12 00:00:00.000000

The historical ``20260805_0004`` migration converted malformed expiration
strings to NULL. That erased the distinction between a deliberately
non-expiring key and a key whose expiration failed conversion. Since the
original value cannot be reconstructed, expire every existing NULL-expiration
key now. Administrators can explicitly issue a replacement non-expiring key
after the upgrade when that is their intended policy.
"""

import sqlalchemy as sa
from alembic import op

revision = "20260812_0004"
down_revision = "20260812_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "public_portal_api_keys" not in inspector.get_table_names():
        return

    columns = {
        column["name"] for column in inspector.get_columns("public_portal_api_keys")
    }
    if "expires_at" not in columns:
        return

    op.execute(
        sa.text(
            "UPDATE public_portal_api_keys "
            "SET expires_at = UTC_TIMESTAMP(6) "
            "WHERE expires_at IS NULL"
        )
    )


def downgrade() -> None:
    # Expiration provenance was already lost by the historical migration, so
    # restoring NULL here would incorrectly make compromised keys permanent.
    pass

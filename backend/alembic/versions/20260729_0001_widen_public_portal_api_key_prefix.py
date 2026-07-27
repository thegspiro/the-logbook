"""Widen public_portal_api_keys.key_prefix for a selective lookup prefix

Public-portal API keys stored only an 8-char key_prefix, which was always the
constant "logbook_" marker (the first 8 chars of every key). A by-prefix lookup
during authentication therefore returned EVERY key and forced a bcrypt verify
against each one per request — a CPU-exhaustion surface (PP-4). New keys now
store a selective 16-char prefix ("logbook_" + 8 key chars), and legacy keys
self-heal to it on next use, so the column must hold up to 16 chars. Widen to
String(20) for headroom. Existing "logbook_" values are unaffected (widening
only).

Revision ID: 20260729_0001
Revises: 20260728_0001
Create Date: 2026-07-26 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260729_0001"
down_revision = "20260728_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "public_portal_api_keys",
        "key_prefix",
        existing_type=sa.String(length=8),
        type_=sa.String(length=20),
        existing_nullable=False,
    )


def downgrade() -> None:
    # Truncate any selective (16-char) prefixes back to the legacy 8-char marker
    # so the values fit the narrower column again.
    op.execute(
        sa.text(
            "UPDATE public_portal_api_keys "
            "SET key_prefix = LEFT(key_prefix, 8) "
            "WHERE CHAR_LENGTH(key_prefix) > 8"
        )
    )
    op.alter_column(
        "public_portal_api_keys",
        "key_prefix",
        existing_type=sa.String(length=20),
        type_=sa.String(length=8),
        existing_nullable=False,
    )

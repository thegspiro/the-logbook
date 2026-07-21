"""Add refresh-token rotation grace columns to sessions

Tracks the immediately-previous refresh token (and its short expiry) so two
concurrent legitimate refreshes don't look like token theft and trigger a
mass session revocation.

Revision ID: 20260727_0001
Revises: 20260726_0001
Create Date: 2026-07-21 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260727_0001"
down_revision = "20260726_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sessions",
        sa.Column("previous_refresh_token", sa.String(length=512), nullable=True),
    )
    op.add_column(
        "sessions",
        sa.Column(
            "previous_refresh_expires_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_sessions_previous_refresh_token",
        "sessions",
        ["previous_refresh_token"],
    )


def downgrade() -> None:
    op.drop_index("ix_sessions_previous_refresh_token", table_name="sessions")
    op.drop_column("sessions", "previous_refresh_expires_at")
    op.drop_column("sessions", "previous_refresh_token")

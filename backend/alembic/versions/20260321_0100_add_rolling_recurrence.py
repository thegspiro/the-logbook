"""Add rolling_recurrence column to events table

Enables recurring event series to auto-extend on a rolling 12-month window
instead of requiring a fixed end date.

Revision ID: 20260321_0100
Revises: 20260319_0100
Create Date: 2026-03-21 01:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "20260321_0100"
down_revision = "20260319_0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column(
            "rolling_recurrence",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )


def downgrade() -> None:
    op.drop_column("events", "rolling_recurrence")

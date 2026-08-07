"""Add election lifecycle-automation fields

Adds the columns behind the election_lifecycle scheduled task and the
remind-non-voters feature:

- auto_open: opt-in flag — the task auto-opens a DRAFT election at its
  start_date only when the creator explicitly enabled it.
- reminder_hours_before_close: NULL = no automatic reminder; otherwise the
  task reminds non-voters once this many hours before end_date.
- reminder_sent_at: stamps the (manual or automatic) reminder so the
  automatic one fires at most once.

Revision ID: 20260801_0004
Revises: 20260801_0003
Create Date: 2026-08-01 00:04:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "20260801_0004"
down_revision = "20260801_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "elections",
        sa.Column(
            "auto_open",
            sa.Boolean(),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "elections",
        sa.Column("reminder_hours_before_close", sa.Integer(), nullable=True),
    )
    op.add_column(
        "elections",
        sa.Column("reminder_sent_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("elections", "reminder_sent_at")
    op.drop_column("elections", "reminder_hours_before_close")
    op.drop_column("elections", "auto_open")

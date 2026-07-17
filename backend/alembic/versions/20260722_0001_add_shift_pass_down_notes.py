"""Add shift pass-down (crew handoff) notes

Captured at finalization and surfaced to the next crew on the same apparatus.

Revision ID: 20260722_0001
Revises: 20260721_0001
Create Date: 2026-07-16 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260722_0001"
down_revision = "20260721_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "shifts",
        sa.Column("pass_down_notes", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("shifts", "pass_down_notes")

"""Add data_sources column to shift_completion_reports

Tracks which fields were auto-populated from system records (e.g.
ShiftAttendance, ShiftCall) vs manually entered by the officer, for
audit trail purposes.

Revision ID: 20260328_0200
Revises: 20260328_0100
Create Date: 2026-03-28
"""

from alembic import op
import sqlalchemy as sa


revision = "20260328_0200"
down_revision = "20260328_0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "shift_completion_reports",
        sa.Column("data_sources", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("shift_completion_reports", "data_sources")

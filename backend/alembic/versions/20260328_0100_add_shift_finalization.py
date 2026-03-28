"""Add finalization, summary columns to shifts, and per-member call_count

Adds shift-level call_count and total_hours for summaries, finalization
fields (is_finalized, finalized_at, finalized_by), and a per-member
call_count on shift_attendance so each member's call count is tracked.

Revision ID: 20260328_0100
Revises: 20260326_0100
Create Date: 2026-03-28
"""

from alembic import op
import sqlalchemy as sa


revision = "20260328_0100"
down_revision = "20260326_0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "shifts",
        sa.Column("call_count", sa.Integer(), nullable=True),
    )
    op.add_column(
        "shifts",
        sa.Column("total_hours", sa.Float(), nullable=True),
    )
    op.add_column(
        "shifts",
        sa.Column(
            "is_finalized",
            sa.Boolean(),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "shifts",
        sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "shifts",
        sa.Column(
            "finalized_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "shift_attendance",
        sa.Column("call_count", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("shift_attendance", "call_count")
    op.drop_column("shifts", "finalized_by")
    op.drop_column("shifts", "finalized_at")
    op.drop_column("shifts", "is_finalized")
    op.drop_column("shifts", "total_hours")
    op.drop_column("shifts", "call_count")

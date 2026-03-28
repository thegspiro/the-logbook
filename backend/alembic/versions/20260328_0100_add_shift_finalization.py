"""Add finalization columns to shifts table

Adds is_finalized, finalized_at, and finalized_by so shift officers
can formally close a shift after validating attendance and checklists.

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


def downgrade() -> None:
    op.drop_column("shifts", "finalized_by")
    op.drop_column("shifts", "finalized_at")
    op.drop_column("shifts", "is_finalized")

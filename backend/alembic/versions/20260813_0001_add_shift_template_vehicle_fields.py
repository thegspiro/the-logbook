"""Add the vehicle categorization fields used by shift templates.

Revision ID: 20260813_0001
Revises: 20260812_0004
Create Date: 2026-08-13 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "20260813_0001"
down_revision = "20260812_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "shift_templates",
        sa.Column("category", sa.String(20), nullable=True, server_default="standard"),
    )
    op.add_column(
        "shift_templates", sa.Column("apparatus_type", sa.String(50), nullable=True)
    )
    op.add_column(
        "shift_templates", sa.Column("apparatus_id", sa.String(36), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("shift_templates", "apparatus_id")
    op.drop_column("shift_templates", "apparatus_type")
    op.drop_column("shift_templates", "category")

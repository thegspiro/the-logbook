"""Add metadata JSON column to notification_logs

Stores structured data (e.g. shift_start_time) alongside notifications
so the frontend can render context-aware UI elements.

Revision ID: 20260326_0100
Revises: 20260325_0200
Create Date: 2026-03-26
"""

from alembic import op
import sqlalchemy as sa


revision = "20260326_0100"
down_revision = "20260325_0200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "notification_logs",
        sa.Column("metadata", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("notification_logs", "metadata")

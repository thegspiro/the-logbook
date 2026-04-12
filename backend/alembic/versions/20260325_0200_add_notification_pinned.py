"""Add pinned column to notification_logs

Allows users to pin notifications so they remain visually prominent
even after being marked as read.

Revision ID: 20260325_0200
Revises: 20260325_0100, 20260323_0100, b7c8d9e0f1a2
Create Date: 2026-03-25
"""

from alembic import op
import sqlalchemy as sa


revision = "20260325_0200"
down_revision = "20260325_0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "notification_logs",
        sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.text("0")),
    )


def downgrade() -> None:
    op.drop_column("notification_logs", "pinned")

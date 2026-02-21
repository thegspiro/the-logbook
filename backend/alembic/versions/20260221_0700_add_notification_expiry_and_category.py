"""Add expires_at and category columns to notification_logs

Revision ID: 20260221_0700
Revises: 20260221_0600
Create Date: 2026-02-21 07:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20260221_0700"
down_revision: Union[str, None] = "20260221_0600"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "notification_logs",
        sa.Column("category", sa.String(50), nullable=True),
    )
    op.add_column(
        "notification_logs",
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("idx_notif_logs_category", "notification_logs", ["category"])
    op.create_index("idx_notif_logs_expires", "notification_logs", ["expires_at"])


def downgrade() -> None:
    op.drop_index("idx_notif_logs_expires", table_name="notification_logs")
    op.drop_index("idx_notif_logs_category", table_name="notification_logs")
    op.drop_column("notification_logs", "expires_at")
    op.drop_column("notification_logs", "category")

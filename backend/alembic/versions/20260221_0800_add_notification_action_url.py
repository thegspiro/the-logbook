"""Add action_url column to notification_logs

Revision ID: 20260221_0800
Revises: 20260221_0700
Create Date: 2026-02-21 08:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20260221_0800"
down_revision: Union[str, None] = "20260221_0700"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "notification_logs",
        sa.Column("action_url", sa.String(500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("notification_logs", "action_url")

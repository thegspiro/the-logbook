"""Track completion state for streamed finance exports.

Revision ID: f4a1c9d82e30
Revises: e2c8f5a71d40
"""

import sqlalchemy as sa
from alembic import op

revision = "f4a1c9d82e30"
down_revision = "e2c8f5a71d40"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "finance_export_logs",
        sa.Column("status", sa.String(20), nullable=False, server_default="successful"),
    )
    op.add_column(
        "finance_export_logs", sa.Column("error_message", sa.String(500), nullable=True)
    )
    op.add_column(
        "finance_export_logs",
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("finance_export_logs", "completed_at")
    op.drop_column("finance_export_logs", "error_message")
    op.drop_column("finance_export_logs", "status")

"""Add delivery-attempt tracking to inventory_notification_queue

Adds ``attempt_count`` and ``last_attempt_at`` columns so the inventory
notification scheduled task can stop retrying records that have exceeded
the delivery-attempt cap (e.g. when SMTP credentials are stale and every
send fails). Without this, failing records loop forever and produce a
recurring stream of warnings on every scheduler tick.

Revision ID: 20260502_0002
Revises: 20260502_0001
Create Date: 2026-05-02
"""

from alembic import op
import sqlalchemy as sa


revision = "20260502_0002"
down_revision = "20260502_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "inventory_notification_queue",
        sa.Column(
            "attempt_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "inventory_notification_queue",
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("inventory_notification_queue", "last_attempt_at")
    op.drop_column("inventory_notification_queue", "attempt_count")

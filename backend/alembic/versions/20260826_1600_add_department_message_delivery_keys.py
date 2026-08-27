"""Add idempotency records for department message delivery.

Revision ID: d4e5f6a7b8c9
Revises: c7e2b9a41f83
Create Date: 2026-08-26 16:00:00
"""

import sqlalchemy as sa
from alembic import op

revision = "d4e5f6a7b8c9"
down_revision = "c7e2b9a41f83"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "notification_logs",
        sa.Column("department_message_id", sa.String(length=36), nullable=True),
    )
    op.create_foreign_key(
        "fk_notification_logs_department_message",
        "notification_logs",
        "department_messages",
        ["department_message_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_unique_constraint(
        "uq_notif_dept_message_recipient_channel",
        "notification_logs",
        ["department_message_id", "recipient_id", "channel"],
    )
    op.create_table(
        "department_message_deliveries",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("message_id", sa.String(length=36), nullable=False),
        sa.Column("recipient_id", sa.String(length=36), nullable=False),
        sa.Column("channel", sa.String(length=16), nullable=False),
        sa.Column(
            "status", sa.String(length=16), server_default="pending", nullable=False
        ),
        sa.Column("idempotency_key", sa.String(length=255), nullable=False),
        sa.Column(
            "attempted_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["message_id"], ["department_messages.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["recipient_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("idempotency_key", name="uq_dept_msg_delivery_key"),
        sa.UniqueConstraint(
            "message_id",
            "recipient_id",
            "channel",
            name="uq_dept_msg_delivery_recipient_channel",
        ),
    )
    op.create_index(
        "idx_dept_msg_delivery_message", "department_message_deliveries", ["message_id"]
    )


def downgrade() -> None:
    op.drop_index(
        "idx_dept_msg_delivery_message", table_name="department_message_deliveries"
    )
    op.drop_table("department_message_deliveries")
    op.drop_constraint(
        "uq_notif_dept_message_recipient_channel", "notification_logs", type_="unique"
    )
    op.drop_constraint(
        "fk_notification_logs_department_message",
        "notification_logs",
        type_="foreignkey",
    )
    op.drop_column("notification_logs", "department_message_id")

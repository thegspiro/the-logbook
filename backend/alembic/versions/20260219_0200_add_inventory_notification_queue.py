"""Add inventory notification queue table

Revision ID: 20260219_0200
Revises: dc01a
Create Date: 2026-02-19
"""

from alembic import op
import sqlalchemy as sa

revision = "20260219_0200"
down_revision = "dc01a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "inventory_notification_queue",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "action_type",
            sa.Enum(
                "assigned", "unassigned", "issued", "returned",
                "checked_out", "checked_in",
                name="inventoryactiontype",
            ),
            nullable=False,
        ),
        sa.Column(
            "item_id",
            sa.String(36),
            sa.ForeignKey("inventory_items.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("item_name", sa.String(255), nullable=False),
        sa.Column("item_serial_number", sa.String(255), nullable=True),
        sa.Column("item_asset_tag", sa.String(255), nullable=True),
        sa.Column("quantity", sa.Integer, nullable=False, server_default="1"),
        sa.Column(
            "performed_by",
            sa.String(36),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column("processed", sa.Boolean, nullable=False, server_default="0"),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    op.create_index(
        "idx_inv_notif_queue_pending",
        "inventory_notification_queue",
        ["processed", "created_at"],
    )
    op.create_index(
        "idx_inv_notif_queue_org_user",
        "inventory_notification_queue",
        ["organization_id", "user_id"],
    )


def downgrade() -> None:
    op.drop_index("idx_inv_notif_queue_org_user", table_name="inventory_notification_queue")
    op.drop_index("idx_inv_notif_queue_pending", table_name="inventory_notification_queue")
    op.drop_table("inventory_notification_queue")
    op.execute("DROP TYPE IF EXISTS inventoryactiontype")

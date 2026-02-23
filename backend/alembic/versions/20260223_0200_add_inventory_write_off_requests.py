"""Add inventory write-off requests table

Creates the inventory_write_offs table for tracking write-off requests
with supervisor approval workflow.

Revision ID: 20260223_0200
Revises: 20260223_0100
Create Date: 2026-02-23 02:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "20260223_0200"
down_revision = "20260223_0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "inventory_write_offs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "item_id",
            sa.String(36),
            sa.ForeignKey("inventory_items.id", ondelete="SET NULL"),
        ),
        sa.Column("item_name", sa.String(255), nullable=False),
        sa.Column("item_serial_number", sa.String(255)),
        sa.Column("item_asset_tag", sa.String(255)),
        sa.Column("item_value", sa.Numeric(10, 2)),
        sa.Column("reason", sa.String(50), nullable=False, server_default="lost"),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column(
            "status",
            sa.Enum("pending", "approved", "denied", name="writeoffstatus"),
            nullable=False,
            server_default="pending",
            index=True,
        ),
        sa.Column(
            "requested_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=False,
        ),
        sa.Column(
            "reviewed_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
        ),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        sa.Column("review_notes", sa.Text),
        sa.Column(
            "clearance_id",
            sa.String(36),
            sa.ForeignKey("departure_clearances.id", ondelete="SET NULL"),
        ),
        sa.Column("clearance_item_id", sa.String(36)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "idx_write_off_org_status",
        "inventory_write_offs",
        ["organization_id", "status"],
    )
    op.create_index(
        "idx_write_off_item",
        "inventory_write_offs",
        ["item_id"],
    )


def downgrade() -> None:
    op.drop_index("idx_write_off_item", table_name="inventory_write_offs")
    op.drop_index("idx_write_off_org_status", table_name="inventory_write_offs")
    op.drop_table("inventory_write_offs")
    op.execute("DROP TYPE IF EXISTS writeoffstatus")

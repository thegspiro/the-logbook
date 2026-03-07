"""add reorder_point to inventory_items and reorder_requests table

Revision ID: 20260306_0501
Revises: 20260306_0500
Create Date: 2026-03-06 05:01:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260306_0501"
down_revision = "20260306_0500"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add reorder_point column to inventory_items
    op.add_column(
        "inventory_items",
        sa.Column("reorder_point", sa.Integer(), nullable=True),
    )

    # Create reorder_requests table
    op.create_table(
        "reorder_requests",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "item_id",
            sa.String(36),
            sa.ForeignKey("inventory_items.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "category_id",
            sa.String(36),
            sa.ForeignKey("inventory_categories.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("item_name", sa.String(255), nullable=False),
        sa.Column("quantity_requested", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("quantity_received", sa.Integer(), nullable=True),
        sa.Column("vendor", sa.String(255), nullable=True),
        sa.Column("vendor_contact", sa.String(255), nullable=True),
        sa.Column("estimated_unit_cost", sa.Numeric(10, 2), nullable=True),
        sa.Column("actual_unit_cost", sa.Numeric(10, 2), nullable=True),
        sa.Column("purchase_order_number", sa.String(255), nullable=True),
        sa.Column("expected_delivery_date", sa.Date(), nullable=True),
        sa.Column(
            "status",
            sa.Enum("pending", "approved", "ordered", "received", "cancelled", name="reorderstatus"),
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "urgency",
            sa.Enum("low", "normal", "high", "critical", name="reorderurgency"),
            nullable=False,
            server_default="normal",
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "requested_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "approved_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ordered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_reorder_org_status", "reorder_requests", ["organization_id", "status"])
    op.create_index("idx_reorder_item", "reorder_requests", ["item_id"])


def downgrade() -> None:
    op.drop_index("idx_reorder_item", table_name="reorder_requests")
    op.drop_index("idx_reorder_org_status", table_name="reorder_requests")
    op.drop_table("reorder_requests")
    op.execute("DROP TYPE IF EXISTS reorderurgency")
    op.execute("DROP TYPE IF EXISTS reorderstatus")
    op.drop_column("inventory_items", "reorder_point")

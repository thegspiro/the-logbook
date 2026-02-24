"""Add storage_areas table, storage_area_id FK, and inventory write-off requests

Creates:
- storage_areas table for hierarchical storage location tracking
- storage_area_id FK on inventory_items
- inventory_write_offs table for write-off requests with supervisor approval

Revision ID: 20260223_0300
Revises: 20260223_0100
Create Date: 2026-02-23 03:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "20260223_0300"
down_revision = "20260223_0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- Storage areas (previously 20260223_0200) ---
    op.create_table(
        "storage_areas",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("label", sa.String(100), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "storage_type",
            sa.Enum("rack", "shelf", "box", "cabinet", "drawer", "bin", "other", name="storagelocationtype"),
            nullable=False,
        ),
        sa.Column("parent_id", sa.String(36), sa.ForeignKey("storage_areas.id", ondelete="CASCADE"), nullable=True),
        sa.Column("location_id", sa.String(36), sa.ForeignKey("locations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("barcode", sa.String(255), nullable=True),
        sa.Column("sort_order", sa.Integer(), default=0),
        sa.Column("is_active", sa.Boolean(), default=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index("idx_storage_areas_org", "storage_areas", ["organization_id"])
    op.create_index("idx_storage_areas_parent", "storage_areas", ["parent_id"])
    op.create_index("idx_storage_areas_location", "storage_areas", ["location_id"])
    op.create_index("idx_storage_areas_active", "storage_areas", ["is_active"])

    op.add_column(
        "inventory_items",
        sa.Column("storage_area_id", sa.String(36), sa.ForeignKey("storage_areas.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("idx_inventory_items_storage_area", "inventory_items", ["storage_area_id"])

    # --- Inventory write-offs ---
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
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
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
    # Drop write-offs
    op.drop_index("idx_write_off_item", table_name="inventory_write_offs")
    op.drop_index("idx_write_off_org_status", table_name="inventory_write_offs")
    op.drop_table("inventory_write_offs")
    op.execute("DROP TYPE IF EXISTS writeoffstatus")

    # Drop storage areas
    op.drop_index("idx_inventory_items_storage_area", table_name="inventory_items")
    op.drop_column("inventory_items", "storage_area_id")
    op.drop_index("idx_storage_areas_active", table_name="storage_areas")
    op.drop_index("idx_storage_areas_location", table_name="storage_areas")
    op.drop_index("idx_storage_areas_parent", table_name="storage_areas")
    op.drop_index("idx_storage_areas_org", table_name="storage_areas")
    op.drop_table("storage_areas")
    sa.Enum(name="storagelocationtype").drop(op.get_bind(), checkfirst=True)

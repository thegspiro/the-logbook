"""Add storage_areas table and storage_area_id FK on inventory_items

Revision ID: 20260223_0200
Revises: 20260223_0100
Create Date: 2026-02-23
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260223_0200"
down_revision = "20260223_0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create storage_areas table
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

    # Add storage_area_id FK to inventory_items
    op.add_column(
        "inventory_items",
        sa.Column("storage_area_id", sa.String(36), sa.ForeignKey("storage_areas.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("idx_inventory_items_storage_area", "inventory_items", ["storage_area_id"])


def downgrade() -> None:
    op.drop_index("idx_inventory_items_storage_area", table_name="inventory_items")
    op.drop_column("inventory_items", "storage_area_id")
    op.drop_index("idx_storage_areas_active", table_name="storage_areas")
    op.drop_index("idx_storage_areas_location", table_name="storage_areas")
    op.drop_index("idx_storage_areas_parent", table_name="storage_areas")
    op.drop_index("idx_storage_areas_org", table_name="storage_areas")
    op.drop_table("storage_areas")
    sa.Enum(name="storagelocationtype").drop(op.get_bind(), checkfirst=True)

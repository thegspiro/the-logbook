"""Add departure clearance tables

Revision ID: dc01a
Revises: 20260218_0900
Create Date: 2026-02-19

Creates the departure_clearances and departure_clearance_items tables
for tracking the member departure property return pipeline.
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "dc01a"
down_revision = "20260218_0900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "departure_clearances",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "status",
            sa.Enum("initiated", "in_progress", "completed", "closed_incomplete", name="clearancestatus"),
            nullable=False,
            server_default="initiated",
        ),
        sa.Column("total_items", sa.Integer, nullable=False, server_default="0"),
        sa.Column("items_cleared", sa.Integer, nullable=False, server_default="0"),
        sa.Column("items_outstanding", sa.Integer, nullable=False, server_default="0"),
        sa.Column("total_value", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("value_outstanding", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("initiated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("return_deadline", sa.DateTime(timezone=True)),
        sa.Column("initiated_by", sa.String(36), sa.ForeignKey("users.id")),
        sa.Column("completed_by", sa.String(36), sa.ForeignKey("users.id")),
        sa.Column("departure_type", sa.String(30)),
        sa.Column("notes", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index("idx_departure_clearance_org_user", "departure_clearances", ["organization_id", "user_id"])
    op.create_index("idx_departure_clearance_org_status", "departure_clearances", ["organization_id", "status"])

    op.create_table(
        "departure_clearance_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("clearance_id", sa.String(36), sa.ForeignKey("departure_clearances.id", ondelete="CASCADE"), nullable=False),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_type", sa.String(20), nullable=False),
        sa.Column("source_id", sa.String(36), nullable=False),
        sa.Column("item_id", sa.String(36), sa.ForeignKey("inventory_items.id", ondelete="SET NULL")),
        sa.Column("item_name", sa.String(255), nullable=False),
        sa.Column("item_serial_number", sa.String(255)),
        sa.Column("item_asset_tag", sa.String(255)),
        sa.Column("item_value", sa.Numeric(10, 2)),
        sa.Column("quantity", sa.Integer, nullable=False, server_default="1"),
        sa.Column(
            "disposition",
            sa.Enum("pending", "returned", "returned_damaged", "written_off", "waived", name="clearancelinedisposition"),
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "return_condition",
            sa.Enum("excellent", "good", "fair", "poor", "damaged", "out_of_service", "retired", name="itemcondition", create_type=False),
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.Column("resolved_by", sa.String(36), sa.ForeignKey("users.id")),
        sa.Column("resolution_notes", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index("idx_clearance_item_clearance", "departure_clearance_items", ["clearance_id"])
    op.create_index("idx_clearance_item_disposition", "departure_clearance_items", ["clearance_id", "disposition"])


def downgrade() -> None:
    op.drop_table("departure_clearance_items")
    op.drop_table("departure_clearances")
    op.execute("DROP TYPE IF EXISTS clearancestatus")
    op.execute("DROP TYPE IF EXISTS clearancelinedisposition")

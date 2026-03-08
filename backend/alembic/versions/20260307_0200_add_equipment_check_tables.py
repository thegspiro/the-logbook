"""add equipment check templates and shift equipment check tables

Revision ID: 20260307_0200
Revises: 20260307_0100
Create Date: 2026-03-07 02:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260307_0200"
down_revision = "20260307_0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---- equipment_check_templates ----
    op.create_table(
        "equipment_check_templates",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "apparatus_id",
            sa.String(36),
            sa.ForeignKey("apparatus.id", ondelete="CASCADE"),
            nullable=True,
            index=True,
        ),
        sa.Column("apparatus_type", sa.String(50), nullable=True, index=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("check_timing", sa.String(30), nullable=False),
        sa.Column("assigned_positions", sa.JSON, nullable=True),
        sa.Column("is_active", sa.Boolean, default=True, nullable=False),
        sa.Column("sort_order", sa.Integer, default=0, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
        sa.Column(
            "created_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    # ---- check_template_compartments ----
    op.create_table(
        "check_template_compartments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "template_id",
            sa.String(36),
            sa.ForeignKey(
                "equipment_check_templates.id", ondelete="CASCADE"
            ),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("sort_order", sa.Integer, default=0, nullable=False),
        sa.Column("image_url", sa.String(500), nullable=True),
        sa.Column(
            "parent_compartment_id",
            sa.String(36),
            sa.ForeignKey(
                "check_template_compartments.id", ondelete="SET NULL"
            ),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
    )
    op.create_index(
        "idx_check_compartment_parent",
        "check_template_compartments",
        ["parent_compartment_id"],
    )

    # ---- check_template_items ----
    op.create_table(
        "check_template_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "compartment_id",
            sa.String(36),
            sa.ForeignKey(
                "check_template_compartments.id", ondelete="CASCADE"
            ),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "equipment_id",
            sa.String(36),
            sa.ForeignKey("apparatus_equipment.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("sort_order", sa.Integer, default=0, nullable=False),
        sa.Column(
            "check_type", sa.String(30), nullable=False, default="pass_fail"
        ),
        sa.Column("is_required", sa.Boolean, default=False, nullable=False),
        sa.Column("required_quantity", sa.Integer, nullable=True),
        sa.Column("image_url", sa.String(500), nullable=True),
        sa.Column(
            "has_expiration", sa.Boolean, default=False, nullable=False
        ),
        sa.Column("expiration_date", sa.Date, nullable=True),
        sa.Column(
            "expiration_warning_days",
            sa.Integer,
            default=30,
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
    )
    op.create_index(
        "idx_check_item_equipment",
        "check_template_items",
        ["equipment_id"],
    )

    # ---- shift_equipment_checks ----
    op.create_table(
        "shift_equipment_checks",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "shift_id",
            sa.String(36),
            sa.ForeignKey("shifts.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "template_id",
            sa.String(36),
            sa.ForeignKey(
                "equipment_check_templates.id", ondelete="SET NULL"
            ),
            nullable=True,
        ),
        sa.Column(
            "apparatus_id",
            sa.String(36),
            sa.ForeignKey("apparatus.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "checked_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "checked_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column("check_timing", sa.String(30), nullable=False),
        sa.Column("overall_status", sa.String(30), nullable=False),
        sa.Column("total_items", sa.Integer, nullable=False, default=0),
        sa.Column("completed_items", sa.Integer, nullable=False, default=0),
        sa.Column("failed_items", sa.Integer, nullable=False, default=0),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("signature_data", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
    )
    op.create_index(
        "idx_shift_equip_check_user",
        "shift_equipment_checks",
        ["checked_by"],
    )
    op.create_index(
        "idx_shift_equip_check_template",
        "shift_equipment_checks",
        ["template_id"],
    )

    # ---- shift_equipment_check_items ----
    op.create_table(
        "shift_equipment_check_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "check_id",
            sa.String(36),
            sa.ForeignKey(
                "shift_equipment_checks.id", ondelete="CASCADE"
            ),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "template_item_id",
            sa.String(36),
            sa.ForeignKey("check_template_items.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("compartment_name", sa.String(200), nullable=False),
        sa.Column("item_name", sa.String(200), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("quantity_found", sa.Integer, nullable=True),
        sa.Column("required_quantity", sa.Integer, nullable=True),
        sa.Column(
            "is_expired", sa.Boolean, default=False, nullable=False
        ),
        sa.Column("expiration_date", sa.Date, nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "idx_shift_equip_check_item_tmpl",
        "shift_equipment_check_items",
        ["template_item_id"],
    )


def downgrade() -> None:
    op.drop_table("shift_equipment_check_items")
    op.drop_table("shift_equipment_checks")
    op.drop_table("check_template_items")
    op.drop_table("check_template_compartments")
    op.drop_table("equipment_check_templates")

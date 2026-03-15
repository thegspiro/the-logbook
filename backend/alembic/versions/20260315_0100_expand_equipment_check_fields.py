"""Expand equipment check fields: 7 check types, serial/lot, level, template_type

Add new columns to check_template_items (expected_quantity, min_level,
level_unit, serial_number, lot_number), equipment_check_templates
(template_type), and shift_equipment_check_items (check_type, level_reading,
level_unit, serial_number, lot_number, photo_urls).

Revision ID: a9f3e7c10001
Revises: (auto-detected)
Create Date: 2026-03-15 01:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = "a9f3e7c10001"
down_revision = None  # Alembic will auto-detect
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -- EquipmentCheckTemplate: add template_type --
    op.add_column(
        "equipment_check_templates",
        sa.Column(
            "template_type",
            sa.String(30),
            nullable=False,
            server_default="equipment",
        ),
    )

    # -- CheckTemplateItem: add new tracking fields --
    op.add_column(
        "check_template_items",
        sa.Column("expected_quantity", sa.Integer(), nullable=True),
    )
    op.add_column(
        "check_template_items",
        sa.Column("min_level", sa.Float(), nullable=True),
    )
    op.add_column(
        "check_template_items",
        sa.Column("level_unit", sa.String(50), nullable=True),
    )
    op.add_column(
        "check_template_items",
        sa.Column("serial_number", sa.String(100), nullable=True),
    )
    op.add_column(
        "check_template_items",
        sa.Column("lot_number", sa.String(100), nullable=True),
    )

    # -- ShiftEquipmentCheckItem: add new result fields --
    op.add_column(
        "shift_equipment_check_items",
        sa.Column("check_type", sa.String(30), nullable=True),
    )
    op.add_column(
        "shift_equipment_check_items",
        sa.Column("level_reading", sa.Float(), nullable=True),
    )
    op.add_column(
        "shift_equipment_check_items",
        sa.Column("level_unit", sa.String(50), nullable=True),
    )
    op.add_column(
        "shift_equipment_check_items",
        sa.Column("serial_number", sa.String(100), nullable=True),
    )
    op.add_column(
        "shift_equipment_check_items",
        sa.Column("lot_number", sa.String(100), nullable=True),
    )
    op.add_column(
        "shift_equipment_check_items",
        sa.Column("photo_urls", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    # -- ShiftEquipmentCheckItem --
    op.drop_column("shift_equipment_check_items", "photo_urls")
    op.drop_column("shift_equipment_check_items", "lot_number")
    op.drop_column("shift_equipment_check_items", "serial_number")
    op.drop_column("shift_equipment_check_items", "level_unit")
    op.drop_column("shift_equipment_check_items", "level_reading")
    op.drop_column("shift_equipment_check_items", "check_type")

    # -- CheckTemplateItem --
    op.drop_column("check_template_items", "lot_number")
    op.drop_column("check_template_items", "serial_number")
    op.drop_column("check_template_items", "level_unit")
    op.drop_column("check_template_items", "min_level")
    op.drop_column("check_template_items", "expected_quantity")

    # -- EquipmentCheckTemplate --
    op.drop_column("equipment_check_templates", "template_type")

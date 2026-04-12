"""Add serial tracking fields to shift_equipment_check_items

Add serial_found, lot_found, and updated_serial columns to track
when members record new serial/lot numbers during equipment checks.

Revision ID: a9f3e7c10002_2
Revises: a9f3e7c10001
Create Date: 2026-03-15 02:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = "a9f3e7c10002_2"
down_revision = "a9f3e7c10002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "shift_equipment_check_items",
        sa.Column("serial_found", sa.String(100), nullable=True),
    )
    op.add_column(
        "shift_equipment_check_items",
        sa.Column("lot_found", sa.String(100), nullable=True),
    )
    op.add_column(
        "shift_equipment_check_items",
        sa.Column(
            "updated_serial",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )


def downgrade() -> None:
    op.drop_column("shift_equipment_check_items", "updated_serial")
    op.drop_column("shift_equipment_check_items", "lot_found")
    op.drop_column("shift_equipment_check_items", "serial_found")

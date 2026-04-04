"""Fix shift_equipment_checks.shift_id to be nullable

The earlier migration 20260325_0100 attempted to make shift_id nullable
but did not take effect on MySQL because the foreign key constraint
also needed updating. This migration drops the old FK, alters the column,
and re-creates the FK with ondelete=SET NULL.

Revision ID: 20260404_0100
Revises: 20260328_0400
Create Date: 2026-04-04
"""

from alembic import op
import sqlalchemy as sa


revision = "20260404_0100"
down_revision = "20260328_0400"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    fks = inspector.get_foreign_keys("shift_equipment_checks")

    shift_fk_name = None
    for fk in fks:
        if fk["constrained_columns"] == ["shift_id"]:
            shift_fk_name = fk["name"]
            break

    if shift_fk_name:
        op.drop_constraint(
            shift_fk_name,
            "shift_equipment_checks",
            type_="foreignkey",
        )

    op.alter_column(
        "shift_equipment_checks",
        "shift_id",
        existing_type=sa.String(36),
        nullable=True,
        existing_nullable=False,
    )

    op.create_foreign_key(
        "fk_shift_equip_checks_shift_id",
        "shift_equipment_checks",
        "shifts",
        ["shift_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_shift_equip_checks_shift_id",
        "shift_equipment_checks",
        type_="foreignkey",
    )

    op.alter_column(
        "shift_equipment_checks",
        "shift_id",
        existing_type=sa.String(36),
        nullable=False,
        existing_nullable=True,
    )

    op.create_foreign_key(
        None,
        "shift_equipment_checks",
        "shifts",
        ["shift_id"],
        ["id"],
        ondelete="CASCADE",
    )

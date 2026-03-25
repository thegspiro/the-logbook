"""Add standalone equipment checks support

Makes shift_id nullable on shift_equipment_checks to allow ad-hoc
checks not tied to a shift. Adds check_context column to distinguish
shift-based from standalone checks.

Revision ID: 20260325_0100
Revises: 20260324_0200
Create Date: 2026-03-25
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = "20260325_0100"
down_revision = "20260324_0200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "shift_equipment_checks",
        "shift_id",
        existing_type=sa.String(36),
        nullable=True,
    )

    op.add_column(
        "shift_equipment_checks",
        sa.Column(
            "check_context",
            sa.String(30),
            nullable=False,
            server_default="shift_based",
        ),
    )


def downgrade() -> None:
    op.drop_column("shift_equipment_checks", "check_context")

    op.alter_column(
        "shift_equipment_checks",
        "shift_id",
        existing_type=sa.String(36),
        nullable=False,
    )

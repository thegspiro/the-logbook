"""Allow full nested storage paths in equipment check item snapshots.

Revision ID: d6f4a13c9e20
Revises: 7ed8593bc904
Create Date: 2026-08-20
"""

import sqlalchemy as sa
from alembic import op

revision = "d6f4a13c9e20"
down_revision = "7ed8593bc904"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "shift_equipment_check_items",
        "compartment_name",
        existing_type=sa.String(length=200),
        type_=sa.Text(),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "shift_equipment_check_items",
        "compartment_name",
        existing_type=sa.Text(),
        type_=sa.String(length=200),
        existing_nullable=False,
    )

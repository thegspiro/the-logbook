"""Allow full nested storage paths in equipment check item snapshots.

Revision ID: 4c8d7e2a91b3
Revises: 9f6d1c2a4b70
Create Date: 2026-08-20
"""

import sqlalchemy as sa
from alembic import op

revision = "4c8d7e2a91b3"
down_revision = "9f6d1c2a4b70"
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

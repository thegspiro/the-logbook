"""Add positions and min_staffing columns to shifts table

Revision ID: a1b2c3d4e5f6
Revises: 9a4b5c6d7e8f
Create Date: 2026-03-14 02:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "a1b2c3d4e5f6"
down_revision = "9a4b5c6d7e8f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("shifts", sa.Column("positions", sa.JSON(), nullable=True))
    op.add_column("shifts", sa.Column("min_staffing", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("shifts", "min_staffing")
    op.drop_column("shifts", "positions")

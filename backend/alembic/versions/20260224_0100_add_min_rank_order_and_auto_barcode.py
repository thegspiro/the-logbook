"""Add min_rank_order and restricted_to_positions to inventory_items

Adds columns so quartermasters can restrict which items are requestable
based on a member's operational rank or corporate position(s).

Revision ID: 20260224_0100
Revises: 20260223_0300
Create Date: 2026-02-24 01:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "20260224_0100"
down_revision = "20260223_0300"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "inventory_items",
        sa.Column("min_rank_order", sa.Integer(), nullable=True),
    )
    op.add_column(
        "inventory_items",
        sa.Column("restricted_to_positions", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("inventory_items", "restricted_to_positions")
    op.drop_column("inventory_items", "min_rank_order")

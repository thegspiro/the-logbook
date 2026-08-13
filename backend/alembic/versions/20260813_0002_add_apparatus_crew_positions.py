"""Add configurable riding positions to full apparatus records.

Revision ID: 20260813_0002
Revises: 20260813_0001
Create Date: 2026-08-13 01:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "20260813_0002"
down_revision = "20260813_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("apparatus", sa.Column("crew_positions", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("apparatus", "crew_positions")

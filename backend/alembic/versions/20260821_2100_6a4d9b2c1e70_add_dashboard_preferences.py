"""Add per-user dashboard widget preferences.

Revision ID: 6a4d9b2c1e70
Revises: 4c8d7e2a91b3
"""

import sqlalchemy as sa
from alembic import op

revision = "6a4d9b2c1e70"
down_revision = "4c8d7e2a91b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("dashboard_preferences", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "dashboard_preferences")

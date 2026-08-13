"""Add membership-type targeting for mandatory events.

Revision ID: 20260813_0011
Revises: 20260813_0010
"""

import sqlalchemy as sa
from alembic import op

revision = "20260813_0011"
down_revision = "20260813_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "events", sa.Column("mandatory_membership_types", sa.JSON(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("events", "mandatory_membership_types")

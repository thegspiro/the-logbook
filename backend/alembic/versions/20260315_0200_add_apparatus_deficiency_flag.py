"""Add apparatus deficiency tracking columns

Add has_deficiency boolean and deficiency_since datetime to the
apparatus table for tracking equipment check failures.

Revision ID: a9f3e7c10002
Revises: a9f3e7c10001
Create Date: 2026-03-15 02:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = "a9f3e7c10002"
down_revision = "a9f3e7c10001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "apparatus",
        sa.Column(
            "has_deficiency",
            sa.Boolean(),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "apparatus",
        sa.Column(
            "deficiency_since",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("apparatus", "deficiency_since")
    op.drop_column("apparatus", "has_deficiency")

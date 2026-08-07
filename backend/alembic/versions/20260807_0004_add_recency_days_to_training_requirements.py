"""add recency_days freshness window to training_requirements

A completion older than ``recency_days`` no longer counts toward the
requirement. Lets a recruit pipeline demand "CPR taken within the last 180
days" while the department's own CPR requirement stays a one-time item.

NULL (the default, and the value every existing row gets) means any completion
counts however old — the behavior before this column existed.

Revision ID: 20260807_0004
Revises: 20260807_0003
Create Date: 2026-08-07 19:05:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260807_0004"
down_revision = "20260807_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "training_requirements",
        sa.Column(
            "recency_days",
            sa.Integer(),
            nullable=True,
            comment=(
                "Freshness window: a completion older than this many days does "
                "not count toward the requirement. NULL = any completion counts "
                "however old."
            ),
        ),
    )


def downgrade() -> None:
    op.drop_column("training_requirements", "recency_days")

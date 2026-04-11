"""add credit_hours to external_training_imports

Revision ID: 20260411_0100
Revises: 20260404_0500
Create Date: 2026-04-11

Vector Solutions reports training completions in credit hours, not
minutes. This column stores the hours value directly so it can be
used when creating TrainingRecords instead of dividing duration_minutes
(which may be zero when only credit hours are provided).
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic
revision = "20260411_0100"
down_revision = "20260404_0500"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "external_training_imports",
        sa.Column("credit_hours", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("external_training_imports", "credit_hours")

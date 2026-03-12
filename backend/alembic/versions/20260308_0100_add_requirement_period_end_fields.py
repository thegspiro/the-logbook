"""add period_end_month and period_end_day to training_requirements

Revision ID: 20260308_0100
Revises: 20260307_0200
Create Date: 2026-03-08 01:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260308_0100"
down_revision = "20260307_0200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "training_requirements",
        sa.Column("period_end_month", sa.Integer(), nullable=True),
    )
    op.add_column(
        "training_requirements",
        sa.Column("period_end_day", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("training_requirements", "period_end_day")
    op.drop_column("training_requirements", "period_end_month")

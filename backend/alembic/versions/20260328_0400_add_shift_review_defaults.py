"""Add shift review defaults to training module config

Adds configurable call types, default skills, and default tasks to
TrainingModuleConfig so training officers can customize shift
completion review forms per organization instead of relying on
hardcoded frontend lists.

Revision ID: 20260328_0400
Revises: 20260328_0300
Create Date: 2026-03-28
"""

from alembic import op
import sqlalchemy as sa


revision = "20260328_0400"
down_revision = "20260328_0300"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "training_module_configs",
        sa.Column("shift_review_call_types", sa.JSON(), nullable=True),
    )
    op.add_column(
        "training_module_configs",
        sa.Column(
            "shift_review_default_skills", sa.JSON(), nullable=True
        ),
    )
    op.add_column(
        "training_module_configs",
        sa.Column(
            "shift_review_default_tasks", sa.JSON(), nullable=True
        ),
    )


def downgrade() -> None:
    op.drop_column(
        "training_module_configs", "shift_review_default_tasks"
    )
    op.drop_column(
        "training_module_configs", "shift_review_default_skills"
    )
    op.drop_column(
        "training_module_configs", "shift_review_call_types"
    )

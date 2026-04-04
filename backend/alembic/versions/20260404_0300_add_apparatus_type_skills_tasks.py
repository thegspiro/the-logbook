"""Add apparatus-type skills/tasks mapping to training config

Maps apparatus types (engine, ladder, etc.) to specific skills and
tasks so the shift completion report form shows relevant items
based on the shift's assigned apparatus.

Revision ID: 20260404_0300
Revises: 20260404_0200
Create Date: 2026-04-04
"""

from alembic import op
import sqlalchemy as sa


revision = "20260404_0300"
down_revision = "20260404_0200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "training_module_configs",
        sa.Column(
            "apparatus_type_skills",
            sa.JSON(),
            nullable=True,
        ),
    )
    op.add_column(
        "training_module_configs",
        sa.Column(
            "apparatus_type_tasks",
            sa.JSON(),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column(
        "training_module_configs",
        "apparatus_type_tasks",
    )
    op.drop_column(
        "training_module_configs",
        "apparatus_type_skills",
    )

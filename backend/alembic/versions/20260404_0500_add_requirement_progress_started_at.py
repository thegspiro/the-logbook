"""Add started_at column to requirement_progress

The training_program_service references started_at when
transitioning a requirement to IN_PROGRESS, but the column
was missing from the model. This adds it.

Revision ID: 20260404_0500
Revises: 20260404_0400
Create Date: 2026-04-04
"""

from alembic import op
import sqlalchemy as sa


revision = "20260404_0500"
down_revision = "20260404_0400"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "requirement_progress",
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("requirement_progress", "started_at")

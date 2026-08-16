"""Track state and EVOC grants produced by reversible completions.

Revision ID: 20260816_0002
Revises: 20260816_0001
Create Date: 2026-08-16
"""

import sqlalchemy as sa
from alembic import op

revision = "20260816_0002"
down_revision = "20260816_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "requirement_progress_credits",
        sa.Column("previous_status", sa.String(50), nullable=True),
    )
    op.add_column(
        "requirement_progress_credits",
        sa.Column("phase_before_id", sa.String(36), nullable=True),
    )
    op.add_column(
        "requirement_progress_credits",
        sa.Column("phase_after_id", sa.String(36), nullable=True),
    )
    op.add_column(
        "apparatus_operators",
        sa.Column("completion_credit_id", sa.String(36), nullable=True),
    )
    op.create_foreign_key(
        "fk_apparatus_operator_completion_credit",
        "apparatus_operators",
        "requirement_progress_credits",
        ["completion_credit_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "idx_apparatus_operators_completion_credit",
        "apparatus_operators",
        ["completion_credit_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "idx_apparatus_operators_completion_credit",
        table_name="apparatus_operators",
    )
    op.drop_constraint(
        "fk_apparatus_operator_completion_credit",
        "apparatus_operators",
        type_="foreignkey",
    )
    op.drop_column("apparatus_operators", "completion_credit_id")
    op.drop_column("requirement_progress_credits", "phase_after_id")
    op.drop_column("requirement_progress_credits", "phase_before_id")
    op.drop_column("requirement_progress_credits", "previous_status")

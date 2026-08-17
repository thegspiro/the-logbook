"""Track state and EVOC grants produced by reversible completions.

(Renumbered from 20260816_0002: the storage-area barcode backfill on main
already held that id — the same-day collision ALEMBIC_MIGRATIONS.md warns
about.)

Doubles as the merge revision for the fork main is currently carrying:
20260816_0006 and 20260816_0007 were numbered off 20260816_0005 on separate
branches and both landed, so `alembic upgrade head` refuses to run and the
head-count tests fail on every open PR. Taking both as parents rejoins the
chain instead of adding a third head to it.

Revision ID: 20260816_0009
Revises: 20260816_0006, 20260816_0007
Create Date: 2026-08-16
"""

import sqlalchemy as sa
from alembic import op

revision = "20260816_0009"
down_revision = ("20260816_0006", "20260816_0007")
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

"""Add votes.manual_batch_id for paper-ballot batch corrections

Every paper-tally entry stamps its vote rows with a shared batch id so a
mis-keyed batch can be voided (soft-deleted) in one audited action instead
of vote-by-vote.

Revision ID: 20260801_0006
Revises: 20260801_0005
Create Date: 2026-08-01 00:06:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "20260801_0006"
down_revision = "20260801_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "votes",
        sa.Column("manual_batch_id", sa.String(36), nullable=True),
    )
    op.create_index(
        "ix_votes_manual_batch_id", "votes", ["manual_batch_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_votes_manual_batch_id", table_name="votes")
    op.drop_column("votes", "manual_batch_id")

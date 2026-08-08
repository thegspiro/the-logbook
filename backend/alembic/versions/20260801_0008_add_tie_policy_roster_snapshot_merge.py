"""Tie policy, voter-roll snapshot, and write-in merge

Three additive columns for the elections enhancement batch:

- elections.tie_policy — what a most_votes tie means (co_winners keeps the
  legacy both-declared-winners behavior; runoff / revote / chair_decides
  flag the tie and declare no winner).
- elections.eligible_roster_snapshot — voter roll frozen at open; NULL =
  legacy live evaluation.
- candidates.merged_into_candidate_id — write-in consolidation alias.
  Votes are never re-pointed (signatures embed candidate_id); results
  group merged candidates under the target.

Revision ID: 20260801_0008
Revises: 20260801_0007
Create Date: 2026-08-01 00:08:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "20260801_0008"
down_revision = "20260801_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "elections",
        sa.Column(
            "tie_policy",
            sa.String(20),
            nullable=False,
            server_default="co_winners",
        ),
    )
    op.add_column(
        "elections",
        sa.Column("eligible_roster_snapshot", sa.JSON(), nullable=True),
    )
    op.add_column(
        "candidates",
        sa.Column("merged_into_candidate_id", sa.String(36), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("candidates", "merged_into_candidate_id")
    op.drop_column("elections", "eligible_roster_snapshot")
    op.drop_column("elections", "tie_policy")

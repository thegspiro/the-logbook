"""Add is_test and eligible_item_ids to voting_tokens

Two election-security fixes need per-token state:

- is_test: "send test ballot" previously issued a normal token, so test votes
  were counted in real results and consumed the manager's dedup slot. Tokens
  issued by the test-ballot endpoint are now flagged, and votes cast with them
  are stored with Vote.is_test=True.

- eligible_item_ids: per-ballot-item eligibility (eligible_voter_types /
  require_attendance) was only checked at email-send time, so any token holder
  could vote on restricted items by submitting their ids. Eligibility cannot be
  recomputed at submission time (tokens store only a one-way voter_hash), so
  the eligible item set is snapshotted on the token when it is issued and
  enforced on submission. NULL = legacy token or positional election
  (unrestricted); legacy fail-open is time-bounded by token expiry.

Revision ID: 20260730_0001
Revises: 20260729_0001
Create Date: 2026-07-28 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260730_0001"
down_revision = "20260729_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "voting_tokens",
        sa.Column("is_test", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "voting_tokens",
        sa.Column("eligible_item_ids", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("voting_tokens", "eligible_item_ids")
    op.drop_column("voting_tokens", "is_test")

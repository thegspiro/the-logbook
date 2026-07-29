"""Add eligible_positions to voting_tokens

Positional (non-ballot-item) elections can restrict who may vote for each
position via Election.position_eligibility, but that rule was only enforced
on the authenticated voting path (check_voter_eligibility needs a User).
Token ballots carry no user identity — only a one-way voter_hash — so the
positions the recipient is eligible for are snapshotted on the token at
send time (mirroring eligible_item_ids for ballot-item elections) and
enforced at vote time.

NULL = legacy token, or an election without position rules (unrestricted).
The legacy fail-open is time-bounded by token expiry (≤ election end / 30
days), the same accepted posture as eligible_item_ids.

Revision ID: 20260801_0001
Revises: 20260731_0001
Create Date: 2026-07-29 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260801_0001"
down_revision = "20260731_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "voting_tokens",
        sa.Column("eligible_positions", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("voting_tokens", "eligible_positions")

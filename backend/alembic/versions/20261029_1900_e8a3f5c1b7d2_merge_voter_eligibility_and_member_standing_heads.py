"""Merge the voter-eligibility and member-standing migration heads

The voter-eligibility chain (ending at d4b1f6a2c9e8) and main's member-standing
chain (c4d7e2a91b60 -> d8f1a4c27b93, joined at 43bebab8401c) were developed in
parallel, so merging them left the revision graph with two heads and made
``alembic upgrade head`` ambiguous.

This revision merges the two branches. It has no schema effect of its own.
Both touch ``users``, but different columns: the member-standing chain widens
``member_status`` and settles tier ids onto it, while the voter-eligibility
chain adds the ``*_since`` stamps and the voting-wait override columns and
backfills the stamps from ``membership_type_changed_at`` and ``hire_date`` --
neither reads what the other writes, so they apply in either order.

Revision ID: e8a3f5c1b7d2
Revises: 43bebab8401c, d4b1f6a2c9e8
Create Date: 2026-10-29 19:00:00.000000
"""

# revision identifiers
revision = "e8a3f5c1b7d2"
down_revision = ("43bebab8401c", "d4b1f6a2c9e8")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""

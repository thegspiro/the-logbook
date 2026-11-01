"""Merge the three migration heads that branch off the shift-evaluations revision

Three changes were developed in parallel, all revising 5781476f2012, and
merged within minutes of each other:

- b65eaef983b9 (#3888): grants evaluations.configure / evaluations.manage to
  the seeded Chief position;
- aefb58788235 (#3893): interviewer position snapshot and the
  applicant-attention email;
- e9bfa68963ce (#3901): client request id on training records, for the
  offline queue.

That left the revision graph with three heads and made ``alembic upgrade
head`` ambiguous. All three are on main, so none is repointed; this revision
rejoins them. It has no schema effect of its own: the parents touch
different tables and apply in any order.

Revision ID: f2c8d41a7e63
Revises: aefb58788235, b65eaef983b9, e9bfa68963ce
Create Date: 2026-11-01 15:45:00.000000
"""

# revision identifiers
revision = "f2c8d41a7e63"
down_revision = ("aefb58788235", "b65eaef983b9", "e9bfa68963ce")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin three branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""

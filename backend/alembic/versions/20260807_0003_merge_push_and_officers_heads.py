"""Merge the push-subscription and organization-officer heads

Two pull requests branched from ``20260805_0011`` and merged the same day
without seeing each other, and both claimed the revision id
``20260807_0001``:

* #1184 (email template categories) added the organization-officers table,
  landing at 03:20.
* #1186 (Web Push) added the push-subscriptions table, landing at 10:30.

A revision id has to be unique — it is what Alembic records in
``alembic_version`` — so two files answering to ``20260807_0001`` leaves the
graph unresolvable rather than merely forked. The later of the two, Web Push,
was renumbered to ``20260807_0002``, and this revision joins the resulting
pair of heads.

Nothing is created here. Both tables already come from their own side, and
Alembic runs each revision exactly once no matter how many merge paths reach
it.

Revision ID: 20260807_0003
Revises: 20260807_0001, 20260807_0002
Create Date: 2026-08-07 11:45:00.000000
"""

# revision identifiers
revision = "20260807_0003"
down_revision = ("20260807_0001", "20260807_0002")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into two heads needs no DDL."""

"""Rejoin the three heads main forked into on 2026-11-04

Three pull requests each built a migration on ``b5e906ebdd7d`` and merged
separately, leaving ``main`` with three heads, so ``alembic upgrade head``
refuses to run (the backend migrates itself on startup):

- ``d75ecbc15bae`` (#4012): drops unused compliance and folder columns;
- ``34f113ec86e3`` (#4015, by way of #4014's ``c0ae312b2385``): the
  historical-import tables;
- ``4f1f4921a052`` (#4013): the interview-requested email template type.

They touch unrelated tables, so this is a pure join with no schema effect.

Revision ID: 8da91e9d28d6
Revises: d75ecbc15bae, 34f113ec86e3, 4f1f4921a052
Create Date: 2026-11-04 13:30:00
"""

# revision identifiers
revision = "8da91e9d28d6"
down_revision = ("d75ecbc15bae", "34f113ec86e3", "4f1f4921a052")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin three branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""

"""Rejoin the two heads main forked into when #4024 and #4033 merged

Both pull requests built on ``8da91e9d28d6`` and merged separately, leaving
``main`` with two heads, so ``alembic upgrade head`` refuses to run (the
backend migrates itself on startup):

- ``67fac0bf1c09`` (#4024, after ``d6906e3dd76c``): the medical-screening
  view-details grant and the interest-form applicant-name unescape;
- ``514dca8e6de3`` (#4033): the historical-import training tables.

They touch unrelated tables, so this is a pure join with no schema effect.

Revision ID: 06b52fa4b688
Revises: 67fac0bf1c09, 514dca8e6de3
Create Date: 2026-11-04 20:45:00
"""

# revision identifiers
revision = "06b52fa4b688"
down_revision = ("67fac0bf1c09", "514dca8e6de3")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""

"""Rejoin the two heads main forked into when #4065 and #4070 merged

Both pull requests built on ``bd8fc0c4a941`` and merged separately, leaving
``main`` with two heads, so ``alembic upgrade head`` refuses to run (the
backend migrates itself on startup):

- ``d1165a97b48e`` (#4065): the inventory sighting actions, continued here
  by this branch's location and facility-file migrations to ``986b38c2086b``;
- ``9446e373c7a3`` (#4070): the chief's requirement overrides.

They touch unrelated tables, so this is a pure join with no schema effect.

Revision ID: 219455a5d79c
Revises: 9446e373c7a3, 986b38c2086b
Create Date: 2026-11-05 20:00:00
"""

# revision identifiers
revision = "219455a5d79c"
down_revision = ("9446e373c7a3", "986b38c2086b")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""

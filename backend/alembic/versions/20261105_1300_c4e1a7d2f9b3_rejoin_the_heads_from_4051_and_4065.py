"""Rejoin the two heads main forked into when #4051 and #4065 merged

Both pull requests built on ``bd8fc0c4a941`` and merged separately, leaving
``main`` with two heads, so ``alembic upgrade head`` refuses to run (the
backend migrates itself on startup):

- ``9446e373c7a3`` (#4051): the Chief's session-attendance requirement
  overrides;
- ``d1165a97b48e`` (#4065): inventory sightings on creation and barcode
  put-away.

They touch unrelated tables, so this is a pure join with no schema effect.

Revision ID: c4e1a7d2f9b3
Revises: 9446e373c7a3, d1165a97b48e
Create Date: 2026-11-05 13:00:00
"""

# revision identifiers
revision = "c4e1a7d2f9b3"
down_revision = ("9446e373c7a3", "d1165a97b48e")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""

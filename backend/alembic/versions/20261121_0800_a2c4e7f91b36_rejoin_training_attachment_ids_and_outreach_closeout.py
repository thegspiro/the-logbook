"""Rejoin the training-attachment-ids and outreach-closeout heads

Both pull requests built on ``d5946cb2bd41``, and merging each to ``main``
without rejoining left two heads, so ``alembic upgrade head`` refuses to run
(the backend migrates itself on startup):

- ``7d6769fca85c`` (training attachments): stamps a stable ``id`` onto every
  stored attachment-list entry in ``training_records`` and
  ``training_submissions``;
- ``d1dfb6c68e9b`` (outreach closeout) and its ancestors (``9b73e3dcaec7``,
  ``e016062a4127``, ``5a41041e328b``): event-request calendar dates, a
  volunteer signup sheet opened directly from an outreach event, and what was
  recorded when one closed.

They touch different tables, so this is a pure join with no schema effect.

Revision ID: a2c4e7f91b36
Revises: 7d6769fca85c, d1dfb6c68e9b
Create Date: 2026-11-21 08:00:00
"""

# revision identifiers
revision = "a2c4e7f91b36"
down_revision = ("7d6769fca85c", "d1dfb6c68e9b")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""

"""Rejoin the history-import head and the waiver-emails join

Both built on ``86722d75b5a2`` (waiver attachments), and merging ``main``
(with #4248) into the history phase 2 branch left two heads, so
``alembic upgrade head`` refuses to run (the backend migrates itself on
startup):

- ``5d1e7c3a9b20`` (history phase 2): the history import, row, title-mapping
  and record-redirect tables, and ``historical_members.import_id``;
- ``3067c03986be`` (#4248): the join of the waiver-emails and
  waiver-attachments heads.

They touch different tables, so this is a pure join with no schema effect.

Revision ID: 9e79851e9a62
Revises: 5d1e7c3a9b20, 3067c03986be
Create Date: 2026-11-13 15:00:00
"""

# revision identifiers
revision = "9e79851e9a62"
down_revision = ("5d1e7c3a9b20", "3067c03986be")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""

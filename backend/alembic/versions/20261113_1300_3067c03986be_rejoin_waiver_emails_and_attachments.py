"""Rejoin the waiver-emails and waiver-attachments heads

Both pull requests built on ``ccd374a66f82``, and merging ``main`` (with #4243)
into the waiver-emails branch left two heads, so ``alembic upgrade head``
refuses to run (the backend migrates itself on startup):

- ``1c6632035ccd`` (waiver emails): the waiver email-template types, the
  template position-CC column and ``attendance_waiver_email_sends``;
- ``86722d75b5a2`` (#4243): ``attendance_waiver_attachments``.

They touch different tables, so this is a pure join with no schema effect.

Revision ID: 3067c03986be
Revises: 1c6632035ccd, 86722d75b5a2
Create Date: 2026-11-13 13:00:00
"""

# revision identifiers
revision = "3067c03986be"
down_revision = ("1c6632035ccd", "86722d75b5a2")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""

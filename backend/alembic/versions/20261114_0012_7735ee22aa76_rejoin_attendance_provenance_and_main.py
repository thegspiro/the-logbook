"""Rejoin the attendance provenance head and the voter-rule exceptions join

Both built on ``e6f00308856d``, and merging #4270's branch (after it took in
``main``) into the Meeting Attendance branch (#4277) left two heads, so
``alembic upgrade head`` refuses to run (the backend migrates itself on
startup):

- ``7d4374ffee39`` (#4277): ``meeting_attendees.checked_in_at``,
  ``recorded_by`` and ``recorded_via``;
- ``0f1564b3784b`` (#4270): the join of the voter-rule reasons head and
  main's attendance waiver follow-ups.

They touch different tables, so this is a pure join with no schema effect.

Revision ID: 7735ee22aa76
Revises: 0f1564b3784b, 7d4374ffee39
Create Date: 2026-11-14 00:12:00
"""

# revision identifiers
revision = "7735ee22aa76"
down_revision = ("0f1564b3784b", "7d4374ffee39")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""

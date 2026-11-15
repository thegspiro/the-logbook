"""Rejoin main's three heads: two duplicate merges and leave requests

``e2b7d94c1a63`` (ported from #4316 into #4303) and ``169a11ebf589`` (#4319)
were written independently to join the same two heads, ``4d8e2b6f1c93`` and
``c4e81b7a2d95``, and both reached ``main`` on 2026-11-15. Each is a no-op, but
together they leave two heads. ``c8d2f61a7e34`` (leave requests and
reminders, #4303) arrived beside them on its own chain, making three, so
``alembic upgrade head`` refuses to run (the backend migrates itself on
startup).

An installation already upgraded through any of them is stamped there; this
revision descends from all three, so any of them upgrades to it without running
anything. Pure join, no schema effect.

Revision ID: a03e83c4060b
Revises: c8d2f61a7e34, e2b7d94c1a63, 169a11ebf589
Create Date: 2026-11-15 11:00:00
"""

# revision identifiers
revision = "a03e83c4060b"
down_revision = ("c8d2f61a7e34", "e2b7d94c1a63", "169a11ebf589")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin three branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""

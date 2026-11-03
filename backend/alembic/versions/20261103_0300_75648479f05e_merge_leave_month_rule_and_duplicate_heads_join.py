"""Merge the leave-month-rule head with the second join of the same fork

Two pull requests each rejoined the same fork, ``400ce5009f5e`` and
``beedcad5b36a`` (both on 4c8e2f61a9d7), with their own no-op merge
revision: ``bbe101d29964`` (#3960) and ``b840c0d2b961`` (#3963). They merged
minutes apart. ``5438939506b9`` (``compliance_configs.leave_month_rule``,
#3958) had already been built on ``bbe101d29964``, so ``main`` was left with
two heads, ``5438939506b9`` and ``b840c0d2b961``, and ``alembic upgrade head``
refused to run. The backend migrates itself on startup.

This revision merges them. It has no schema effect of its own:
``b840c0d2b961`` only rejoins parents ``bbe101d29964`` already has, so the
only work on either side is ``5438939506b9``'s.

Revision ID: 75648479f05e
Revises: 5438939506b9, b840c0d2b961
Create Date: 2026-11-03 03:00:00.000000
"""

# revision identifiers
revision = "75648479f05e"
down_revision = ("5438939506b9", "b840c0d2b961")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""

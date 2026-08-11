"""Preserve the released score-criteria revision identifier.

Revision ID: 20260809_0002
Revises: 20260809_0001
Create Date: 2026-08-09 12:00:00.000000

This revision was deployed with the score pass/fail criteria migration before
that migration was renumbered.  Its schema operation lives in the merge child
and is idempotent, so this compatibility branch intentionally performs no DDL.
"""

revision = "20260809_0002"
down_revision = "20260809_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass

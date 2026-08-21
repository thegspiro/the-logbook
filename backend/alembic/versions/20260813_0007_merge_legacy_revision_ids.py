"""Merge the retained and legacy migration revision branches.

Revision ID: 20260813_0007_merge
Revises: 20260813_0007, 20260812_0006
"""

revision = "20260813_0007_merge"
down_revision = ("20260813_0007", "20260812_0006")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass

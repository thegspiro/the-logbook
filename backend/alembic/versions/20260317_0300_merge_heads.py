"""Merge all migration heads into a single lineage

Revision ID: merge_all_heads_0317
Revises: (multiple heads — see down_revision tuple)
Create Date: 2026-03-17 03:00:00.000000
"""

# revision identifiers
revision = "merge_all_heads_0317"
down_revision = (
    "a7f3e2d91b04",
    "dc01a",
    "a1b2c3d4e5f6",
    "a9f3e7c10004",
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass

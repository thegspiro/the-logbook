"""Merge all migration heads into a single lineage

Revision ID: merge_all_heads_0317
Revises: (multiple heads — see down_revision tuple)
Create Date: 2026-03-17 03:00:00.000000
"""

# revision identifiers
revision = "merge_all_heads_0317"
down_revision = (
    "20260221_0400",
    "a1b2c3d4e5f6",
    "20260313_0100",
    "20260215_0200",
    "20260218_0700",
    "20260216_0300",
    "a9f3e7c10004",
    "20260220_0100",
    "20260312_0100",
    "20260304_0100",
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass

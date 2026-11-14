"""Shift pattern occurrences

Revision ID: db30a34afa5b
Revises: 1740b4886e52
Create Date: 2026-10-31 18:30:00.000000

Adds ``shift_pattern_occurrences``: one row per (pattern, date, shift type)
that generation has produced, so deleting or re-timing a generated shift no
longer lets the next generation run recreate it (KNOWN_LIMITATIONS,
"Scheduling — Left Open by the Shifts-Module Review", item 1).

A new table, so no existing row is touched. It is not backfilled: a shift
generated before this revision carries no record of the pattern that made it,
so there is nothing reliable to backfill from. Those shifts stay protected by
the older start-time guard for as long as they keep their template and start
time. Safe to run twice: created only when absent. The downgrade drops the
table, after which generation again recreates a deleted or moved occurrence.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "db30a34afa5b"
down_revision: Union[str, None] = "1740b4886e52"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "shift_pattern_occurrences"


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table(TABLE):
        return
    op.create_table(
        TABLE,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "pattern_id",
            sa.String(36),
            sa.ForeignKey("shift_patterns.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("occurrence_date", sa.Date(), nullable=False),
        sa.Column("shift_type", sa.String(16), nullable=False),
        sa.Column(
            "shift_id",
            sa.String(36),
            sa.ForeignKey("shifts.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "pattern_id",
            "occurrence_date",
            "shift_type",
            name="uq_shift_pattern_occurrence",
        ),
    )
    op.create_index("idx_shift_pattern_occ_org", TABLE, ["organization_id"])
    op.create_index("idx_shift_pattern_occ_shift", TABLE, ["shift_id"])


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {TABLE}")

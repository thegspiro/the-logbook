"""Shift history import: remembered decisions and split joins

* ``shift_history_import_mappings`` — a department's committed member, unit
  and position decisions, applied to later import files beneath each draft's
  own decisions. Unique per organization, kind and source key.
* ``shift_history_import_rows.keep_separate`` — the reviewer split this row
  off the entry before it, so it is not joined into one attendance with it.
  Existing rows get the server default ``0``, which is the behaviour they had.

Both steps are skipped when already present, so a database whose tables
``create_all`` built from the models upgrades cleanly.

The downgrade drops the new table, losing the remembered decisions (later
imports then start from automatic matching again), and drops the column,
which re-joins any rows a reviewer had split in a draft still under review.
Committed imports are unaffected.

Revision ID: 376ec2fef6d3
Revises: 7e1a3c94d2b6
Create Date: 2026-10-09 18:26:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "376ec2fef6d3"
down_revision: Union[str, None] = "7e1a3c94d2b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MAPPINGS = "shift_history_import_mappings"
ROWS = "shift_history_import_rows"
COLUMN = "keep_separate"


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in _inspector().get_columns(table)}


def upgrade() -> None:
    if _has_table(ROWS) and not _has_column(ROWS, COLUMN):
        op.add_column(
            ROWS,
            sa.Column(COLUMN, sa.Boolean(), nullable=False, server_default="0"),
        )

    if not _has_table(MAPPINGS):
        op.create_table(
            MAPPINGS,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("kind", sa.String(20), nullable=False),
            sa.Column("source_key", sa.String(600), nullable=False),
            sa.Column("mapping", sa.JSON(), nullable=False),
            sa.Column(
                "updated_by",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.UniqueConstraint(
                "organization_id",
                "kind",
                "source_key",
                name="uq_shift_history_import_mappings_org_kind_key",
            ),
            sa.CheckConstraint(
                "kind IN ('member', 'unit', 'position')",
                name="ck_shift_history_import_mappings_kind",
            ),
        )


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {MAPPINGS}")
    if _has_table(ROWS) and _has_column(ROWS, COLUMN):
        op.drop_column(ROWS, COLUMN)

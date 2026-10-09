"""Shift history import drafts

Two new tables hold a department's historical shift import while it is being
reviewed, before anything is written to the schedule:

* ``shift_history_imports`` — one uploaded file: its time zone, header row and
  column mapping, the reviewer's member / unit / position decisions, and the
  commit summary once committed.
* ``shift_history_import_rows`` — one data row each, the cells exactly as read
  plus the reviewer's edits.

No existing table is altered and no existing row is touched. Both tables are
created only when absent, so a database whose tables ``create_all`` already
built upgrades cleanly.

The downgrade drops both tables, losing any draft imports still under review.
Imports already committed are unaffected: what they wrote lives in ``shifts``,
``shift_attendance``, ``shift_assignments`` and ``external_shift_hours``, which
this revision never touches.

Revision ID: c6c4ffcfdfb3
Revises: af92f1496c43
Create Date: 2026-10-09 09:17:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c6c4ffcfdfb3"
down_revision: Union[str, None] = "af92f1496c43"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

IMPORTS = "shift_history_imports"
ROWS = "shift_history_import_rows"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _has_table(IMPORTS):
        op.create_table(
            IMPORTS,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
            sa.Column("source_filename", sa.String(255), nullable=False),
            sa.Column("timezone", sa.String(64), nullable=False),
            sa.Column("headers", sa.JSON(), nullable=False),
            sa.Column("column_mapping", sa.JSON(), nullable=False),
            sa.Column("member_mappings", sa.JSON(), nullable=True),
            sa.Column("unit_mappings", sa.JSON(), nullable=True),
            sa.Column("position_mappings", sa.JSON(), nullable=True),
            sa.Column("existing_shift_decisions", sa.JSON(), nullable=True),
            sa.Column("row_count", sa.Integer(), nullable=False),
            sa.Column("summary", sa.JSON(), nullable=True),
            sa.Column(
                "created_by",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "committed_by",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("committed_at", sa.DateTime(timezone=True), nullable=True),
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
            sa.CheckConstraint(
                "status IN ('draft', 'committed')",
                name="ck_shift_history_imports_status",
            ),
        )
        op.create_index(
            "ix_shift_history_imports_org_status",
            IMPORTS,
            ["organization_id", "status"],
        )

    if not _has_table(ROWS):
        op.create_table(
            ROWS,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "import_id",
                sa.String(36),
                sa.ForeignKey(f"{IMPORTS}.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("line_number", sa.Integer(), nullable=False),
            sa.Column("raw", sa.JSON(), nullable=False),
            sa.Column("edits", sa.JSON(), nullable=True),
            sa.Column("excluded", sa.Boolean(), nullable=False, server_default="0"),
            sa.Column("match_decision", sa.String(20), nullable=True),
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
            sa.CheckConstraint(
                "match_decision IS NULL OR match_decision IN ('accept', 'separate')",
                name="ck_shift_history_import_rows_match_decision",
            ),
        )
        op.create_index(
            "ix_shift_history_import_rows_import_line",
            ROWS,
            ["import_id", "line_number"],
        )


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {ROWS}")
    op.execute(f"DROP TABLE IF EXISTS {IMPORTS}")

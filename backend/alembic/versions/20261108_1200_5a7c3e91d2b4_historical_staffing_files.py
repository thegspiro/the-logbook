"""Historical staffing files

A historical import can now carry the department's staffing export: who was
scheduled into which seat, at which event. It is the roster, not hours (the
hours file credited those), so it is stored beside the import rather than
among its rows.

New tables, both additive:

* ``historical_staffing_files`` — one ``seats`` file and, optionally, one
  ``events`` file per historical import: the header row and which header feeds
  which field. Unique on (import, kind); uploading a file of a kind already
  there replaces it.
* ``historical_staffing_rows`` — each data row of those files, as read.

No existing table or row changes. Each table is created only when absent, so a
database whose tables ``create_all`` already built upgrades cleanly.

The downgrade drops both tables, losing any staffing file uploaded but not yet
imported; nothing has been written from them in this release.

Revision ID: 5a7c3e91d2b4
Revises: 78f196079c95
Create Date: 2026-11-08 12:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5a7c3e91d2b4"
down_revision: Union[str, None] = "78f196079c95"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

FILES = "historical_staffing_files"
ROWS = "historical_staffing_rows"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    # The parent table may be one only create_all builds (pitfall #26); then
    # create_all builds these from the models too.
    if not _has_table("historical_imports"):
        return

    if not _has_table(FILES):
        op.create_table(
            FILES,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "historical_import_id",
                sa.String(36),
                sa.ForeignKey("historical_imports.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("kind", sa.String(20), nullable=False),
            sa.Column("source_filename", sa.String(255), nullable=False),
            sa.Column("headers", sa.JSON(), nullable=False),
            sa.Column("column_mapping", sa.JSON(), nullable=False),
            sa.Column("row_count", sa.Integer(), nullable=False),
            sa.Column(
                "created_by",
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
                "historical_import_id",
                "kind",
                name="uq_historical_staffing_files_kind",
            ),
            sa.CheckConstraint(
                "kind IN ('seats', 'events')",
                name="ck_historical_staffing_files_kind",
            ),
        )
        op.create_index("ix_historical_staffing_files_org", FILES, ["organization_id"])

    if not _has_table(ROWS):
        op.create_table(
            ROWS,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "file_id",
                sa.String(36),
                sa.ForeignKey(f"{FILES}.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("line_number", sa.Integer(), nullable=False),
            sa.Column("raw", sa.JSON(), nullable=False),
        )
        op.create_index(
            "ix_historical_staffing_rows_file_line", ROWS, ["file_id", "line_number"]
        )


def downgrade() -> None:
    if _has_table(ROWS):
        op.drop_table(ROWS)
    if _has_table(FILES):
        op.drop_table(FILES)

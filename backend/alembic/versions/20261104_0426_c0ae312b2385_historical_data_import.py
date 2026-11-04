"""Historical data import

Adds what the Integrations > Historical Data Import tool stores, and what the
shift history import needs to receive rows from it.

New tables:

* ``historical_imports`` / ``historical_import_rows`` — an uploaded export while
  its columns are mapped and its rows routed, before anything is written.
* ``imported_source_records`` — the ledger: one row per source row an import
  turned into a record, unique on (organization, source system, source id), so
  re-running a file is a no-op rather than a second copy.

New columns, all additive:

* ``shifts.duty_type`` — ``in_station`` (default) or ``on_call``. Every existing
  shift is an in-station shift, which is exactly what the server default gives
  the rows already there, so no backfill is needed.
* ``external_shift_hours.call_count`` — nullable; existing rows keep NULL,
  which is what "no count recorded" already meant.
* ``shift_history_imports.historical_import_id`` / ``source_system`` — nullable;
  existing drafts and committed imports were uploaded directly and have neither.
* ``shift_history_import_rows.outcome`` / ``outcome_detail`` — nullable;
  existing rows keep NULL, and readers treat NULL as "not recorded".

No existing row is rewritten. Tables and columns are created only when absent,
and every alteration is guarded on the table existing, so a database whose
tables ``create_all`` already built upgrades cleanly.

The downgrade drops the three new tables and the new columns. Dropping
``shifts.duty_type`` turns every on-call shift back into an undistinguished
shift (its hours, attendance and calls are untouched), and dropping the ledger
means a later re-import of the same file is no longer recognised as a repeat.

Revision ID: c0ae312b2385
Revises: 289504a34d3c
Create Date: 2026-11-04 04:26:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c0ae312b2385"
down_revision: Union[str, None] = "289504a34d3c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

IMPORTS = "historical_imports"
ROWS = "historical_import_rows"
LEDGER = "imported_source_records"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _has_index(table: str, name: str) -> bool:
    return name in {i["name"] for i in sa.inspect(op.get_bind()).get_indexes(table)}


def _add_column(table: str, column: sa.Column) -> None:
    if _has_table(table) and not _has_column(table, column.name):
        op.add_column(table, column)


def _drop_column(table: str, column: str) -> None:
    if _has_table(table) and _has_column(table, column):
        op.drop_column(table, column)


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
            sa.Column("source_system", sa.String(100), nullable=False),
            sa.Column("timezone", sa.String(64), nullable=False),
            sa.Column("headers", sa.JSON(), nullable=False),
            sa.Column("column_mapping", sa.JSON(), nullable=False),
            sa.Column("hour_columns", sa.JSON(), nullable=False),
            sa.Column("call_columns", sa.JSON(), nullable=False),
            sa.Column("row_count", sa.Integer(), nullable=False),
            sa.Column("summary", sa.JSON(), nullable=True),
            sa.Column(
                "created_by",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "routed_by",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("routed_at", sa.DateTime(timezone=True), nullable=True),
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
                "status IN ('draft', 'routed')", name="ck_historical_imports_status"
            ),
        )
        op.create_index(
            "ix_historical_imports_org_status", IMPORTS, ["organization_id", "status"]
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
        )
        op.create_index(
            "ix_historical_import_rows_import_line", ROWS, ["import_id", "line_number"]
        )

    if not _has_table(LEDGER):
        op.create_table(
            LEDGER,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("source_system", sa.String(100), nullable=False),
            sa.Column("source_id", sa.String(100), nullable=False),
            sa.Column("record_kind", sa.String(40), nullable=False),
            sa.Column("record_id", sa.String(36), nullable=False),
            sa.Column(
                "historical_import_id",
                sa.String(36),
                sa.ForeignKey(f"{IMPORTS}.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.UniqueConstraint(
                "organization_id",
                "source_system",
                "source_id",
                name="uq_imported_source_records_org_system_id",
            ),
        )
        op.create_index(
            "ix_imported_source_records_record", LEDGER, ["record_kind", "record_id"]
        )

    _add_column(
        "shifts",
        sa.Column(
            "duty_type",
            sa.String(20),
            nullable=False,
            server_default="in_station",
        ),
    )
    _add_column(
        "external_shift_hours", sa.Column("call_count", sa.Integer(), nullable=True)
    )
    if _has_table("shift_history_imports") and not _has_column(
        "shift_history_imports", "historical_import_id"
    ):
        op.add_column(
            "shift_history_imports",
            sa.Column(
                "historical_import_id",
                sa.String(36),
                sa.ForeignKey(
                    f"{IMPORTS}.id",
                    ondelete="SET NULL",
                    name="fk_shift_history_imports_historical_import",
                ),
                nullable=True,
            ),
        )
    if _has_table("shift_history_imports") and not _has_index(
        "shift_history_imports", "ix_shift_history_imports_historical_import_id"
    ):
        op.create_index(
            "ix_shift_history_imports_historical_import_id",
            "shift_history_imports",
            ["historical_import_id"],
        )
    _add_column(
        "shift_history_imports",
        sa.Column("source_system", sa.String(100), nullable=True),
    )
    _add_column(
        "shift_history_import_rows",
        sa.Column("outcome", sa.String(20), nullable=True),
    )
    _add_column(
        "shift_history_import_rows",
        sa.Column("outcome_detail", sa.String(255), nullable=True),
    )


def downgrade() -> None:
    _drop_column("shift_history_import_rows", "outcome_detail")
    _drop_column("shift_history_import_rows", "outcome")
    _drop_column("shift_history_imports", "source_system")
    if _has_table("shift_history_imports") and _has_column(
        "shift_history_imports", "historical_import_id"
    ):
        # MySQL refuses to drop a column a foreign key or index still uses.
        foreign_keys = sa.inspect(op.get_bind()).get_foreign_keys(
            "shift_history_imports"
        )
        for fk in foreign_keys:
            if fk.get("name") and fk.get("constrained_columns") == [
                "historical_import_id"
            ]:
                op.drop_constraint(
                    fk["name"], "shift_history_imports", type_="foreignkey"
                )
        if _has_index(
            "shift_history_imports", "ix_shift_history_imports_historical_import_id"
        ):
            op.drop_index(
                "ix_shift_history_imports_historical_import_id",
                table_name="shift_history_imports",
            )
        op.drop_column("shift_history_imports", "historical_import_id")
    _drop_column("external_shift_hours", "call_count")
    _drop_column("shifts", "duty_type")
    op.execute(f"DROP TABLE IF EXISTS {LEDGER}")
    op.execute(f"DROP TABLE IF EXISTS {ROWS}")
    op.execute(f"DROP TABLE IF EXISTS {IMPORTS}")

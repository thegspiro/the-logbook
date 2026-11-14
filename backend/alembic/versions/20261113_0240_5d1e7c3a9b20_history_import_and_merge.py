"""History phase 2: roster import and person merge

Four new tables and two new columns on ``historical_members``:

- ``history_imports`` / ``history_import_rows``: an uploaded roster file and
  its rows under review. The rows' cells and edits are encrypted text.
- ``history_import_title_mappings``: a department's remembered answer for a
  title text an import met.
- ``history_record_redirects``: where a merged-away record's address leads.
- ``historical_members.import_id`` and ``import_revision_number``: which import
  created a record, and the revision it had then.

Existing rows: both new columns are nullable with no default, so every record
already in ``historical_members`` reads as "not created by an import", which
is true. Nothing is backfilled. Every step is skipped when its table or column
already exists, so a database ``create_all`` built first upgrades cleanly.

Downgrade drops the four tables, the two columns and everything recorded in
them: pending import drafts, remembered title answers and merge redirects
(old addresses of merged records stop forwarding). The merges themselves and
the records imports created are untouched.

Revision ID: 5d1e7c3a9b20
Revises: 86722d75b5a2
Create Date: 2026-11-13 02:40:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "5d1e7c3a9b20"
down_revision: Union[str, None] = "86722d75b5a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Frozen copies of the enum values at this revision.
_IMPORT_STATUS = ("draft", "committed", "discarded", "expired")
_DECISION = ("match", "map", "create", "skip", "same_as")
_TITLE_ACTION = ("map", "create", "drop")

# Table and key names, as module constants so the migration test can run it on
# prefixed scratch tables in the real database.
ORGANIZATIONS = "organizations"
USERS = "users"
TITLES = "history_titles"
MEMBERS = "historical_members"
IMPORTS = "history_imports"
ROWS = "history_import_rows"
MAPPINGS = "history_import_title_mappings"
REDIRECTS = "history_record_redirects"

IX_IMPORTS_ORG_STATUS = "ix_history_imports_org_status"
IX_IMPORTS_STATUS_EXPIRES = "ix_history_imports_status_expires"
IX_ROWS_IMPORT = "ix_history_import_rows_import"
IX_REDIRECTS_NEW = "ix_history_redirects_new"
IX_MEMBERS_IMPORT = "ix_historical_members_import"
UQ_MAPPING_KEY = "uq_history_import_title_key"
UQ_REDIRECT_OLD = "uq_history_redirect_old"


def _member_fk() -> str:
    return f"fk_{MEMBERS}_import_id_{IMPORTS}"


def _inspector() -> sa.engine.reflection.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return _inspector().has_table(table)


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in _inspector().get_columns(table)}


def _org() -> sa.Column:
    return sa.Column(
        "organization_id",
        sa.String(36),
        sa.ForeignKey(f"{ORGANIZATIONS}.id", ondelete="CASCADE"),
        nullable=False,
    )


def _user_fk(name: str) -> sa.Column:
    return sa.Column(
        name,
        sa.String(36),
        sa.ForeignKey(f"{USERS}.id", ondelete="SET NULL"),
        nullable=True,
    )


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )


def _updated_at() -> sa.Column:
    return sa.Column(
        "updated_at",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )


def upgrade() -> None:
    if not _has_table(IMPORTS):
        op.create_table(
            IMPORTS,
            sa.Column("id", sa.String(36), primary_key=True),
            _org(),
            sa.Column(
                "status",
                sa.Enum(*_IMPORT_STATUS, name="historyimportstatus"),
                nullable=False,
                server_default="draft",
            ),
            sa.Column("source_filename", sa.String(255), nullable=False),
            sa.Column("headers", sa.JSON(), nullable=False),
            sa.Column("column_mapping", sa.JSON(), nullable=False),
            sa.Column("row_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("summary", sa.JSON(), nullable=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            _user_fk("created_by"),
            _user_fk("committed_by"),
            sa.Column("committed_at", sa.DateTime(timezone=True), nullable=True),
            _created_at(),
            _updated_at(),
        )
        op.create_index(
            IX_IMPORTS_ORG_STATUS,
            IMPORTS,
            ["organization_id", "status"],
        )
        op.create_index(
            IX_IMPORTS_STATUS_EXPIRES,
            IMPORTS,
            ["status", "expires_at"],
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
            # Encrypted JSON, stored as text.
            sa.Column("cells", sa.Text(), nullable=False),
            sa.Column("edits", sa.Text(), nullable=True),
            sa.Column("suggestions", sa.JSON(), nullable=True),
            sa.Column(
                "decision",
                sa.Enum(*_DECISION, name="historyimportdecision"),
                nullable=True,
            ),
            sa.Column(
                "target_member_id",
                sa.String(36),
                sa.ForeignKey(f"{MEMBERS}.id", ondelete="SET NULL"),
                nullable=True,
            ),
            _user_fk("target_user_id"),
            sa.Column(
                "target_row_id",
                sa.String(36),
                sa.ForeignKey(f"{ROWS}.id", ondelete="SET NULL"),
                nullable=True,
            ),
            _created_at(),
            _updated_at(),
        )
        op.create_index(
            IX_ROWS_IMPORT,
            ROWS,
            ["import_id", "line_number"],
        )

    if not _has_table(MAPPINGS):
        op.create_table(
            MAPPINGS,
            sa.Column("id", sa.String(36), primary_key=True),
            _org(),
            sa.Column("source_key", sa.String(150), nullable=False),
            sa.Column("source_text", sa.String(150), nullable=False),
            sa.Column(
                "action",
                sa.Enum(*_TITLE_ACTION, name="historytitleaction"),
                nullable=False,
            ),
            sa.Column(
                "title_id",
                sa.String(36),
                sa.ForeignKey(f"{TITLES}.id", ondelete="SET NULL"),
                nullable=True,
            ),
            _user_fk("updated_by"),
            _created_at(),
            _updated_at(),
            sa.UniqueConstraint("organization_id", "source_key", name=UQ_MAPPING_KEY),
        )

    if not _has_table(REDIRECTS):
        op.create_table(
            REDIRECTS,
            sa.Column("id", sa.String(36), primary_key=True),
            _org(),
            sa.Column("record_type", sa.String(30), nullable=False),
            sa.Column("old_id", sa.String(36), nullable=False),
            sa.Column("new_id", sa.String(36), nullable=False),
            _user_fk("merged_by"),
            _created_at(),
            sa.UniqueConstraint(
                "organization_id",
                "record_type",
                "old_id",
                name=UQ_REDIRECT_OLD,
            ),
        )
        op.create_index(
            IX_REDIRECTS_NEW,
            REDIRECTS,
            ["organization_id", "record_type", "new_id"],
        )

    # ``historical_members`` is built by 038ade7a5cd0, so it exists here; the
    # guard is for a database whose tables ``create_all`` already built.
    if _has_table(MEMBERS):
        if not _has_column(MEMBERS, "import_id"):
            op.add_column(
                MEMBERS,
                sa.Column("import_id", sa.String(36), nullable=True),
            )
            # The index first: MySQL would otherwise build one of its own for
            # the key, leaving the column indexed twice.
            op.create_index(IX_MEMBERS_IMPORT, MEMBERS, ["import_id"])
            op.create_foreign_key(
                _member_fk(),
                MEMBERS,
                IMPORTS,
                ["import_id"],
                ["id"],
                ondelete="SET NULL",
            )
        if not _has_column(MEMBERS, "import_revision_number"):
            op.add_column(
                MEMBERS,
                sa.Column("import_revision_number", sa.Integer(), nullable=True),
            )


def downgrade() -> None:
    if _has_table(MEMBERS):
        if _has_column(MEMBERS, "import_revision_number"):
            op.drop_column(MEMBERS, "import_revision_number")
        if _has_column(MEMBERS, "import_id"):
            fks = {
                fk["name"]
                for fk in _inspector().get_foreign_keys(MEMBERS)
                if fk.get("referred_table") == IMPORTS
            }
            for name in fks:
                op.drop_constraint(name, MEMBERS, type_="foreignkey")
            indexes = {ix["name"] for ix in _inspector().get_indexes(MEMBERS)}
            if IX_MEMBERS_IMPORT in indexes:
                op.drop_index(IX_MEMBERS_IMPORT, MEMBERS)
            op.drop_column(MEMBERS, "import_id")

    # Children before parents, so no foreign key blocks a drop.
    for table in (REDIRECTS, MAPPINGS, ROWS, IMPORTS):
        if _has_table(table):
            op.drop_table(table)

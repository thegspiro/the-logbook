"""facility document reference id and folder slug indexes

FAC-41: ``DocumentsService._match_facility_document_references`` is a locking
read that found a document's facility references with ``file_path LIKE
'document:%'`` and parsed each suffix in Python. ``file_path`` has no index,
so the read locked every shared-document reference in the organization and
serialized unrelated facility-file writes behind any document delete.
``facility_documents.document_id`` and ``facility_photos.document_id`` hold the
canonical id of the referenced document, indexed with ``organization_id``, so
the same single locking read touches only the matching rows.

FAC-44: the system-root and per-record folder lookups filter ``slug``, which
had no index, so their locking reads walked and locked sibling folders in
random-UUID order. ``(organization_id, slug)`` and ``(parent_id, slug)`` on
``document_folders`` make both lookups index-satisfied.

Backfill: every existing reference is parsed the way the model now derives it
-- any suffix ``UUID()`` accepts, stored in its canonical lowercase hyphenated
form; anything else stays NULL, as it was never matched before either. The
backfill selects only rows still NULL, so a re-run (or a column added earlier
by ``repair_schema``) is completed rather than skipped. The parser is inlined:
a migration must keep transforming rows the way it did the day it ran.

Downgrade drops the indexes and both columns; nothing else reads them, and the
derived values are rebuilt from ``file_path`` by the next upgrade.

Revision ID: c56303befb2c
Revises: 60aaf273de27
Create Date: 2026-10-05 23:25:26.912844

"""

from typing import Optional, Sequence, Union
from uuid import UUID

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c56303befb2c"
down_revision: Union[str, None] = "60aaf273de27"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_REFERENCE_TABLES = (
    ("facility_documents", "idx_facility_documents_org_document"),
    ("facility_photos", "idx_facility_photos_org_document"),
)
_FOLDER_TABLE = "document_folders"
_FOLDER_INDEXES = (
    ("idx_doc_folders_org_slug", ["organization_id", "slug"]),
    ("idx_doc_folders_parent_slug", ["parent_id", "slug"]),
)
_PREFIX = "document:"
_BATCH = 500


def _tables() -> set:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _columns(table: str) -> set:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _indexes(table: str) -> set:
    return {i["name"] for i in sa.inspect(op.get_bind()).get_indexes(table)}


def _canonical_document_id(file_path: Optional[str]) -> Optional[str]:
    if not file_path or not file_path.startswith(_PREFIX):
        return None
    try:
        return str(UUID(file_path[len(_PREFIX) :]))
    except (ValueError, AttributeError, TypeError):
        return None


def backfill_document_ids(bind, table: str) -> int:
    """Set ``document_id`` on every reference row still missing it.

    Returns the number of rows written. Rows whose suffix does not parse are
    left NULL and are selected again by a later run, which is harmless: they
    still do not parse.
    """
    rows = bind.execute(
        sa.text(
            f"SELECT id, file_path FROM {table} "
            "WHERE document_id IS NULL AND file_path LIKE :prefix"
        ),
        {"prefix": f"{_PREFIX}%"},
    ).fetchall()
    updates = []
    for row_id, file_path in rows:
        document_id = _canonical_document_id(file_path)
        if document_id is not None:
            updates.append({"row_id": row_id, "document_id": document_id})
    statement = sa.text(
        f"UPDATE {table} SET document_id = :document_id WHERE id = :row_id"
    )
    for start in range(0, len(updates), _BATCH):
        bind.execute(statement, updates[start : start + _BATCH])
    return len(updates)


def upgrade() -> None:
    tables = _tables()
    bind = op.get_bind()
    # A table no migration has built yet is built later by create_all from
    # the models, which already declare the column and index.
    for table, index in _REFERENCE_TABLES:
        if table not in tables:
            continue
        if "document_id" not in _columns(table):
            op.add_column(table, sa.Column("document_id", sa.String(36), nullable=True))
        if index not in _indexes(table):
            op.create_index(index, table, ["organization_id", "document_id"])
        backfill_document_ids(bind, table)

    if _FOLDER_TABLE in tables:
        existing = _indexes(_FOLDER_TABLE)
        for index, columns in _FOLDER_INDEXES:
            if index not in existing:
                op.create_index(index, _FOLDER_TABLE, columns)


def downgrade() -> None:
    tables = _tables()
    if _FOLDER_TABLE in tables:
        existing = _indexes(_FOLDER_TABLE)
        for index, _ in _FOLDER_INDEXES:
            if index in existing:
                op.drop_index(index, table_name=_FOLDER_TABLE)

    for table, index in _REFERENCE_TABLES:
        if table not in tables:
            continue
        if index in _indexes(table):
            op.drop_index(index, table_name=table)
        if "document_id" in _columns(table):
            op.drop_column(table, "document_id")

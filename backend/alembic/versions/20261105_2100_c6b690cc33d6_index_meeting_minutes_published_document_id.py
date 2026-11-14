"""index meeting_minutes.published_document_id

DOC-31's lock order (owner decision 2026-11-01): deleting a document clears
the minutes that name it as their published library copy, and now takes those
rows with a NOWAIT locking read first. Without an index on the column, both
the read and the clearing UPDATE found the rows by scanning the department's
minutes through ``organization_id``, and under REPEATABLE READ a locking scan
keeps every row it examined locked: the delete locked, or waited on, every
minutes row in the department rather than the one pointing at the document.

A plain, non-unique index. Existing rows need nothing settling: several
minutes may legitimately hold NULL, and nothing here constrains a value.
Skipped when the table is absent or the index already exists (a database whose
tables ``create_all`` built from the models, which declare it).

Revision ID: c6b690cc33d6
Revises: 7c41e9a2b6d8
Create Date: 2026-11-05 21:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c6b690cc33d6"
down_revision: Union[str, None] = "7c41e9a2b6d8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "meeting_minutes"
_INDEX = "ix_meeting_minutes_published_document_id"


def _index_names() -> set[str] | None:
    """The table's index names, or None when the table does not exist."""
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        return None
    return {index["name"] for index in inspector.get_indexes(_TABLE)}


def upgrade() -> None:
    names = _index_names()
    if names is None or _INDEX in names:
        return
    op.create_index(_INDEX, _TABLE, ["published_document_id"])


def downgrade() -> None:
    names = _index_names()
    if names is None or _INDEX not in names:
        return
    op.drop_index(_INDEX, table_name=_TABLE)

"""Waiver requests: record what document retention removed

Revision ID: 241c1cc27313
Revises: 9c41e7b2d5a3
Create Date: 2026-11-24 03:43:19.624407

Adds two nullable columns to ``attendance_waiver_requests``:

* ``attachments_removed_count`` (INTEGER): how many documents the retention
  sweep has removed from the request, added up across runs;
* ``attachments_removed_at`` (DATETIME): when the latest run removed some.

Owner decision of 2026-11-23: the request page says "N documents removed
under retention on <date>" instead of reading as though nothing was ever
filed. The retention audit entry cannot supply this: it lists a whole
department's request ids and attachment ids together, with no count per
request.

Existing rows: both columns are nullable with no default, so every existing
request gets NULL, which means "retention has removed nothing". A request
whose documents were swept before this revision therefore says nothing, as
before; no backfill is attempted, because the old audit entries cannot be
split per request. No row is rewritten.

Safe to run twice, and tolerant of a database where ``create_all`` has not yet
built the table (CLAUDE.md pitfall #26): each column is added only when the
table exists and the column does not. The downgrade drops whichever of the two
exists, which loses the record of past removals; the documents themselves were
already gone.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "241c1cc27313"
down_revision: Union[str, None] = "9c41e7b2d5a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Named so the migration's test can point it at a scratch copy.
TABLE = "attendance_waiver_requests"
COUNT = "attachments_removed_count"
AT = "attachments_removed_at"


def _columns() -> set[str] | None:
    """The table's column names, or None when the table does not exist."""
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return None
    return {c["name"] for c in inspector.get_columns(TABLE)}


def upgrade() -> None:
    columns = _columns()
    if columns is None:
        return
    if COUNT not in columns:
        op.add_column(TABLE, sa.Column(COUNT, sa.Integer(), nullable=True))
    if AT not in columns:
        op.add_column(TABLE, sa.Column(AT, sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    columns = _columns()
    if columns is None:
        return
    for name in (AT, COUNT):
        if name in columns:
            op.drop_column(TABLE, name)

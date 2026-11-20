"""Training attachments: settle bare-string entries as {"file_name": ...}

``training_records.attachments`` and ``training_submissions.attachments`` hold
one entry per file. The upload routes and the approval copy store a dict
carrying ``file_name`` and the server's ``file_path``. Older rows, and any row a
request body wrote before those bodies stopped accepting the field, hold bare
strings instead: a file name and nothing else. This settles every stored entry
on the dict shape (CLAUDE.md pitfall #20), so the column has one canonical
shape: a string ``s`` becomes ``{"file_name": s}``.

Lossless, and nothing reads differently:

- Positions are kept. The download routes address an attachment by its index,
  so every index still names the same entry.
- Every reader already rendered a string as its ``file_name``, so responses
  carry the same text.
- No file is named either way. A bare string never carried a ``file_path``, so
  no reference collector saw it before, and none sees it now.

Only lists holding at least one string are rewritten. NULL, a JSON null, an
empty list, a list of dicts and any value that is not a list are left exactly
as they are. A second run finds no strings and changes nothing.

The downgrade turns a dict whose only key is ``file_name`` back into its
string. That is exact, because no writer has ever stored a dict with that one
key: the upload routes write six keys, and the approval copy copies them.

``_normalize`` and ``_restore`` are frozen here rather than imported, so later
edits elsewhere cannot change what this revision does.

Revision ID: 0c22a95b94b8
Revises: 790a86084359
Create Date: 2026-11-20 14:19:00.000000
"""

from typing import Any, Callable, Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0c22a95b94b8"
down_revision: Union[str, None] = "790a86084359"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Module-level so the migration test can point them at scratch tables.
RECORDS_TABLE = "training_records"
SUBMISSIONS_TABLE = "training_submissions"

_BATCH = 500


def _normalize(value: Any) -> Any:
    """Frozen: a list holding any string gets each string as a file_name dict."""
    if not isinstance(value, list) or not any(isinstance(v, str) for v in value):
        return value
    return [{"file_name": v} if isinstance(v, str) else v for v in value]


def _restore(value: Any) -> Any:
    """Frozen inverse of :func:`_normalize`."""
    if not isinstance(value, list):
        return value
    if not any(isinstance(v, dict) and set(v) == {"file_name"} for v in value):
        return value
    return [
        v["file_name"] if isinstance(v, dict) and set(v) == {"file_name"} else v
        for v in value
    ]


def _rewrite(table_name: str, transform: Callable[[Any], Any]) -> None:
    bind = op.get_bind()
    if table_name not in sa.inspect(bind).get_table_names():
        return
    table = sa.table(
        table_name,
        sa.column("id", sa.String(36)),
        sa.column("attachments", sa.JSON),
    )
    last_id = ""
    while True:
        rows = bind.execute(
            sa.select(table.c.id, table.c.attachments)
            .where(table.c.attachments.isnot(None), table.c.id > last_id)
            .order_by(table.c.id)
            .limit(_BATCH)
        ).all()
        if not rows:
            return
        for row in rows:
            changed = transform(row.attachments)
            if changed != row.attachments:
                bind.execute(
                    sa.update(table)
                    .where(table.c.id == row.id)
                    .values(attachments=changed)
                )
        last_id = rows[-1].id


def upgrade() -> None:
    for table_name in (RECORDS_TABLE, SUBMISSIONS_TABLE):
        _rewrite(table_name, _normalize)


def downgrade() -> None:
    for table_name in (RECORDS_TABLE, SUBMISSIONS_TABLE):
        _rewrite(table_name, _restore)

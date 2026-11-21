"""Training attachments: give every entry a stable id

``training_records.attachments`` and ``training_submissions.attachments`` hold
one dict per file. The routes addressed an entry by its index, which moves when
an earlier entry is removed, so a removal repeated after a lost response
removed the next entry and its file (CLAUDE.md pitfall #36). From this
revision every entry carries an ``id``, a ``str(uuid4())`` the routes accept in
place of the index. The writers stamp it on every new entry
(``app/utils/training_attachments.py``); this stamps the entries already stored
(pitfall #20: one canonical shape, settled at the write and for the rows that
exist).

Only dict entries without a string ``id`` change, by gaining one. Positions are
kept, so an index still names the same entry. NULL, a JSON null, an empty list,
a string left in a list and any value that is not a list are untouched. A
second run finds every dict already carrying an id and changes nothing. No
column, constraint or index is added, so no existing row can fail it
(pitfall #35).

A submission and the record its approval copied get unrelated ids here, because
they were copied before ids existed. Copies made after this revision keep the
submission entry's id on the record.

The downgrade pops ``id`` from every dict entry, which loses the ids written
after the upgrade; no earlier code reads them. It has to run before
``0c22a95b94b8``'s downgrade, whose ``_restore`` only recognises a dict whose
sole key is ``file_name``, and Alembic's ordering guarantees that.

``_stamp`` and ``_unstamp`` are frozen here rather than imported, so later edits
elsewhere cannot change what this revision does.

Revision ID: 7d6769fca85c
Revises: d5946cb2bd41
Create Date: 2026-11-21 01:25:00.000000
"""

import uuid
from typing import Any, Callable, Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7d6769fca85c"
down_revision: Union[str, None] = "d5946cb2bd41"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Module-level so the migration test can point them at scratch tables.
RECORDS_TABLE = "training_records"
SUBMISSIONS_TABLE = "training_submissions"

_BATCH = 500


def _stamp(value: Any) -> Any:
    """Frozen: every dict entry lacking a string id gets a uuid4 string."""
    if not isinstance(value, list):
        return value
    if not any(isinstance(v, dict) and not isinstance(v.get("id"), str) for v in value):
        return value
    return [
        (
            {**v, "id": str(uuid.uuid4())}
            if isinstance(v, dict) and not isinstance(v.get("id"), str)
            else v
        )
        for v in value
    ]


def _unstamp(value: Any) -> Any:
    """Frozen inverse: every dict entry loses its id."""
    if not isinstance(value, list):
        return value
    if not any(isinstance(v, dict) and "id" in v for v in value):
        return value
    return [
        {k: x for k, x in v.items() if k != "id"} if isinstance(v, dict) else v
        for v in value
    ]


def _rewrite(table_name: str, transform: Callable[[Any], Any]) -> None:
    bind = op.get_bind()
    # Both tables are built by migrations, so this is defensive (pitfall #26).
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
        _rewrite(table_name, _stamp)


def downgrade() -> None:
    for table_name in (RECORDS_TABLE, SUBMISSIONS_TABLE):
        _rewrite(table_name, _unstamp)

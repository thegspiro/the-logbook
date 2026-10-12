"""One staged external training row per provider record

A completion is identified by its provider's record id — for Target Solutions
the report's Transcript ID — and every path that stages one (scheduled sync,
manual sync, and from 2026-10-07 a manually uploaded report) looks the id up
before inserting. Two of those paths running at once can both miss and both
insert, so ``(provider_id, external_record_id)`` becomes a unique index and
the database refuses the second row.

Rows already duplicated are settled first, without deleting anything. In each
group the row that was imported into a training record is kept (the earliest,
if several were), else the earliest staged. Every other row in the group keeps
all of its data but has ``#dup:<its own id>`` appended to its record id so the
index can be built. One that was never imported is set to ``duplicate``, so it
leaves the officer's Imports queue; one that was imported keeps ``imported``,
because a training record already points at it and it is that record, not the
staging row, an officer would need to remove. Either way ``import_error``
records the original id and status, and a later sync updates the kept row.

The downgrade drops the unique index, restores the non-unique one, and puts
back each renamed row's original id and status from that note. A record id
longer than 214 characters is shortened to fit the suffix; the note keeps it
whole, so the downgrade restores it exactly.

Revision ID: 9bb4af123ebc
Revises: 8c4f2a6e1d93
Create Date: 2026-10-07 16:40:18.210976

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9bb4af123ebc"
down_revision: Union[str, None] = "8c4f2a6e1d93"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "external_training_imports"
_INDEX = "idx_ext_import_external"
_COLUMNS = ["provider_id", "external_record_id"]
_RECORD_ID_MAX = 255
_SUFFIX = "#dup:"
# "[dedup:<status>] <original id>" — written by upgrade, read by downgrade.
_NOTE_PREFIX = "[dedup:"


def _table_exists() -> bool:
    return _TABLE in sa.inspect(op.get_bind()).get_table_names()


def _index_unique() -> Union[bool, None]:
    """True/False for the index's uniqueness, None when it is absent."""
    for index in sa.inspect(op.get_bind()).get_indexes(_TABLE):
        if index["name"] == _INDEX:
            return bool(index.get("unique"))
    return None


def _settle_duplicates(bind) -> None:
    groups = bind.execute(
        sa.text(
            f"SELECT provider_id, external_record_id FROM {_TABLE} "
            "GROUP BY provider_id, external_record_id HAVING COUNT(*) > 1"
        )
    ).fetchall()
    for provider_id, record_id in groups:
        rows = bind.execute(
            sa.text(
                f"SELECT id, external_record_id, import_status FROM {_TABLE} "
                "WHERE provider_id = :provider AND external_record_id = :record "
                "ORDER BY (training_record_id IS NULL), created_at, id"
            ),
            {"provider": provider_id, "record": record_id},
        ).fetchall()
        for row_id, original, status in rows[1:]:
            suffix = f"{_SUFFIX}{row_id}"
            renamed = original[: _RECORD_ID_MAX - len(suffix)] + suffix
            bind.execute(
                sa.text(
                    f"UPDATE {_TABLE} SET external_record_id = :renamed, "
                    "import_status = :status, import_error = :note WHERE id = :id"
                ),
                {
                    "renamed": renamed,
                    "status": "imported" if status == "imported" else "duplicate",
                    "note": f"{_NOTE_PREFIX}{status or ''}] {original}",
                    "id": row_id,
                },
            )


def _restore_duplicates(bind) -> None:
    rows = bind.execute(
        sa.text(
            f"SELECT id, import_error FROM {_TABLE} " "WHERE import_error LIKE :marker"
        ),
        # MySQL's LIKE gives "[" no meaning; only % and _ are wildcards.
        {"marker": f"{_NOTE_PREFIX}%"},
    ).fetchall()
    for row_id, note in rows:
        header, _, original = note[len(_NOTE_PREFIX) :].partition("] ")
        bind.execute(
            sa.text(
                f"UPDATE {_TABLE} SET external_record_id = :original, "
                "import_status = :status, import_error = NULL WHERE id = :id"
            ),
            {"original": original, "status": header or None, "id": row_id},
        )


def upgrade() -> None:
    if not _table_exists() or _index_unique():
        return
    _settle_duplicates(op.get_bind())
    if _index_unique() is False:
        op.drop_index(_INDEX, table_name=_TABLE)
    op.create_index(_INDEX, _TABLE, _COLUMNS, unique=True)


def downgrade() -> None:
    if not _table_exists():
        return
    if _index_unique():
        op.drop_index(_INDEX, table_name=_TABLE)
    if _index_unique() is None:
        op.create_index(_INDEX, _TABLE, _COLUMNS, unique=False)
    _restore_duplicates(op.get_bind())

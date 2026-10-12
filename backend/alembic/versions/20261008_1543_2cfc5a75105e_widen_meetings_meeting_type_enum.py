"""Widen meetings.meeting_type with trustee, executive and annual

Minutes have always carried eight meeting types; the meeting record they are
written from accepted five, so a closed executive session could not be
recorded at all (W51-4). ``meetings.meeting_type`` is a native MySQL ENUM, so
it is widened in place with ``MODIFY COLUMN``. The column's nullability and
default are read from the live schema and written back unchanged rather than
guessed.

The downgrade turns any trustee, executive or annual meeting back into
``other`` — the nearest type the narrower column holds — and then narrows the
ENUM. Which of the three a row was is lost on the way down; nothing else is.
Minutes already written from such a meeting keep their own type, which lives
on ``meeting_minutes`` and is untouched in both directions.

Revision ID: 2cfc5a75105e
Revises: 7adc810c57f9
Create Date: 2026-10-08 15:43:52.613449

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "2cfc5a75105e"
down_revision: Union[str, None] = "7adc810c57f9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("meetings",)
_COLUMN = "meeting_type"
_OLD_VALUES = ("business", "special", "committee", "board", "other")
_NEW_VALUES = ("trustee", "executive", "annual")
_ALL_VALUES = ("business", "special", "committee", "board", *_NEW_VALUES, "other")
_FALLBACK = "other"


def _column(bind, table: str):
    """(column_type, is_nullable, default) for the live column, or None."""
    return bind.execute(
        sa.text(
            "SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT "
            "FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table "
            "AND COLUMN_NAME = :column"
        ),
        {"table": table, "column": _COLUMN},
    ).first()


def _modify(bind, table: str, values: Sequence[str]) -> None:
    live = _column(bind, table)
    if live is None:
        return
    _, is_nullable, default = live
    enum_sql = ", ".join(f"'{value}'" for value in values)
    definition = f"ENUM({enum_sql}) " + ("NULL" if is_nullable == "YES" else "NOT NULL")
    # MariaDB reports a string default quoted and a NULL default as the bare
    # word NULL; MySQL reports a string bare and NULL as SQL NULL.
    if default is not None and str(default) != "NULL":
        definition += f" DEFAULT '{str(default).strip(chr(39))}'"
    op.execute(f"ALTER TABLE {table} MODIFY COLUMN {_COLUMN} {definition}")


def _widened(column_type) -> bool:
    return all(f"'{value}'" in str(column_type) for value in _NEW_VALUES)


def upgrade() -> None:
    bind = op.get_bind()
    for table in _TABLES:
        live = _column(bind, table)
        # No table: create_all builds it later from the model, values included.
        if live is None or _widened(live[0]):
            continue
        _modify(bind, table, _ALL_VALUES)


def downgrade() -> None:
    bind = op.get_bind()
    for table in _TABLES:
        live = _column(bind, table)
        if live is None or not any(f"'{v}'" in str(live[0]) for v in _NEW_VALUES):
            continue
        bind.execute(
            sa.text(
                f"UPDATE {table} SET {_COLUMN} = :fallback "
                f"WHERE {_COLUMN} IN :values"
            ).bindparams(sa.bindparam("values", expanding=True)),
            {"fallback": _FALLBACK, "values": list(_NEW_VALUES)},
        )
        _modify(bind, table, _OLD_VALUES)

"""Add the policy_acknowledgment training type

A department's own read-and-acknowledge documents — whistleblower protections,
a code of conduct, anything a federal or local rule makes members re-read every
year — are recorded as training records of their own type, apart from courses.
Target Solutions marks them with an Assignment Type of "Admin".

``training_type`` is a native MySQL ENUM on five tables, so each is widened in
place with ``MODIFY COLUMN``. Each column's nullability and default are read
from the live schema and written back unchanged: they differ between tables
(``training_requirements`` allows NULL, the rest do not), and a hand-written
column definition that guessed would silently change one.

The downgrade turns any ``policy_acknowledgment`` row back into
``continuing_education`` — the type such a row was given before this revision —
and then narrows the ENUM. Which rows were acknowledgments is lost on the way
down; nothing else is.

Revision ID: 6cf89b44dc08
Revises: 9bb4af123ebc
Create Date: 2026-10-07 17:12:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "6cf89b44dc08"
down_revision: Union[str, None] = "9bb4af123ebc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = (
    "training_records",
    "training_requirements",
    "training_courses",
    "training_sessions",
    "training_submissions",
)
_COLUMN = "training_type"
_OLD_VALUES = (
    "certification",
    "continuing_education",
    "skills_practice",
    "orientation",
    "refresher",
    "specialty",
)
_NEW_VALUE = "policy_acknowledgment"
_FALLBACK = "continuing_education"


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
        # No table: create_all builds it later from the model, value included.
        return
    _, is_nullable, default = live
    enum_sql = ", ".join(f"'{value}'" for value in values)
    definition = f"ENUM({enum_sql}) " + ("NULL" if is_nullable == "YES" else "NOT NULL")
    # MariaDB reports a string default quoted and a NULL default as the bare
    # word NULL; MySQL reports a string bare and NULL as SQL NULL. A NULL
    # default needs no clause: it is what a nullable column gets anyway.
    if default is not None and str(default) != "NULL":
        definition += f" DEFAULT '{str(default).strip(chr(39))}'"
    op.execute(f"ALTER TABLE {table} MODIFY COLUMN {_COLUMN} {definition}")


def upgrade() -> None:
    bind = op.get_bind()
    for table in _TABLES:
        live = _column(bind, table)
        if live is None or f"'{_NEW_VALUE}'" in str(live[0]):
            continue
        _modify(bind, table, (*_OLD_VALUES, _NEW_VALUE))


def downgrade() -> None:
    bind = op.get_bind()
    for table in _TABLES:
        live = _column(bind, table)
        if live is None or f"'{_NEW_VALUE}'" not in str(live[0]):
            continue
        bind.execute(
            sa.text(
                f"UPDATE {table} SET {_COLUMN} = :fallback " f"WHERE {_COLUMN} = :value"
            ),
            {"fallback": _FALLBACK, "value": _NEW_VALUE},
        )
        _modify(bind, table, _OLD_VALUES)

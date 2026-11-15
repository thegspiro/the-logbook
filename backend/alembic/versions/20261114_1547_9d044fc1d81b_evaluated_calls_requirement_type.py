"""Add the evaluated-calls requirement type

A training requirement of type ``evaluated_calls`` counts the calls each
submitted shift evaluation records, the way ``transports`` counts its
transports (owner decision, 2026-11-14). Its target is ``required_calls``:
the ``calls`` type's own target, a number of calls in both, and every reader
of that column for the ``calls`` type checks the type first. The ``calls``
type stays fed by shift reports, so nothing is counted twice.

``training_requirements.requirement_type`` is a native MySQL ENUM, widened in
place with ``MODIFY COLUMN``; the column's nullability and default are read
from the live schema and written back unchanged, as e059227da2c0 and
89cfef37cca8 do. The value list is 89cfef37cca8's, the last revision to
widen it.

Existing rows: no existing value changes and no column is added, so no
existing requirement changes meaning.

Downgrade: requirements of the new type become ``checklist`` (no target, so
nothing is miscounted, and an officer can see and fix them), then the ENUM is
narrowed. Which requirements had the new type is lost on the way down; their
``required_calls`` and the progress their credits added stay.

Revision ID: 9d044fc1d81b
Revises: d3a7f5e2c916
Create Date: 2026-11-14 15:47:29

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9d044fc1d81b"
down_revision: Union[str, None] = "d3a7f5e2c916"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

REQUIREMENTS = "training_requirements"

_OLD_TYPES = (
    "hours",
    "courses",
    "certification",
    "shifts",
    "calls",
    "skills_evaluation",
    "checklist",
    "knowledge_test",
    "evaluated_shifts",
    "transports",
    "refusals",
    "session_attendance",
)
_NEW_TYPE = "evaluated_calls"
_TYPE_FALLBACK = "checklist"


def _column(bind, table: str, column: str):
    """(column_type, is_nullable, default) for the live column, or None."""
    return bind.execute(
        sa.text(
            "SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT "
            "FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table "
            "AND COLUMN_NAME = :column"
        ),
        {"table": table, "column": column},
    ).first()


def _modify_enum(bind, table: str, column: str, values: Sequence[str]) -> None:
    live = _column(bind, table, column)
    if live is None:
        return
    _, is_nullable, default = live
    enum_sql = ", ".join(f"'{value}'" for value in values)
    definition = f"ENUM({enum_sql}) " + ("NULL" if is_nullable == "YES" else "NOT NULL")
    # MariaDB reports a string default quoted and a NULL default as the bare
    # word NULL; MySQL reports a string bare and NULL as SQL NULL.
    if default is not None and str(default) != "NULL":
        definition += f" DEFAULT '{str(default).strip(chr(39))}'"
    op.execute(f"ALTER TABLE {table} MODIFY COLUMN {column} {definition}")


def _has_value(bind, table: str, column: str, value: str) -> bool:
    live = _column(bind, table, column)
    return live is not None and f"'{value}'" in str(live[0])


def upgrade() -> None:
    bind = op.get_bind()

    # No requirements table: create_all builds it from the model later, the
    # new value included (pitfall #26).
    if _column(bind, REQUIREMENTS, "requirement_type") is None:
        return

    if not _has_value(bind, REQUIREMENTS, "requirement_type", _NEW_TYPE):
        _modify_enum(bind, REQUIREMENTS, "requirement_type", (*_OLD_TYPES, _NEW_TYPE))


def downgrade() -> None:
    bind = op.get_bind()

    if not _has_value(bind, REQUIREMENTS, "requirement_type", _NEW_TYPE):
        return

    bind.execute(
        sa.text(
            f"UPDATE {REQUIREMENTS} SET requirement_type = :fallback "
            "WHERE requirement_type = :new_type"
        ),
        {"fallback": _TYPE_FALLBACK, "new_type": _NEW_TYPE},
    )
    _modify_enum(bind, REQUIREMENTS, "requirement_type", _OLD_TYPES)

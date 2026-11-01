"""Add the shift-evaluation requirement types

Three training requirement types credited by submitted shift evaluations:

- ``evaluated_shifts``: shifts with a submitted evaluation, counted against
  ``required_shifts``; ``evaluation_excludes_lowest_rating`` counts only those
  with no item at the form's lowest rating.
- ``transports`` and ``refusals``: the totals recorded on evaluations,
  counted against the new ``required_transports`` and ``required_refusals``.

``training_requirements.requirement_type`` and
``requirement_progress_credits.source_type`` (which gains
``shift_evaluation``) are native MySQL ENUMs, widened in place with
``MODIFY COLUMN``. Each column's nullability and default are read from the
live schema and written back unchanged, as 6cf89b44dc08 does.

Existing rows: the new columns are nullable or carry a server default, so
every existing requirement reads no transport or refusal target and
``evaluation_excludes_lowest_rating`` false; no existing value of either
ENUM changes.

Downgrade: requirements of the new types become ``checklist`` (no target, so
nothing is miscounted, and an officer can see and fix them), credits from
shift evaluations are deleted from the ledger, the ENUMs are narrowed and the
columns dropped. Which requirements had the new types, and the ledger rows,
are lost on the way down; the progress values those credits added stay.

Revision ID: e059227da2c0
Revises: 4262144ac214
Create Date: 2026-11-01 20:12:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e059227da2c0"
down_revision: Union[str, None] = "4262144ac214"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

REQUIREMENTS = "training_requirements"
CREDITS = "requirement_progress_credits"

_OLD_TYPES = (
    "hours",
    "courses",
    "certification",
    "shifts",
    "calls",
    "skills_evaluation",
    "checklist",
    "knowledge_test",
)
_NEW_TYPES = ("evaluated_shifts", "transports", "refusals")
_TYPE_FALLBACK = "checklist"

_OLD_SOURCES = ("training_session", "shift_report", "external_import", "officer_apply")
_NEW_SOURCE = "shift_evaluation"

_NEW_COLUMNS = (
    "required_transports",
    "required_refusals",
    "evaluation_excludes_lowest_rating",
)


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
        # No table: create_all builds it later from the model, values included.
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

    if _column(bind, REQUIREMENTS, "requirement_type") is not None and not all(
        _has_value(bind, REQUIREMENTS, "requirement_type", v) for v in _NEW_TYPES
    ):
        _modify_enum(bind, REQUIREMENTS, "requirement_type", (*_OLD_TYPES, *_NEW_TYPES))

    if _column(bind, CREDITS, "source_type") is not None and not _has_value(
        bind, CREDITS, "source_type", _NEW_SOURCE
    ):
        _modify_enum(bind, CREDITS, "source_type", (*_OLD_SOURCES, _NEW_SOURCE))

    if _column(bind, REQUIREMENTS, "requirement_type") is not None:
        if _column(bind, REQUIREMENTS, "required_transports") is None:
            op.add_column(
                REQUIREMENTS,
                sa.Column("required_transports", sa.Integer(), nullable=True),
            )
        if _column(bind, REQUIREMENTS, "required_refusals") is None:
            op.add_column(
                REQUIREMENTS,
                sa.Column("required_refusals", sa.Integer(), nullable=True),
            )
        if _column(bind, REQUIREMENTS, "evaluation_excludes_lowest_rating") is None:
            op.add_column(
                REQUIREMENTS,
                sa.Column(
                    "evaluation_excludes_lowest_rating",
                    sa.Boolean(),
                    nullable=False,
                    server_default="0",
                ),
            )


def downgrade() -> None:
    bind = op.get_bind()

    if _has_value(bind, CREDITS, "source_type", _NEW_SOURCE):
        bind.execute(
            sa.text(f"DELETE FROM {CREDITS} WHERE source_type = :source"),
            {"source": _NEW_SOURCE},
        )
        _modify_enum(bind, CREDITS, "source_type", _OLD_SOURCES)

    if _column(bind, REQUIREMENTS, "requirement_type") is not None:
        if any(
            _has_value(bind, REQUIREMENTS, "requirement_type", v) for v in _NEW_TYPES
        ):
            bind.execute(
                sa.text(
                    f"UPDATE {REQUIREMENTS} SET requirement_type = :fallback "
                    "WHERE requirement_type IN ('evaluated_shifts', 'transports', "
                    "'refusals')"
                ),
                {"fallback": _TYPE_FALLBACK},
            )
            _modify_enum(bind, REQUIREMENTS, "requirement_type", _OLD_TYPES)
        for column in _NEW_COLUMNS:
            if _column(bind, REQUIREMENTS, column) is not None:
                op.drop_column(REQUIREMENTS, column)

"""Add the session-attendance requirement type

A training requirement of type ``session_attendance`` is met by attending a
share of the sessions linked to it: "attend 60% of the company drills held
this year". The pieces:

- ``training_requirements.requirement_type`` gains ``session_attendance``.
  It is a native MySQL ENUM, widened in place with ``MODIFY COLUMN``; the
  column's nullability and default are read from the live schema and written
  back unchanged, as e059227da2c0 does.
- ``training_requirements.required_attendance_pct`` holds the share.
- ``training_session_requirements`` links sessions to the attendance
  requirements they count toward. A session belongs to any number of them, so
  this is a table rather than ``training_sessions.requirement_id``, which
  credits one requirement with the session's training and keeps that meaning.

Existing rows: the new column is nullable and the new table starts empty, so
no existing requirement or session changes meaning.

Downgrade: requirements of the new type become ``checklist`` (no target, so
nothing is miscounted, and an officer can see and fix them), the link table
and the column are dropped and the ENUM is narrowed. Which requirements had
the new type, their percentages and their session links are lost on the way
down.

Revision ID: 89cfef37cca8
Revises: 8da91e9d28d6
Create Date: 2026-11-04 17:00:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "89cfef37cca8"
down_revision: Union[str, None] = "8da91e9d28d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

REQUIREMENTS = "training_requirements"
LINKS = "training_session_requirements"

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
)
_NEW_TYPE = "session_attendance"
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


def _has_table(bind, table: str) -> bool:
    return (
        bind.execute(
            sa.text(
                "SELECT COUNT(*) FROM information_schema.TABLES "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table"
            ),
            {"table": table},
        ).scalar()
        > 0
    )


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

    # No requirements table: create_all builds it, and the link table, from
    # the models later, the new value and column included.
    if _column(bind, REQUIREMENTS, "requirement_type") is None:
        return

    if not _has_value(bind, REQUIREMENTS, "requirement_type", _NEW_TYPE):
        _modify_enum(bind, REQUIREMENTS, "requirement_type", (*_OLD_TYPES, _NEW_TYPE))

    if _column(bind, REQUIREMENTS, "required_attendance_pct") is None:
        op.add_column(
            REQUIREMENTS,
            sa.Column("required_attendance_pct", sa.Float(), nullable=True),
        )

    if not _has_table(bind, LINKS) and _has_table(bind, "training_sessions"):
        op.create_table(
            LINKS,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "session_id",
                sa.String(36),
                sa.ForeignKey("training_sessions.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "requirement_id",
                sa.String(36),
                sa.ForeignKey("training_requirements.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.UniqueConstraint(
                "session_id", "requirement_id", name="uq_training_session_requirement"
            ),
        )
        op.create_index(
            "idx_training_session_requirement_org", LINKS, ["organization_id"]
        )
        op.create_index(
            op.f("ix_training_session_requirements_requirement_id"),
            LINKS,
            ["requirement_id"],
        )


def downgrade() -> None:
    bind = op.get_bind()

    if _has_table(bind, LINKS):
        op.drop_table(LINKS)

    if _column(bind, REQUIREMENTS, "requirement_type") is None:
        return
    if _has_value(bind, REQUIREMENTS, "requirement_type", _NEW_TYPE):
        bind.execute(
            sa.text(
                f"UPDATE {REQUIREMENTS} SET requirement_type = :fallback "
                "WHERE requirement_type = :new"
            ),
            {"fallback": _TYPE_FALLBACK, "new": _NEW_TYPE},
        )
        _modify_enum(bind, REQUIREMENTS, "requirement_type", _OLD_TYPES)
    if _column(bind, REQUIREMENTS, "required_attendance_pct") is not None:
        op.drop_column(REQUIREMENTS, "required_attendance_pct")

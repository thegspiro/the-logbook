"""Normalize screening/shift ENUM columns to lowercase values

These seven columns were created without SQLAlchemy's ``values_callable``, so
their MySQL ENUM DDL held the UPPERCASE member names (``'PHYSICAL_EXAM'``,
``'OFFICER'``, ...) instead of the lowercase ``.value`` every other enum uses.
This migration converts the stored ENUM definition and existing rows to the
lowercase canonical values, matching the models (which now declare
``values_callable``) and the project-wide lowercase enum convention.

Each column is expanded to a superset of old+new labels, its rows are
lowercased, then the column is shrunk to the lowercase-only set — the standard
safe sequence for altering a populated MySQL ENUM.

Note: this deployment builds schema via ``create_all`` and stamps Alembic to
head, so this file documents the change and covers migration-run consumers; the
running instance is repaired by ``normalize_legacy_enum_case`` at startup.

Revision ID: 20260707_0001
Revises: 20260703_0001
Create Date: 2026-07-07 00:00:00.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260707_0001"
down_revision = "20260703_0001"
branch_labels = None
depends_on = None

_SCREENING_TYPE = [
    "physical_exam",
    "medical_clearance",
    "drug_screening",
    "vision_hearing",
    "fitness_assessment",
    "psychological",
]
_SCREENING_STATUS = [
    "scheduled",
    "completed",
    "passed",
    "failed",
    "pending_review",
    "waived",
    "expired",
]
_POSITION = [
    "officer",
    "driver",
    "firefighter",
    "ems",
    "captain",
    "lieutenant",
    "probationary",
    "volunteer",
    "other",
]
_ASSIGNMENT_STATUS = [
    "assigned",
    "confirmed",
    "declined",
    "pending",
    "cancelled",
    "no_show",
]
_SWAP_STATUS = ["pending", "approved", "denied", "cancelled"]
_TIMEOFF_STATUS = ["pending", "approved", "denied", "cancelled"]

# (table, column, lowercase_values, default_or_None)
_COLUMNS = [
    ("screening_requirements", "screening_type", _SCREENING_TYPE, None),
    ("screening_records", "screening_type", _SCREENING_TYPE, None),
    ("screening_records", "status", _SCREENING_STATUS, "scheduled"),
    ("shift_assignments", "position", _POSITION, "firefighter"),
    ("shift_assignments", "assignment_status", _ASSIGNMENT_STATUS, "assigned"),
    ("shift_swap_requests", "status", _SWAP_STATUS, "pending"),
    ("shift_time_off", "status", _TIMEOFF_STATUS, "pending"),
]


def _enum_clause(values):
    return ", ".join(f"'{v}'" for v in values)


def _quote(ident):
    return "`" + ident.replace("`", "``") + "`"


def upgrade() -> None:
    bind = op.get_bind()
    is_mysql = bind.dialect.name == "mysql"

    for table, column, lower, default in _COLUMNS:
        upper = [v.upper() for v in lower]
        tbl, col = _quote(table), _quote(column)

        if not is_mysql:
            # SQLite/other test DBs store the value as plain text; just rewrite rows.
            op.execute(f"UPDATE {tbl} SET {col} = LOWER({col})")
            continue

        superset = _enum_clause(list(dict.fromkeys(upper + lower)))
        op.execute(f"ALTER TABLE {tbl} MODIFY {col} ENUM({superset}) NOT NULL")
        op.execute(f"UPDATE {tbl} SET {col} = LOWER({col})")
        default_sql = f" DEFAULT '{default}'" if default is not None else ""
        op.execute(
            f"ALTER TABLE {tbl} MODIFY {col} "
            f"ENUM({_enum_clause(lower)}) NOT NULL{default_sql}"
        )


def downgrade() -> None:
    bind = op.get_bind()
    is_mysql = bind.dialect.name == "mysql"

    for table, column, lower, default in _COLUMNS:
        upper = [v.upper() for v in lower]
        tbl, col = _quote(table), _quote(column)

        if not is_mysql:
            op.execute(f"UPDATE {tbl} SET {col} = UPPER({col})")
            continue

        superset = _enum_clause(list(dict.fromkeys(upper + lower)))
        op.execute(f"ALTER TABLE {tbl} MODIFY {col} ENUM({superset}) NOT NULL")
        op.execute(f"UPDATE {tbl} SET {col} = UPPER({col})")
        default_sql = f" DEFAULT '{default.upper()}'" if default is not None else ""
        op.execute(
            f"ALTER TABLE {tbl} MODIFY {col} "
            f"ENUM({_enum_clause(upper)}) NOT NULL{default_sql}"
        )

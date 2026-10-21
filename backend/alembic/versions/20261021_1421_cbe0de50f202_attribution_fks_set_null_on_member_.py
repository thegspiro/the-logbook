"""Keep a trainee's skill tests and shift reports when the examiner is deleted.

Revision ID: cbe0de50f202
Revises: 1eb43da769b2
Create Date: 2026-10-21 14:21:09.191954

``skill_tests.examiner_id`` and ``shift_completion_reports.officer_id`` were
``NOT NULL`` with ``ON DELETE CASCADE`` to ``users.id``. Both rows belong to
*another* member — the candidate, the trainee — and the deleted user is only
the attribution, so permanently deleting an examiner or a field training
officer silently deleted every evaluation and report they had filed on other
members. Each column becomes nullable with ``ON DELETE SET NULL`` (CLAUDE.md
pitfall #2), matching the models.

Constraint names are read from information_schema: ``create_all`` and the
migration that built ``shift_completion_reports`` both left these keys unnamed,
so MySQL generated the names. For each column, every key to ``users.id`` that
is not already SET NULL is dropped, the column is made nullable, and a SET NULL
key is created under a fixed name. Idempotent: a column that already carries a
SET NULL key and is nullable is left alone, and a missing table or column (a
database ``create_all`` has not reached yet) is skipped — ``create_all`` builds
it from the models, which already declare the new shape (pitfall #26).

Downgrade restores ``ON DELETE CASCADE``. It restores ``NOT NULL`` only when no
row holds a NULL in the column: a NULL there means the examiner or officer was
deleted after the upgrade, and the only way back to ``NOT NULL`` would be to
delete the trainee's record — the very loss this revision exists to prevent —
or to invent an attribution. When such rows exist the column stays nullable
under the restored CASCADE key, which every earlier revision's code tolerates
(nothing before this one wrote NULL, and readers only compare the value).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cbe0de50f202"
down_revision: Union[str, None] = "1eb43da769b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (table, column, name of the key this revision creates)
_COLUMNS = [
    ("skill_tests", "examiner_id", "fk_skill_tests_examiner_id_users"),
    (
        "shift_completion_reports",
        "officer_id",
        "fk_shift_completion_reports_officer_id_users",
    ),
]


def _user_fks(table: str, column: str) -> list[tuple[str, str]]:
    """(constraint name, delete rule) of every key from table.column to users.id."""
    rows = op.get_bind().execute(
        sa.text(
            "SELECT k.constraint_name, r.delete_rule "
            "FROM information_schema.key_column_usage k "
            "JOIN information_schema.referential_constraints r "
            "  ON r.constraint_schema = k.constraint_schema "
            " AND r.constraint_name = k.constraint_name "
            " AND r.table_name = k.table_name "
            "WHERE k.table_schema = DATABASE() "
            "  AND k.table_name = :table AND k.column_name = :column "
            "  AND k.referenced_table_name = 'users' "
            "  AND k.referenced_column_name = 'id'"
        ),
        {"table": table, "column": column},
    )
    return [(row[0], row[1]) for row in rows]


def _column_nullable(table: str, column: str) -> bool | None:
    """The column's nullability, or None when the table or column is absent."""
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(table):
        return None
    for col in inspector.get_columns(table):
        if col["name"] == column:
            return bool(col["nullable"])
    return None


def upgrade() -> None:
    for table, column, key_name in _COLUMNS:
        nullable = _column_nullable(table, column)
        if nullable is None:
            continue
        keys = _user_fks(table, column)
        has_set_null = any(rule == "SET NULL" for _, rule in keys)
        # Drop the CASCADE key before relaxing the column, so the ALTER never
        # runs against a key whose action is about to change.
        for name, rule in keys:
            if rule != "SET NULL":
                op.drop_constraint(name, table, type_="foreignkey")
        if not nullable:
            op.alter_column(table, column, existing_type=sa.String(36), nullable=True)
        if not has_set_null:
            op.create_foreign_key(
                key_name, table, "users", [column], ["id"], ondelete="SET NULL"
            )


def downgrade() -> None:
    """Restore CASCADE; restore NOT NULL only where no row is NULL.

    See the module docstring: rows whose examiner or officer was deleted after
    the upgrade are kept, and their column stays nullable.
    """
    for table, column, key_name in _COLUMNS:
        nullable = _column_nullable(table, column)
        if nullable is None:
            continue
        keys = _user_fks(table, column)
        has_cascade = any(rule == "CASCADE" for _, rule in keys)
        for name, rule in keys:
            if rule != "CASCADE":
                op.drop_constraint(name, table, type_="foreignkey")
        if not has_cascade:
            op.create_foreign_key(
                key_name, table, "users", [column], ["id"], ondelete="CASCADE"
            )
        if nullable:
            orphaned = (
                op.get_bind()
                .execute(
                    sa.text(f"SELECT COUNT(*) FROM `{table}` WHERE `{column}` IS NULL")
                )
                .scalar()
            )
            if not orphaned:
                op.alter_column(
                    table, column, existing_type=sa.String(36), nullable=False
                )

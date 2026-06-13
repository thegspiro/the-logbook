"""Normalize forms.category ENUM to lowercase values

FormCategory was the only (str, Enum) in the codebase using Title-case values
("Safety", "Operations", ...) while every other enum is lowercase. This
migration converts the stored MySQL ENUM and existing rows to lowercase
("safety", "operations", ...) so the data matches the normalized enum.

The conversion expands the column to a superset of old+new values, rewrites
the rows, then shrinks the column to the lowercase-only set — the standard
safe sequence for altering a populated MySQL ENUM.

Revision ID: 20260613_0001
Revises: 20260610_0002
Create Date: 2026-06-13 00:00:00.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260613_0001"
down_revision = "20260610_0002"
branch_labels = None
depends_on = None

_OLD = ["Safety", "Operations", "Administration", "Training", "Other"]
_NEW = ["safety", "operations", "administration", "training", "other"]


def _enum_clause(values):
    return ", ".join(f"'{v}'" for v in values)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "mysql":
        # SQLite/other test DBs store the value as plain text; just rewrite rows.
        for old, new in zip(_OLD, _NEW):
            op.execute(f"UPDATE forms SET category = '{new}' WHERE category = '{old}'")
        return

    superset = _enum_clause(_OLD + _NEW)
    op.execute(f"ALTER TABLE forms MODIFY category ENUM({superset}) NOT NULL")
    op.execute("UPDATE forms SET category = LOWER(category)")
    op.execute(
        f"ALTER TABLE forms MODIFY category ENUM({_enum_clause(_NEW)}) "
        "NOT NULL DEFAULT 'operations'"
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "mysql":
        for old, new in zip(_OLD, _NEW):
            op.execute(f"UPDATE forms SET category = '{old}' WHERE category = '{new}'")
        return

    superset = _enum_clause(_OLD + _NEW)
    op.execute(f"ALTER TABLE forms MODIFY category ENUM({superset}) NOT NULL")
    # Title-case each lowercase value back to its original form.
    for old, new in zip(_OLD, _NEW):
        op.execute(f"UPDATE forms SET category = '{old}' WHERE category = '{new}'")
    op.execute(
        f"ALTER TABLE forms MODIFY category ENUM({_enum_clause(_OLD)}) "
        "NOT NULL DEFAULT 'Operations'"
    )

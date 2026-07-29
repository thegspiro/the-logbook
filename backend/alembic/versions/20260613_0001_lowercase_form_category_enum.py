"""Normalize forms.category ENUM to lowercase values

FormCategory was the only (str, Enum) in the codebase using Title-case values
("Safety", "Operations", ...) while every other enum is lowercase. This
migration converts the stored MySQL ENUM and existing rows to lowercase
("safety", "operations", ...) so the data matches the normalized enum.

MySQL ENUM labels are case-insensitive, so a superset ENUM of old+new labels
('Safety' + 'safety') is rejected with error 1291. The conversion therefore
routes through VARCHAR: ENUM→VARCHAR keeps the current label text, rows are
lowercased, then the column is redefined as the lowercase-only ENUM — the
same sequence as app/utils/enum_normalization.py and 20260707_0001.

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

    op.execute("ALTER TABLE forms MODIFY category VARCHAR(64) NOT NULL")
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

    op.execute("ALTER TABLE forms MODIFY category VARCHAR(64) NOT NULL")
    # Title-case each lowercase value back to its original form.
    for old, new in zip(_OLD, _NEW):
        op.execute(f"UPDATE forms SET category = '{old}' WHERE category = '{new}'")
    op.execute(
        f"ALTER TABLE forms MODIFY category ENUM({_enum_clause(_OLD)}) "
        "NOT NULL DEFAULT 'Operations'"
    )

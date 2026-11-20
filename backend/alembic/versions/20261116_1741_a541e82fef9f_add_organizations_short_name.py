"""Organizations: add a short name

Revision ID: a541e82fef9f
Revises: 0d54dd90d6ba
Create Date: 2026-11-16 17:41:32.163921

Adds ``organizations.short_name`` (VARCHAR(20), nullable): how the department
names itself where the full name will not fit, first read by a member's hours
screen, which lists the department's own shifts beside shifts worked for other
departments and labels each one.

Existing rows: the column is nullable with no default, so every existing
organization gets NULL, and every reader falls back to ``name`` on NULL. No row
is rewritten and nothing reads differently until an administrator sets one.

Safe to run twice: the column is added only when the table exists and the
column does not. The downgrade drops the column, which loses any short name an
administrator entered; the department's full name is untouched.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a541e82fef9f"
down_revision: Union[str, None] = "0d54dd90d6ba"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "organizations"
COLUMN = "short_name"


def _table_and_column() -> tuple[bool, bool]:
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return False, False
    return True, COLUMN in {c["name"] for c in inspector.get_columns(TABLE)}


def upgrade() -> None:
    has_table, has_column = _table_and_column()
    if has_table and not has_column:
        op.add_column(TABLE, sa.Column(COLUMN, sa.String(length=20), nullable=True))


def downgrade() -> None:
    has_table, has_column = _table_and_column()
    if has_table and has_column:
        op.drop_column(TABLE, COLUMN)

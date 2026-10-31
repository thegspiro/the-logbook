"""Meeting minutes: edit_version

Revision ID: e15d635bbb98
Revises: db30a34afa5b
Create Date: 2026-10-31 19:00:00.000000

Adds ``meeting_minutes.edit_version`` (MM5-4, owner decision 2026-10-31): a
counter every content save bumps, so a save that names an older value is
refused with 409 rather than overwriting another secretary's sections.

Existing rows get 0 through the server default, which is what a first save
then names, so no row needs a backfill. Safe to run twice: added only when
absent. The downgrade drops the column; nothing else reads it.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e15d635bbb98"
down_revision: Union[str, None] = "db30a34afa5b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "meeting_minutes"
COLUMN = "edit_version"


def _columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(TABLE)}


def upgrade() -> None:
    columns = _columns()
    # A table create_all has not built yet is built from the model, which
    # declares the column (CLAUDE.md pitfall #26).
    if not columns or COLUMN in columns:
        return
    op.add_column(
        TABLE,
        sa.Column(COLUMN, sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    if COLUMN in _columns():
        op.drop_column(TABLE, COLUMN)

"""Historical staffing settings

Adds ``historical_imports.staffing_settings``: the reviewer's decisions about a
staffing roster export (what each activity is, and which of the department's
seats or outreach roles each seat title means).

Nullable, with no default: every existing import has made no such decision,
which is exactly what NULL means to the reader, so no backfill is needed. The
step is skipped when the table is absent (pitfall #26); ``create_all`` then
builds it from the model, column included.

The downgrade drops the column, losing those decisions; nothing has been
written from them.

Revision ID: 8b2d4f6a1c3e
Revises: 5a7c3e91d2b4
Create Date: 2026-11-08 17:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8b2d4f6a1c3e"
down_revision: Union[str, None] = "5a7c3e91d2b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "historical_imports"
COLUMN = "staffing_settings"


def _has_column() -> bool:
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return False
    return COLUMN in {c["name"] for c in inspector.get_columns(TABLE)}


def _has_table() -> bool:
    return TABLE in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table() and not _has_column():
        op.add_column(TABLE, sa.Column(COLUMN, sa.JSON(), nullable=True))


def downgrade() -> None:
    if _has_column():
        op.drop_column(TABLE, COLUMN)

"""directory account pending group removals

Revision ID: 6c0e79521d14
Revises: f7535f478280
Create Date: 2026-10-23 16:40:22.892635

Adds ``directory_account_provisions.pending_group_removals``: the groups a
departed member's directory account still has to be taken out of. A
departure now removes the account from the integration's configured groups
(never a Microsoft 365 group that assigns licenses); a group the directory
would not remove it from stays listed here for the 15-minute sweep to retry,
the way ``pending_groups`` holds the groups a new account still has to join.

Additive and nullable, so no row needs a value: NULL means nothing is
waiting. Members who left before this revision are not taken out of their
groups -- the removal happens when a departure is recorded.

**Why each step is guarded.** The table may not exist yet on a database where
an earlier revision skipped it, and the column may already exist where
``create_all`` (or ``scripts/repair_schema.py``) built the table from the
model before Alembic reached this revision (CLAUDE.md pitfall #26).

**Downgrade** drops the column; only the list of removals still to retry is
lost.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "6c0e79521d14"
down_revision: Union[str, None] = "f7535f478280"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "directory_account_provisions"
COLUMN = "pending_group_removals"


def _has_table() -> bool:
    return TABLE in sa.inspect(op.get_bind()).get_table_names()


def _has_column() -> bool:
    if not _has_table():
        return False
    columns = sa.inspect(op.get_bind()).get_columns(TABLE)
    return COLUMN in {c["name"] for c in columns}


def upgrade() -> None:
    if _has_table() and not _has_column():
        op.add_column(TABLE, sa.Column(COLUMN, sa.JSON(), nullable=True))


def downgrade() -> None:
    if _has_column():
        op.drop_column(TABLE, COLUMN)

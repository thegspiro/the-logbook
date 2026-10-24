"""directory account name pending

Revision ID: c561cf7730ce
Revises: 26683fe99719
Create Date: 2026-10-23 16:55:41.000000

Adds ``directory_account_provisions.name_pending``: a member's name changed
in The Logbook and the account The Logbook created for them has not been
given it yet. The change is recorded in the same transaction as the rename
and sent to the directory after the commit; a failure leaves the flag set
for the 15-minute sweep, as a suspension does.

Additive. ``server_default`` 0, so every existing row reads as up to date:
names changed before this revision are not sent.

**Why each step is guarded.** The table may not exist yet on a database where
an earlier revision skipped it, and the column may already exist where
``create_all`` (or ``scripts/repair_schema.py``) built the table from the
model before Alembic reached this revision (CLAUDE.md pitfall #26).

**Downgrade** drops the column; a rename still waiting is not sent.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c561cf7730ce"
down_revision: Union[str, None] = "26683fe99719"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "directory_account_provisions"
COLUMN = "name_pending"


def _has_table() -> bool:
    return TABLE in sa.inspect(op.get_bind()).get_table_names()


def _has_column() -> bool:
    if not _has_table():
        return False
    columns = sa.inspect(op.get_bind()).get_columns(TABLE)
    return COLUMN in {c["name"] for c in columns}


def upgrade() -> None:
    if _has_table() and not _has_column():
        op.add_column(
            TABLE,
            sa.Column(COLUMN, sa.Boolean(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    if _has_column():
        op.drop_column(TABLE, COLUMN)

"""directory account long suspended since

Revision ID: 26683fe99719
Revises: 6c0e79521d14
Create Date: 2026-10-23 16:51:21.000000

Adds ``directory_account_provisions.long_suspended_since``: when the daily
departure check, which lists the directory, first found a departed member's
account still there more than 90 days after it was suspended. A suspended
account keeps its license until it is deleted or unlicensed, so the
Integrations attention list shows these and the administrators' morning
email names each once (owner decision, 2026-10-23: list them, never remove a
license automatically). The check clears it when the account is gone from
the directory, and a return clears it.

Additive and nullable: NULL means not reported. Accounts already long
suspended are found on the first daily check after the upgrade.

**Why each step is guarded.** The table may not exist yet on a database where
an earlier revision skipped it, and the column may already exist where
``create_all`` (or ``scripts/repair_schema.py``) built the table from the
model before Alembic reached this revision (CLAUDE.md pitfall #26).

**Downgrade** drops the column; the next check after a re-upgrade reports
the same accounts again.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "26683fe99719"
down_revision: Union[str, None] = "6c0e79521d14"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "directory_account_provisions"
COLUMN = "long_suspended_since"


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
            TABLE, sa.Column(COLUMN, sa.DateTime(timezone=True), nullable=True)
        )


def downgrade() -> None:
    if _has_column():
        op.drop_column(TABLE, COLUMN)

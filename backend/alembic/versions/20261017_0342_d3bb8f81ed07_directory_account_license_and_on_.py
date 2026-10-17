"""directory account license and on premises flags

Revision ID: d3bb8f81ed07
Revises: 73594b326e68
Create Date: 2026-10-17 03:42:00.000000

Adds two flags to ``directory_account_provisions`` for Microsoft 365:

- ``license_pending``: the account exists but the configured license could
  not be assigned yet, so it has no mailbox; a retry assigns it.
- ``managed_on_premises``: the account is synced from on-premises Active
  Directory, which Microsoft 365 cannot suspend; an administrator disables it
  there, and the scheduled sweep stops retrying.

Both are ``NOT NULL DEFAULT 0``. Every existing row is a Google account, for
which both are false, so no backfill is needed.

**Why each step is guarded.** The table may be absent (no earlier revision
built it, CLAUDE.md pitfall #26), or ``create_all`` may already have built it
from the model with these columns.

**Downgrade** drops both columns. A Microsoft account then loses the marker
that its license is outstanding or that it lives on-premises; the previous
revision's downgrade removes Microsoft rows altogether.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d3bb8f81ed07"
down_revision: Union[str, None] = "73594b326e68"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "directory_account_provisions"
COLUMNS = ("license_pending", "managed_on_premises")


def _has_table() -> bool:
    return TABLE in sa.inspect(op.get_bind()).get_table_names()


def _columns() -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(TABLE)}


def upgrade() -> None:
    if not _has_table():
        return
    existing = _columns()
    for column in COLUMNS:
        if column not in existing:
            op.add_column(
                TABLE,
                sa.Column(column, sa.Boolean(), nullable=False, server_default="0"),
            )


def downgrade() -> None:
    if not _has_table():
        return
    existing = _columns()
    for column in COLUMNS:
        if column in existing:
            op.drop_column(TABLE, column)

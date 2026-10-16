"""google account suspension requested at

Revision ID: 64bf75298e89
Revises: c869ec90a41b
Create Date: 2026-10-16 17:54:03.184834

Adds ``google_account_provisions.suspension_requested_at``: when a member's
departure (or return) asked for their Google account to be suspended (or
unsuspended). The "needs attention" list and the daily alert measure how long
an account has been waiting from it; ``updated_at`` cannot, because every
retry moves it.

Additive and nullable. A suspension already waiting at upgrade time has no
recorded request time, so it is stamped with the upgrade's own time: its true
start is unknown, and without a stamp it would be measured from
``updated_at``, which the 15-minute sweep moves on every retry -- it would
never count as overdue and never be emailed. Stamped, it is reported a day
after the upgrade if it is still waiting.

**Why each step is guarded.** The table may not exist yet on a database where
an earlier revision skipped it, and the column may already exist where
``create_all`` (or ``scripts/repair_schema.py``) built the table from the
model before Alembic reached this revision (CLAUDE.md pitfall #26).

**Downgrade** drops the column; only the recorded request times are lost.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "64bf75298e89"
down_revision: Union[str, None] = "c869ec90a41b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "google_account_provisions"
COLUMN = "suspension_requested_at"


def _has_column() -> bool:
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return False
    return COLUMN in {c["name"] for c in inspector.get_columns(TABLE)}


def _has_table() -> bool:
    return TABLE in sa.inspect(op.get_bind()).get_table_names()


def _backfill(bind: sa.engine.Connection) -> None:
    bind.execute(
        sa.text(
            f"UPDATE {TABLE} SET {COLUMN} = CURRENT_TIMESTAMP "
            f"WHERE suspension_settled = 0 AND {COLUMN} IS NULL"
        )
    )


def upgrade() -> None:
    if not _has_table():
        return
    if not _has_column():
        op.add_column(
            TABLE, sa.Column(COLUMN, sa.DateTime(timezone=True), nullable=True)
        )
    # Whichever path built the column, a waiting row needs a start time.
    _backfill(op.get_bind())


def downgrade() -> None:
    if _has_column():
        op.drop_column(TABLE, COLUMN)

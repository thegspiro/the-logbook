"""google account suspension requested at

Revision ID: 64bf75298e89
Revises: 0bbf263a5ff0
Create Date: 2026-10-16 17:54:03.184834

Adds ``google_account_provisions.suspension_requested_at``: when a member's
departure (or return) asked for their Google account to be suspended (or
unsuspended). The "needs attention" list and the daily alert measure how long
an account has been waiting from it; ``updated_at`` cannot, because every
retry moves it.

Purely additive and nullable. Nothing is backfilled: a row waiting at upgrade
time has no recorded request time, and readers fall back to ``updated_at``
for it, so it is listed at once and alerted on once it stops being retried.

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
down_revision: Union[str, None] = "0bbf263a5ff0"
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


def upgrade() -> None:
    if not _has_table() or _has_column():
        return
    op.add_column(TABLE, sa.Column(COLUMN, sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    if _has_column():
        op.drop_column(TABLE, COLUMN)

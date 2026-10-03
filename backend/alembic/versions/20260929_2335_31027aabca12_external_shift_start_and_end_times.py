"""External shift hours: keep the shift's start and end times

Adds two nullable columns to ``external_shift_hours``:

* ``start_at`` — when the shift began (UTC).
* ``end_at`` — when it ended (UTC).

A member now logs an outside shift by its start and end, and the entry's
``shift_date`` and ``duration_minutes`` are derived from them. Both columns
are nullable because every existing entry was logged as a date and an hours
figure and has no times to backfill; those rows are left exactly as they are,
and no hours total changes on upgrade.

Each column is guarded on its absence: a fresh install that ran
``create_all`` already has them.

**Downgrade** drops both columns. The date and hours every entry counts by
are untouched, so no total changes; only the recorded times are lost.

Revision ID: 31027aabca12
Revises: 2b15c5a8ba82
Create Date: 2026-09-29 23:35:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "31027aabca12"
down_revision: Union[str, None] = "2b15c5a8ba82"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "external_shift_hours"
_COLUMNS = ("start_at", "end_at")


def _columns() -> set:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(_TABLE)}


def upgrade() -> None:
    if _TABLE not in sa.inspect(op.get_bind()).get_table_names():
        return
    existing = _columns()
    for name in _COLUMNS:
        if name not in existing:
            op.add_column(
                _TABLE,
                sa.Column(name, sa.DateTime(timezone=True), nullable=True),
            )


def downgrade() -> None:
    existing = _columns()
    for name in reversed(_COLUMNS):
        if name in existing:
            op.drop_column(_TABLE, name)

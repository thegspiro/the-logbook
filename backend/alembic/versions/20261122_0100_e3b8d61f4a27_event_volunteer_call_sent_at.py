"""Events: when an event's own signup sheet last emailed for volunteers

Revision ID: e3b8d61f4a27
Revises: b6e3d1f47a29
Create Date: 2026-11-22 01:00:00.000000

An outreach event that opened its own signup sheet can now email the
membership for help, as a request's sheet always could. ``events`` gains
``volunteer_call_sent_at`` (DATETIME, nullable), recorded on each send so a
second organizer can see the call already went out.

Existing rows: added nullable and left NULL — no event has sent a call before
— so nothing is rewritten and nothing can fail on them. Safe to run twice: the
column is added only when missing. A table only ``create_all`` builds
(CLAUDE.md pitfall #26) is skipped; it is built from the model.

The downgrade drops the column and with it the record of when calls were sent.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e3b8d61f4a27"
down_revision: Union[str, None] = "b6e3d1f47a29"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "events"
COLUMN = "volunteer_call_sent_at"


def _columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(TABLE)}


def upgrade() -> None:
    columns = _columns()
    if columns and COLUMN not in columns:
        op.add_column(
            TABLE, sa.Column(COLUMN, sa.DateTime(timezone=True), nullable=True)
        )


def downgrade() -> None:
    if COLUMN in _columns():
        op.drop_column(TABLE, COLUMN)

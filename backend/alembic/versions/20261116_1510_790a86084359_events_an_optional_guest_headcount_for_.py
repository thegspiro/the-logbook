"""Events: an optional guest headcount for outreach events

Revision ID: 790a86084359
Revises: 0d54dd90d6ba
Create Date: 2026-11-16 15:10:30.905904

A school assembly or a block party does not pass round a sign-in sheet, so
the Community Engagement report could only ever show the audience the
requester expected for it. ``events.guest_headcount`` is the number of guests
a coordinator counted, entered on the event page; the report treats it as the
event's actual figure in place of guest sign-ins.

Existing rows: the column is nullable with no default, and every existing
event reads NULL, meaning "nobody counted" — which is what each of them was
until now. Nothing is backfilled, so the report reads exactly as before for
every event until somebody records a count.

Safe to run twice. Downgrade drops the column and any recorded counts with it;
the report then falls back to sign-ins and estimates, as it did before.
"""

from typing import Optional, Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "790a86084359"
down_revision: Union[str, None] = "0d54dd90d6ba"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "events"
COLUMN = "guest_headcount"


def _columns() -> Optional[set[str]]:
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return None
    return {c["name"] for c in inspector.get_columns(TABLE)}


def upgrade() -> None:
    columns = _columns()
    if columns is None or COLUMN in columns:
        return
    op.add_column(TABLE, sa.Column(COLUMN, sa.Integer(), nullable=True))


def downgrade() -> None:
    columns = _columns()
    if columns is None or COLUMN not in columns:
        return
    op.drop_column(TABLE, COLUMN)

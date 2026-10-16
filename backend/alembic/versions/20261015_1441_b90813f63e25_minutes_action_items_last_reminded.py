"""Minutes action items: when the assignee was last reminded

Adds ``minutes_action_items.last_reminded_at``, nullable. The daily action-item
reminder task reads it to email each reminder once and to space repeat
reminders on an overdue item. Nothing is backfilled: every existing item keeps
NULL, which reads as "never reminded by email", so an open item that is already
due gets its first email on the first run after the upgrade.

The table may be absent on a fresh database where ``create_all`` builds it from
the models (which already declare the column), so the step is skipped then.

The downgrade drops the column; the reminder history in it is lost.

Revision ID: b90813f63e25
Revises: bb60bd43bede
Create Date: 2026-10-15 14:41:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b90813f63e25"
down_revision: Union[str, None] = "bb60bd43bede"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "minutes_action_items"
COLUMN = "last_reminded_at"


def _columns() -> set[str] | None:
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return None
    return {c["name"] for c in inspector.get_columns(TABLE)}


def upgrade() -> None:
    existing = _columns()
    if existing is not None and COLUMN not in existing:
        op.add_column(
            TABLE, sa.Column(COLUMN, sa.DateTime(timezone=True), nullable=True)
        )


def downgrade() -> None:
    existing = _columns()
    if existing is not None and COLUMN in existing:
        op.drop_column(TABLE, COLUMN)

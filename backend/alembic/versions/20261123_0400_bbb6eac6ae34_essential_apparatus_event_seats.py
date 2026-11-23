"""Apparatus event seats: essential or not

Revision ID: bbb6eac6ae34
Revises: 986d6575af35
Create Date: 2026-11-23 04:00:00.000000

Owner decision, 2026-11-23: a seat on an apparatus event can be marked
non-essential (welcome but optional), so a coordinator can see at a glance
whether every seat the night cannot run without is filled.

Adds ``is_essential`` to ``apparatus_event_template_seats`` and
``event_apparatus_seats``: NOT NULL with a server default of true.

Existing rows (pitfall #35): every seat becomes essential, which is how they
all counted before this revision, so no night reads differently after the
upgrade. The server default fills them; nothing else is touched. Safe to run
twice: a present column is left alone. A table only ``create_all`` builds
(pitfall #26) is skipped; it is built from the models, which declare the
column.

The downgrade drops the columns, losing which seats were marked
non-essential; the previous release has nowhere to keep it.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "bbb6eac6ae34"
down_revision: Union[str, None] = "986d6575af35"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ("apparatus_event_template_seats", "event_apparatus_seats")
COLUMN = "is_essential"


def _columns(table: str) -> set[str] | None:
    """The table's column names, or None when the table is absent."""
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return None
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    for table in TABLES:
        columns = _columns(table)
        if columns is None or COLUMN in columns:
            continue
        op.add_column(
            table,
            sa.Column(COLUMN, sa.Boolean(), nullable=False, server_default="1"),
        )


def downgrade() -> None:
    for table in TABLES:
        columns = _columns(table)
        if columns is None or COLUMN not in columns:
            continue
        op.drop_column(table, COLUMN)

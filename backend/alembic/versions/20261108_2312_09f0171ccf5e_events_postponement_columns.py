"""Events: postponement columns

Revision ID: 09f0171ccf5e
Revises: 78f196079c95
Create Date: 2026-11-08 23:12:36.290544

Adds the record of a postponement to ``events`` (workflow review W80-11, owner
decision 2026-11-08), alongside the cancellation columns it mirrors:

- ``postponed_at`` — when the event was last postponed;
- ``postponed_from_start`` — the start it had before its first postponement,
  so a drill moved twice still says where it was originally scheduled;
- ``postponement_reason`` — why, as the officer gave it.

Existing rows: all three are nullable and no event has been postponed through
this action before, so every row takes NULL and nothing is backfilled; no
behaviour changes until an officer postpones an event. Safe to run twice: each
column is added only when absent. The downgrade drops them; a postponed
event's dates survive (they are ``start_datetime`` / ``end_datetime``), and
only the note that it was postponed, and from when, is lost.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "09f0171ccf5e"
down_revision: Union[str, None] = "78f196079c95"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "events"


def _new_columns() -> list[sa.Column]:
    return [
        sa.Column("postponed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("postponed_from_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("postponement_reason", sa.Text(), nullable=True),
    ]


def _columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(TABLE)}


def upgrade() -> None:
    present = _columns()
    # A table create_all has not built yet is built from the model, which
    # declares the columns (CLAUDE.md pitfall #26).
    if not present:
        return
    for column in _new_columns():
        if column.name not in present:
            op.add_column(TABLE, column)


def downgrade() -> None:
    present = _columns()
    for column in reversed(_new_columns()):
        if column.name in present:
            op.drop_column(TABLE, column.name)

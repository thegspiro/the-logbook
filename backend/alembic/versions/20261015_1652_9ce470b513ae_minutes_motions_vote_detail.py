"""Minutes motions: how the vote was taken

Adds three nullable columns to ``meeting_motions``:

* ``votes_recused`` — members who recused themselves, counted in neither the
  votes cast nor the abstentions.
* ``threshold`` — what the motion needed to carry (``majority_cast``,
  ``majority_present`` or ``two_thirds``); NULL reads as a majority of the
  votes cast, which is what every existing motion was decided by.
* ``roll_call`` — each member's vote when taken by roll call (JSON).

Nothing is backfilled: every existing motion keeps NULL in all three. The table
may be absent on a fresh database where ``create_all`` builds it from the models
(which already declare these columns), so the step is skipped then.

The downgrade drops the columns; recorded roll calls are lost with them, the
totals on each motion stay.

Revision ID: 9ce470b513ae
Revises: b90813f63e25
Create Date: 2026-10-15 16:52:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9ce470b513ae"
down_revision: Union[str, None] = "b90813f63e25"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "meeting_motions"


def _columns() -> set[str] | None:
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return None
    return {c["name"] for c in inspector.get_columns(TABLE)}


def upgrade() -> None:
    existing = _columns()
    if existing is None:
        return
    if "votes_recused" not in existing:
        op.add_column(TABLE, sa.Column("votes_recused", sa.Integer(), nullable=True))
    if "threshold" not in existing:
        op.add_column(TABLE, sa.Column("threshold", sa.String(20), nullable=True))
    if "roll_call" not in existing:
        op.add_column(TABLE, sa.Column("roll_call", sa.JSON(), nullable=True))


def downgrade() -> None:
    existing = _columns()
    if existing is None:
        return
    for name in ("roll_call", "threshold", "votes_recused"):
        if name in existing:
            op.drop_column(TABLE, name)

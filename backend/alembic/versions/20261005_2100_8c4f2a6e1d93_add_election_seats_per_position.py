"""add election seats_per_position

``max_votes_per_position`` lets a voter pick several candidates, but the
tally had no seat count: a "2027 Board of Directors (2 seats)" race elected
one person and the report read "ELECTED" beside one name (W50-11). The
owner chose a real seat count — schema, migration, tally and UI — over
restricting elections to one person per position. This is that column.

NOT NULL with a server default of 1: every existing election keeps
electing one candidate per race, which is what its tally always did, so no
certified result changes on upgrade.

Idempotent: the column is added only when absent, and the step is skipped
when ``elections`` does not exist yet (CI upgrades an empty database).

Revision ID: 8c4f2a6e1d93
Revises: 5b1e7d3c9a42
Create Date: 2026-10-05 21:00:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8c4f2a6e1d93"
down_revision: Union[str, None] = "5b1e7d3c9a42"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLE = "elections"
COLUMN = "seats_per_position"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    if not _has_table(TABLE):
        return
    if not _has_column(TABLE, COLUMN):
        op.add_column(
            TABLE,
            sa.Column(COLUMN, sa.Integer(), nullable=False, server_default="1"),
        )


def downgrade() -> None:
    if not _has_table(TABLE):
        return
    if _has_column(TABLE, COLUMN):
        op.drop_column(TABLE, COLUMN)

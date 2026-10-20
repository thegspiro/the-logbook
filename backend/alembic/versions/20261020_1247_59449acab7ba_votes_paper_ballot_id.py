"""Group the rows of one ranked paper ballot

A ranked paper ballot is stored as one vote row per ranked candidate (rank 1,
rank 2, ...). Instant-runoff counting has to read those rows as one voter's
preferences, but a paper ballot carries no voter identity to group them by —
and must not be given one, because ``voter_hash`` / ``voter_id`` feed turnout
and the double-vote checks. ``votes.paper_ballot_id`` is the grouping key:
the same value on every row of one paper ballot, NULL everywhere else.

Additive and nullable. Existing rows are left NULL; nothing is backfilled,
because no stored paper vote carries a ranking to group. The downgrade drops
the column; ranked paper ballots recorded since then lose their grouping, and
the older counter reads each of their rows as a separate one-choice ballot.

Revision ID: 59449acab7ba
Revises: ca0c2111466f
Create Date: 2026-10-20 12:47:43.589430

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "59449acab7ba"
down_revision: Union[str, None] = "ca0c2111466f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "votes"
_COLUMN = "paper_ballot_id"


def _columns() -> set:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(_TABLE)}


def upgrade() -> None:
    columns = _columns()
    # No table: create_all builds it later from the model, column included.
    if not columns or _COLUMN in columns:
        return
    op.add_column(_TABLE, sa.Column(_COLUMN, sa.String(36), nullable=True))


def downgrade() -> None:
    if _COLUMN in _columns():
        op.drop_column(_TABLE, _COLUMN)

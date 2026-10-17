"""ballot send jobs: record whether a job sends ballots or a reminder

Remind Non-Voters ran inside the HTTP request and hit the same 30-second
browser timeout ballot sends did. It now runs as a ``ballot_send_jobs`` row
too, and the column says which send a row is. Every existing row is a ballot
send, which the server default records.

Reminders share the table, rather than getting their own, because both sends
mint fresh voting tokens: the guard against two overlapping sends for one
election must see both.

Guarded on the table existing, since c87efd81c5aa skips creating it on a
database missing its parent tables. The downgrade drops the column; rows that
were reminders then read as ballot sends, which only affects the history of
past sends.

Revision ID: 244b0fd07205
Revises: c87efd81c5aa
Create Date: 2026-10-17 03:36:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "244b0fd07205"
down_revision: Union[str, None] = "c87efd81c5aa"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "ballot_send_jobs"
_COLUMN = "kind"


def _has_column() -> bool:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        return False
    return _COLUMN in {c["name"] for c in inspector.get_columns(_TABLE)}


def _has_table() -> bool:
    return _TABLE in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _has_table() or _has_column():
        return
    op.add_column(
        _TABLE,
        sa.Column(
            _COLUMN,
            sa.String(length=20),
            nullable=False,
            server_default="ballots",
        ),
    )


def downgrade() -> None:
    if _has_column():
        op.drop_column(_TABLE, _COLUMN)

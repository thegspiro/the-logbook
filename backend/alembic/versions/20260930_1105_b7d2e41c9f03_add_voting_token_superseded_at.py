"""add voting_tokens.superseded_at

A non-voter reminder mails a fresh ballot link and expires the member's
older unused tokens, so the older link answered "Voting token has expired"
while voting was still open — read by members as the election being over
(W50-27). ``remind_non_voters`` now also stamps ``superseded_at`` on the
tokens it retires, and the ballot lookup reports a stamped token as
replaced by a newer ballot email instead.

Nullable: every token retired before this revision keeps NULL and goes on
reading as expired, which is all that was ever recorded about it.

Idempotent: the column is added only when absent, and the whole step is
skipped when ``voting_tokens`` does not exist yet (CI upgrades an empty
database, and ``create_all`` builds the column from the model).

Revision ID: b7d2e41c9f03
Revises: ac06a2998013
Create Date: 2026-09-30 11:05:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7d2e41c9f03"
down_revision: Union[str, None] = "ac06a2998013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLE = "voting_tokens"
COLUMN = "superseded_at"


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
            TABLE, sa.Column(COLUMN, sa.DateTime(timezone=True), nullable=True)
        )


def downgrade() -> None:
    if not _has_table(TABLE):
        return
    if _has_column(TABLE, COLUMN):
        op.drop_column(TABLE, COLUMN)

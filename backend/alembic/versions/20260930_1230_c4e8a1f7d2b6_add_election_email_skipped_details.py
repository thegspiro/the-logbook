"""add election email_skipped_details

The close report listed "members who did not receive ballots" by diffing
every active member against ``email_recipients`` and then re-deriving a
reason for each at close time, so it invented facts: 21 members "did not
match any item requirements" on an election with no items, and "No ballot
emails were sent" sat beside "All active members received ballots"
(W50-33). ``send_ballot_emails`` already computes a per-member skip reason
at the moment it decides; this column keeps that list so the report has
one source for who was skipped and why.

Nullable: an election whose ballots went out before this revision has no
record of who was skipped, and the report says so rather than guessing.

Idempotent: the column is added only when absent, and the whole step is
skipped when ``elections`` does not exist yet (CI upgrades an empty
database; ``create_all`` builds the column from the model).

Revision ID: c4e8a1f7d2b6
Revises: b7d2e41c9f03
Create Date: 2026-09-30 12:30:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4e8a1f7d2b6"
down_revision: Union[str, None] = "b7d2e41c9f03"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLE = "elections"
COLUMN = "email_skipped_details"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    if not _has_table(TABLE):
        return
    if not _has_column(TABLE, COLUMN):
        op.add_column(TABLE, sa.Column(COLUMN, sa.JSON(), nullable=True))


def downgrade() -> None:
    if not _has_table(TABLE):
        return
    if _has_column(TABLE, COLUMN):
        op.drop_column(TABLE, COLUMN)

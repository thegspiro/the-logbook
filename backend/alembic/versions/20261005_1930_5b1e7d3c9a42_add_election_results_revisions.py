"""add election results_revisions

Merge Write-Ins, Void a Vote and a paper-batch void remain allowed after an
election closes — they are how a certified result is corrected — but they
re-issued the tally silently, with the certified PDF's record unchanged
(W50-9). The owner chose to keep the corrections and mark each one,
"Results revised <when> by <who>", on the PDF and the Results tab. This is
the column ``_record_results_revision`` appends those stamps to.

Nullable JSON: an election closed before this revision, or never revised,
keeps NULL, which reads as "no revisions". Nothing is backfilled — a
correction made before the column existed was never recorded as one, and
the audit log already holds the void and merge events themselves.

Idempotent: the column is added only when absent, and the step is skipped
when ``elections`` does not exist yet (CI upgrades an empty database).

Revision ID: 5b1e7d3c9a42
Revises: 24f56e4fc320
Create Date: 2026-10-05 19:30:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5b1e7d3c9a42"
down_revision: Union[str, None] = "24f56e4fc320"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLE = "elections"
COLUMN = "results_revisions"


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

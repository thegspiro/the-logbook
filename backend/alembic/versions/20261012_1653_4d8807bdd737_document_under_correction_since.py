"""Mark a published document whose minutes were reopened for correction

MM-17 residual. ``POST /minutes-records/{id}/reopen`` returns approved minutes
to draft, and the document already published from them stayed in Documents
with nothing to say it no longer reflected an approved record. Owner decision
(2026-10-12): the document stays readable but carries a "Being corrected"
notice until the corrected minutes are republished, which replaces it.

* ``documents.under_correction_since`` (DATETIME, nullable): when the source
  record was reopened. NULL means the document is current. Set on reopen,
  cleared when the minutes are published again. It is stored rather than
  derived from the minutes' status because the notice must outlive the
  re-approval -- re-approved minutes that have not been republished still
  leave the old text in Documents -- and because the notice states the date.

No backfill: a reopen that happened before this revision left no trace on the
document, so such a document reads as current until it is republished, exactly
as it did before. Downgrade drops the column, losing only the flag.

Revision ID: 4d8807bdd737
Revises: bcd688674099
Create Date: 2026-10-12 16:53:41.260881

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "4d8807bdd737"
down_revision: Union[str, None] = "bcd688674099"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "documents"
COLUMN = "under_correction_since"


def _columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(TABLE)}


def _has_table() -> bool:
    return TABLE in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    # Guarded both ways: on a database where create_all has not yet built the
    # table, create_all will build it from the model, which declares the
    # column; and a re-run finds the column already there.
    if not _has_table() or COLUMN in _columns():
        return
    op.add_column(
        TABLE,
        sa.Column(COLUMN, sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    if COLUMN in _columns():
        op.drop_column(TABLE, COLUMN)

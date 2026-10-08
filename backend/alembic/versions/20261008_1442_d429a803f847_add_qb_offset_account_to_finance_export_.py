"""Add the balancing account to QuickBooks export mappings

A QuickBooks Online journal entry must carry equal debits and credits, so the
finance export now writes each transaction as two lines: the category's
expense account and the account the money was paid from. This adds
``finance_export_mappings.qb_offset_account_name`` to hold the second one.

The column is nullable and no existing row is backfilled: which bank or
clearing account a department pays from is its own bookkeeping decision, and
guessing one would post real money to the wrong account. A mapping left
without one makes the export refuse with a message naming the category.

``finance_export_mappings`` is built by ``create_all`` and by no migration, so
the step is skipped when the table is absent. A table ``create_all`` builds
later already carries the column from the model.

The downgrade drops the column and the offset accounts stored in it.

Revision ID: d429a803f847
Revises: 1be4fbbc235d
Create Date: 2026-10-08 14:42:37.386668

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d429a803f847"
down_revision: Union[str, None] = "1be4fbbc235d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "finance_export_mappings"
_COLUMN = "qb_offset_account_name"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    if _has_table(_TABLE) and not _has_column(_TABLE, _COLUMN):
        op.add_column(_TABLE, sa.Column(_COLUMN, sa.String(200), nullable=True))


def downgrade() -> None:
    if _has_table(_TABLE) and _has_column(_TABLE, _COLUMN):
        op.drop_column(_TABLE, _COLUMN)

"""Add item_issuances.lot_allocations

An item that has any stock lot is lot-stocked: ``_in_date_lot_totals`` reports
it, and every reader stops consulting ``InventoryItem.quantity``. Issuing from
such an item draws down the lots — but the return path credited
``item.quantity`` unconditionally, so returned units landed in a column nothing
reads and vanished from available stock permanently.

This column records which lots an issuance drew from, so the return can put the
units back where they came from. NULL means the issuance came out of the column
ledger (or predates the column), and those still return to ``quantity``.

Guarded on the table existing: fresh installs come up through ``create_all`` +
stamp-head rather than this chain (CLAUDE.md pitfall #26).
"""

import sqlalchemy as sa
from alembic import op

revision = "c3d0e5f7a924"
down_revision = "b2c9d4e6f813"
branch_labels = None
depends_on = None

_TABLE = "item_issuances"
_COLUMN = "lot_allocations"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    if not _has_table(table):
        return False
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    if _has_table(_TABLE) and not _has_column(_TABLE, _COLUMN):
        op.add_column(_TABLE, sa.Column(_COLUMN, sa.JSON(), nullable=True))


def downgrade() -> None:
    if _has_column(_TABLE, _COLUMN):
        op.drop_column(_TABLE, _COLUMN)

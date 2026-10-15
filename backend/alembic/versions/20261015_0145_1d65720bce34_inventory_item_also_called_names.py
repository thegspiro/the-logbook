"""inventory item also called names

Adds ``inventory_items.also_called``: other names an item goes by ("BVM" for
"Bag Valve Mask"), which the checklist matcher looks through when it proposes a
catalog item for a hand-typed position.

Purely additive — a nullable JSON column no existing row has a value for, so
nothing is backfilled and nothing is read until an officer fills one in. The
canonical stored shape is ``NULL`` or a list of distinct strings, settled on
every write by ``app.utils.item_aliases.normalize_aliases``.

Idempotent in both directions. ``scripts/repair_schema.py`` adds model-declared
columns on startup, so an installation can have this column before Alembic
reaches the revision (CLAUDE.md pitfall #26); each step checks first.

Downgrade drops the column and with it every alias entered since; nothing else
reads it, and the names themselves are untouched.

Revision ID: 1d65720bce34
Revises: f2c5e55e7dda
Create Date: 2026-10-15 01:45:30.520308

"""

import sqlalchemy as sa
from alembic import op

revision = "1d65720bce34"
down_revision = "f2c5e55e7dda"
branch_labels = None
depends_on = None

TABLE = "inventory_items"
COLUMN = "also_called"


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in _inspector().get_columns(table)}


def upgrade() -> None:
    if not _has_table(TABLE) or _has_column(TABLE, COLUMN):
        return
    op.add_column(TABLE, sa.Column(COLUMN, sa.JSON(), nullable=True))


def downgrade() -> None:
    if _has_table(TABLE) and _has_column(TABLE, COLUMN):
        op.drop_column(TABLE, COLUMN)

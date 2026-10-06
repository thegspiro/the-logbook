"""clamp negative inventory item values to zero

W43-1: the CSV import wrote negative quantities and purchase prices before it
learned to refuse them, and every item list whose page held such a row then
failed response validation with a 500. The response schema bounds eight
numeric columns at ``>= 0``; any of them stored negative breaks the list the
same way, so all eight are settled here, not only the two the import wrote.

Owner decision: clamp to 0 and log the affected ids, so a quartermaster can
look at each item and enter the right figure.

Irreversible by design: the negative values were invalid and are not kept,
so the downgrade does nothing. Idempotent: a second run finds nothing below
zero.

Revision ID: 7d2e4f6a8b13
Revises: 5c1e7a9d2b40
Create Date: 2026-10-05 02:00:00

"""

import logging
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7d2e4f6a8b13"
down_revision: Union[str, None] = "5c1e7a9d2b40"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("alembic.runtime.migration")

_TABLE = "inventory_items"

# The columns InventoryItemBase bounds at ge=0. Frozen here rather than read
# from the schema, so this migration keeps doing what it did the day it ran.
_BOUNDED_COLUMNS = (
    "quantity",
    "purchase_price",
    "current_value",
    "replacement_cost",
    "weight",
    "expected_lifetime_years",
    "reorder_point",
    "inspection_interval_days",
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if _TABLE not in inspector.get_table_names():
        return
    present = {c["name"] for c in inspector.get_columns(_TABLE)}
    items = sa.table(_TABLE, sa.column("id"), *(sa.column(c) for c in present))

    for name in _BOUNDED_COLUMNS:
        if name not in present:
            continue
        column = items.c[name]
        ids = [row[0] for row in bind.execute(sa.select(items.c.id).where(column < 0))]
        if not ids:
            continue
        logger.warning(
            "W43-1: clamped negative %s to 0 on %d inventory item(s): %s",
            name,
            len(ids),
            ", ".join(str(i) for i in ids),
        )
        bind.execute(sa.update(items).where(column < 0).values({name: 0}))


def downgrade() -> None:
    # The negative values were invalid and were not kept; see the docstring.
    pass

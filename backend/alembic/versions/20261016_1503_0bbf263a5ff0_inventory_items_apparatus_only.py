"""Mark a supply as kept on the apparatus only.

Revision ID: 0bbf263a5ff0
Revises: f236c56b1b49
Create Date: 2026-10-16 15:03:00.000000

Some medical equipment has no stock room at all: a LUCAS device or a cardiac
monitor lives on the ambulance and is checked there, and nothing waits on a
shelf to replace it. Read through the stock-room lens such a supply shows
"0 on hand", an offer to add stock lots and a delivery picker entry, none of
which applies. ``inventory_items.apparatus_only`` records that the supply is
carried on the apparatus only, so the Medical Supplies page can show it by
where it is carried instead.

The department chose a per-supply setting over inferring it from an empty
shelf: an empty shelf and a stock room that has run out look the same in the
data, and inferring would hide exactly the shortage the shelf count exists
to show.

Every existing row gets ``0`` (not apparatus-only), which is today's
behaviour, so nothing changes until someone ticks the box.

**Why the step is guarded.** The column is added only when the table exists
and the column does not, so a database built by ``create_all`` (which
already declares it) or a re-run changes nothing.

**Downgrade** drops the column; which supplies were marked is lost.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0bbf263a5ff0"
down_revision: Union[str, None] = "f236c56b1b49"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "inventory_items"
_COLUMN = "apparatus_only"


def _has_column() -> bool:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        return False
    return _COLUMN in {c["name"] for c in inspector.get_columns(_TABLE)}


def _has_table() -> bool:
    return _TABLE in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table() and not _has_column():
        op.add_column(
            _TABLE,
            sa.Column(
                _COLUMN,
                sa.Boolean(),
                nullable=False,
                server_default="0",
            ),
        )


def downgrade() -> None:
    if _has_column():
        op.drop_column(_TABLE, _COLUMN)

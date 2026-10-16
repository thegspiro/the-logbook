"""Add a count unit to checklist count positions, and snapshot par on results.

Revision ID: 12e20092c1a8
Revises: 0bbf263a5ff0
Create Date: 2026-10-16 19:53:46.912292

A count position held a single number with no unit, so "8 / 10" did not say
whether a crew was counting boxes or the gauze inside them, and a half box
could not be recorded at all. ``check_template_items.count_unit`` names what
is counted ("each", "rolls", "boxes", ...), so a department that needs a
partial pack counts in the smaller unit and every quantity stays whole.

Pass/fail and restock are now separate questions: Min to Pass (or Critical
Min) decides the verdict, par decides the shortfall. A filed result already
snapshots the pass floor in ``required_quantity``; it now also snapshots par
(``expected_quantity``) and the unit (``count_unit``) so a past check keeps
saying "short 2 boxes" after the template is edited.

Every column is nullable and no row is rewritten. A result filed before this
revision has no par snapshot, and readers fall back to its
``required_quantity``, which is exactly the single target it was judged by.

**Why each step is guarded.** A column is added only when its table exists and
the column does not, so a database built by ``create_all`` (which already
declares them) or a re-run changes nothing.

**Downgrade** drops the three columns; recorded units and par snapshots are
lost.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "12e20092c1a8"
down_revision: Union[str, None] = "0bbf263a5ff0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = (
    ("check_template_items", "count_unit", sa.String(50)),
    ("shift_equipment_check_items", "expected_quantity", sa.Integer()),
    ("shift_equipment_check_items", "count_unit", sa.String(50)),
)


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return False
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    for table, column, column_type in _COLUMNS:
        if _has_table(table) and not _has_column(table, column):
            op.add_column(table, sa.Column(column, column_type, nullable=True))


def downgrade() -> None:
    for table, column, _column_type in reversed(_COLUMNS):
        if _has_column(table, column):
            op.drop_column(table, column)

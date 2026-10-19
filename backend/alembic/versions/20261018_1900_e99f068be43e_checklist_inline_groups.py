"""Let checklist items sit directly on a checklist, outside any location.

Revision ID: e99f068be43e
Revises: 89723c04ae94
Create Date: 2026-10-18 19:00:00.000000

Every checklist item lived inside a named location ("Cab", "Driver side
compartment 2"), so a line that belongs to the truck as a whole — "Walk-around
done", "Fuel card aboard" — had to be filed under a location invented to hold
it. ``check_template_compartments.is_inline`` marks a headingless group: its
items render directly on the checklist, in place among the locations, with no
heading of their own.

The items still hang off a compartment row rather than off the template,
because every department-isolation query reaches an item through its
compartment. One flag keeps that single path intact; a second parent column
would have to be scoped separately in each of those queries.

Additive only. The column defaults to false, so every existing compartment
stays an ordinary named location and no row is rewritten. The same release adds
a ``presence`` answer type, which needs no schema change (``check_type`` is a
free-text column validated at the request boundary) and converts no existing
line: an admin switches a line to it in the builder.

**Why the step is guarded.** The column is added only when the table exists
and the column does not, so a database built by ``create_all`` (which already
declares it) or a re-run changes nothing.

**Downgrade** drops the column. Inline groups then read as ordinary unnamed
locations, which the builder flags for a name before the next publish; their
items are kept.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e99f068be43e"
down_revision: Union[str, None] = "89723c04ae94"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "check_template_compartments"
_COLUMN = "is_inline"


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return False
    return column in {c["name"] for c in inspector.get_columns(table)}


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table(_TABLE) and not _has_column(_TABLE, _COLUMN):
        op.add_column(
            _TABLE,
            sa.Column(_COLUMN, sa.Boolean(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    if _has_column(_TABLE, _COLUMN):
        op.drop_column(_TABLE, _COLUMN)

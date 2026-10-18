"""Let checklist items sit directly on the checklist, between locations.

Revision ID: d80493f28236
Revises: 89723c04ae94
Create Date: 2026-10-18 19:19:00.000000

Every checklist item had to live inside a named location ("Officer Door
Entry", "Trauma Bag"), so a department wanting a few items checked on the
truck as a whole — a map book, the radios — had to invent a location for
them. ``check_template_compartments.is_inline`` marks a headingless group: its
items render directly on the checklist, wherever the group is placed among the
locations.

Why a flag on a location rather than items pointing at the checklist itself:
an item reaches its checklist, and so its department, through its location,
and every department-isolation query relies on that chain. A flagged group
keeps the chain intact, so no isolation query changes.

Every existing row gets ``0`` (an ordinary location), which is today's
behaviour, so nothing changes until someone places an item on the checklist.

**Why the step is guarded.** The column is added only when the table exists
and the column does not, so a database built by ``create_all`` (which already
declares it) or a re-run changes nothing.

**Downgrade** drops the column. Inline groups survive as unnamed locations,
which the builder then asks to be named before publishing.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d80493f28236"
down_revision: Union[str, None] = "89723c04ae94"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "check_template_compartments"
_COLUMN = "is_inline"


def _has_table() -> bool:
    return _TABLE in sa.inspect(op.get_bind()).get_table_names()


def _has_column() -> bool:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        return False
    return _COLUMN in {c["name"] for c in inspector.get_columns(_TABLE)}


def upgrade() -> None:
    if _has_table() and not _has_column():
        op.add_column(
            _TABLE,
            sa.Column(_COLUMN, sa.Boolean(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    if _has_column():
        op.drop_column(_TABLE, _COLUMN)

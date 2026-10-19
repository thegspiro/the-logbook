"""Let checklist items sit directly on the checklist, between locations.

Revision ID: d80493f28236
Revises: 2315d544d60a
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

**Re-pointed, and now a no-op in practice.** This revision was written in
parallel with ``e99f068be43e``, which adds the identical column and reached
main first. Both originally revised ``89723c04ae94``; this one was moved to
revise the merge head ``2315d544d60a`` so the history keeps a single head. By
the time it runs ``e99f068be43e`` has already added the column, so the guard
below makes it change nothing. It is kept rather than deleted only so a
development database already stamped at this revision still resolves.

**Why the step is guarded.** The column is added only when the table exists
and the column does not, so a database built by ``create_all`` (which already
declares it) or a re-run changes nothing.

**Downgrade** does nothing. The column belongs to ``e99f068be43e``, which
sits below this revision; dropping it here would leave ``2315d544d60a``
without a column its models declare. Downgrading past ``e99f068be43e`` drops
it.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d80493f28236"
down_revision: Union[str, None] = "2315d544d60a"
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
    # e99f068be43e owns the column; see the module docstring.
    pass

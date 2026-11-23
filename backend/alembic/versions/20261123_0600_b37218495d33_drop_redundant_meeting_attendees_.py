"""Drop the redundant idx_meeting_attendees_meeting index

``uq_meeting_attendees_meeting_user`` (``meeting_id``, ``user_id``, added by
``7b6db9dd8e4f``) leads on ``meeting_id``, so it serves every lookup by
meeting that the single-column ``idx_meeting_attendees_meeting`` did, and the
foreign key on ``meeting_id`` with it. The single-column index only added
write cost on every attendance insert, update and delete.

The drop is guarded, and degrades to a no-op rather than failing:

* on a database where ``meeting_attendees`` does not exist yet (CLAUDE.md
  pitfall #26); ``create_all`` builds it later from the model, which no
  longer declares the index;
* when the index is already gone;
* when no other index leads on ``meeting_id``. MySQL refuses to drop the last
  index backing a foreign key (error 1553), so a database missing the unique
  index keeps this one.

Downgrade puts the index back when the table exists and the index does not.
No rows change either way.

Revision ID: b37218495d33
Revises: b6e3d1f47a29
Create Date: 2026-11-23 06:00:48.876171

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b37218495d33"
down_revision: Union[str, None] = "b6e3d1f47a29"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Named so the migration's test can point it at a scratch copy.
TABLE = "meeting_attendees"
INDEX = "idx_meeting_attendees_meeting"
COLUMN = "meeting_id"


def _indexes() -> list[dict] | None:
    """The table's indexes, or None when the table does not exist."""
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return None
    return [dict(ix) for ix in inspector.get_indexes(TABLE)]


def upgrade() -> None:
    indexes = _indexes()
    if indexes is None:
        return
    if INDEX not in {ix["name"] for ix in indexes}:
        return
    covered = any(
        ix["name"] != INDEX and (ix.get("column_names") or [None])[0] == COLUMN
        for ix in indexes
    )
    if not covered:
        return
    op.drop_index(INDEX, table_name=TABLE)


def downgrade() -> None:
    indexes = _indexes()
    if indexes is None or INDEX in {ix["name"] for ix in indexes}:
        return
    op.create_index(INDEX, TABLE, [COLUMN])

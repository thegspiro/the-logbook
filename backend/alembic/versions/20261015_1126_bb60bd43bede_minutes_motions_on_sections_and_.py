"""Minutes: motions on sections, and who moved the adoption

Adds three nullable columns:

* ``meeting_motions.section_key`` — the outline section a motion was made from
  ("Approval of Previous Minutes", "Adjournment"). Not a foreign key: a section
  is an entry in the minutes' JSON, not a row.
* ``meeting_minutes.adoption_moved_by`` / ``adoption_seconded_by`` — who moved
  and seconded the adoption of the minutes, as names so a guest can be recorded.

Nothing is backfilled: every motion and every set of adopted minutes that
exists keeps NULL, which reads as "not recorded". The flags and wording on
outline sections live inside the sections' JSON and need no column.

Either table may be absent on a fresh database where ``create_all`` builds it
from the models (which already declare these columns), so each step is skipped
when its table is missing.

The downgrade drops the three columns; the movers recorded in them are lost.

Revision ID: bb60bd43bede
Revises: 48f403b2631f
Create Date: 2026-10-15 11:26:04.708872

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "bb60bd43bede"
down_revision: Union[str, None] = "48f403b2631f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLUMNS = (
    ("meeting_motions", "section_key", 100),
    ("meeting_minutes", "adoption_moved_by", 200),
    ("meeting_minutes", "adoption_seconded_by", 200),
)


def _existing(table: str) -> set[str] | None:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return None
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    for table, name, length in COLUMNS:
        existing = _existing(table)
        if existing is not None and name not in existing:
            op.add_column(table, sa.Column(name, sa.String(length), nullable=True))


def downgrade() -> None:
    for table, name, _ in reversed(COLUMNS):
        existing = _existing(table)
        if existing is not None and name in existing:
            op.drop_column(table, name)

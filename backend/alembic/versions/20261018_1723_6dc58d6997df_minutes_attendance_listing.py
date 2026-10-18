"""Minutes attendance listing

Adds ``meeting_minutes.attendance_listing``: a set of minutes' own choice of
which attendance statuses it names (``all``, ``present_excused`` or
``present``). NULL follows the department's default, which itself reads as
``all`` until set, so nothing changes for any existing minutes and nothing is
backfilled. The roll stays recorded in full either way.

Skipped when ``meeting_minutes`` is not there yet (``create_all`` builds it
from the model, which already declares the column) or the column exists. The
downgrade drops it; the choices are lost and the minutes are untouched.

Revision ID: 6dc58d6997df
Revises: 89723c04ae94
Create Date: 2026-10-18 17:23:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "6dc58d6997df"
down_revision: Union[str, None] = "89723c04ae94"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "meeting_minutes"
COLUMN = "attendance_listing"


def _columns() -> set:
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(TABLE)}


def upgrade() -> None:
    have = _columns()
    if have and COLUMN not in have:
        op.add_column(TABLE, sa.Column(COLUMN, sa.String(20), nullable=True))


def downgrade() -> None:
    if COLUMN in _columns():
        op.drop_column(TABLE, COLUMN)

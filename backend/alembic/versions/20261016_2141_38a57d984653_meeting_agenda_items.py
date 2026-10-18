"""Meeting agenda items

Adds ``meetings.agenda_items``: the agenda as structured items (title,
presenter, prepared motion, linked documents) that become the sections of the
minutes drafted from the meeting.

The column is nullable and nothing is backfilled. A meeting without items keeps
the free-text ``agenda`` it has, and minutes drafted from it get the outline
they always did. The step is skipped when ``meetings`` does not exist yet
(``create_all`` builds it from the models, which already declare the column) or
the column is already there.

The downgrade drops the column; agenda items entered since are lost with it.
The free-text agenda and every set of minutes are untouched, and sections
already drafted from agenda items stay as ordinary sections.

Revision ID: 38a57d984653
Revises: 244b0fd07205, d3bb8f81ed07
Create Date: 2026-10-16 21:41:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "38a57d984653"
down_revision: Union[str, Sequence[str], None] = ("244b0fd07205", "d3bb8f81ed07")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "meetings"
COLUMN = "agenda_items"


def _has_column() -> bool:
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return False
    return COLUMN in {c["name"] for c in inspector.get_columns(TABLE)}


def _has_table() -> bool:
    return TABLE in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _has_table() or _has_column():
        return
    op.add_column(TABLE, sa.Column(COLUMN, sa.JSON(), nullable=True))


def downgrade() -> None:
    if _has_table() and _has_column():
        op.drop_column(TABLE, COLUMN)

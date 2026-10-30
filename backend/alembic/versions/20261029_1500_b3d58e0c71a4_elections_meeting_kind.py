"""Whether an election is held at a regular business meeting or the annual meeting

``elections.meeting_kind`` is ``regular`` or ``annual``. A department can set
different voter-eligibility defaults for its annual meeting (stored at
``organizations.settings["election_eligibility_annual"]``), and the kind decides
which set an election copies when it is created.

The column is NOT NULL with a server default of ``regular``, so every existing
row reads as a regular-meeting election — the only kind there was — the moment
the column exists, with no separate backfill. Nothing about who may vote in an
existing election changes: its rules were copied when it was created and stay
as they are. The downgrade drops the column; elections lose the label, and their
copied rules are untouched.

Revision ID: b3d58e0c71a4
Revises: e1a7c4b2d9f3
Create Date: 2026-10-29 15:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b3d58e0c71a4"
down_revision: Union[str, None] = "e1a7c4b2d9f3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "elections"
_COLUMN = "meeting_kind"


def _columns() -> set:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(_TABLE)}


def upgrade() -> None:
    columns = _columns()
    # No table: create_all builds it later from the model, column included.
    if not columns or _COLUMN in columns:
        return
    op.add_column(
        _TABLE,
        sa.Column(_COLUMN, sa.String(20), nullable=False, server_default="regular"),
    )


def downgrade() -> None:
    if _COLUMN in _columns():
        op.drop_column(_TABLE, _COLUMN)

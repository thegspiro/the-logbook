"""Election-wide voter eligibility rules

``elections.eligibility_rules`` holds the rules every voter in one election
must meet, whatever the ballot item: a meeting-attendance requirement ("6 of
the last 12 meetings", or "50% over 12 months") and a minimum membership
tenure. A new election copies the department's defaults from
``organizations.settings["election_eligibility"]`` when it is created.

Additive and nullable. Existing rows are left NULL, which means "no
election-wide rules" — exactly what every election enforced before this
column existed — so nothing is backfilled and no existing election changes
who may vote. The downgrade drops the column; any election that carried rules
loses them and reverts to the per-item and membership-tier rules alone.

Revision ID: e1a7c4b2d9f3
Revises: f34e25e2c820
Create Date: 2026-10-29 12:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e1a7c4b2d9f3"
down_revision: Union[str, None] = "f34e25e2c820"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "elections"
_COLUMN = "eligibility_rules"


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
    op.add_column(_TABLE, sa.Column(_COLUMN, sa.JSON(), nullable=True))


def downgrade() -> None:
    if _COLUMN in _columns():
        op.drop_column(_TABLE, _COLUMN)

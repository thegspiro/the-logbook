"""Why an election's voter rules differ from the department's defaults

``elections.eligibility_override_reason`` holds the secretary's reason when
an election's voter rules were changed from the defaults its meeting kind
copies from Election Settings. The API requires it whenever the rules differ,
records it in the audit log, shows it on the election and carries it into the
minutes with the result.

Additive and nullable. Existing rows are left NULL, which reads as "no reason
given" -- true of every election before this column existed -- so nothing is
backfilled and no election's electorate changes. The downgrade drops the
column; the reasons it held are lost, and the audit log keeps the copy written
when each one was given.

Revision ID: e6f00308856d
Revises: 9e79851e9a62
Create Date: 2026-11-13 15:25:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e6f00308856d"
down_revision: Union[str, None] = "9e79851e9a62"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "elections"
_COLUMN = "eligibility_override_reason"


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
    op.add_column(_TABLE, sa.Column(_COLUMN, sa.Text(), nullable=True))


def downgrade() -> None:
    if _COLUMN in _columns():
        op.drop_column(_TABLE, _COLUMN)

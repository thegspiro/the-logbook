"""training requirement shift credited flag

W37-2: the scheduling Shift Compliance report graded every HOURS requirement
from shift attendance, so a training-hours requirement read compliant on
ordinary duty shifts while the training screens graded it from training
records. ``training_requirements.shift_credited`` names the requirements shift
attendance may satisfy; the report now grades only those.

Backfill: a SHIFTS requirement counts shifts by definition and stays on the
report, so existing SHIFTS rows are marked. HOURS rows are left off — that is
the change: a department that wants one graded from shifts marks it. The
downgrade drops the column; the report's previous behaviour did not read it.

Revision ID: f16b004db34e
Revises: d4d0a483cdd5
Create Date: 2026-10-05 17:31:05.781604

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f16b004db34e"
down_revision: Union[str, None] = "d4d0a483cdd5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "training_requirements"
_COLUMN = "shift_credited"


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
        sa.Column(
            _COLUMN,
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.execute(
        sa.text(f"UPDATE {_TABLE} SET {_COLUMN} = 1 WHERE requirement_type = 'shifts'")
    )


def downgrade() -> None:
    if _COLUMN in _columns():
        op.drop_column(_TABLE, _COLUMN)

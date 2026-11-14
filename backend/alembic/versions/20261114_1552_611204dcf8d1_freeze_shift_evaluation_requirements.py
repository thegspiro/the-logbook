"""Store a department shift's evaluation requirements when it ends

Revision ID: 611204dcf8d1
Revises: 7a3c9e1d5b42
Create Date: 2026-11-14 15:52:46.021357

Owner decision, 2026-11-14: the evaluations a department shift calls for are
fixed when the shift ends, so a setting changed or a program joined afterwards
no longer orphans evaluations already submitted or re-blocks close-out.
``ShiftEvaluationService`` stores each crew member's requirements in
``shifts.evaluation_requirements`` on the first read after the shift's end.

Existing rows: the column is nullable and every existing shift reads NULL,
meaning "not stored yet". Nothing is backfilled: a shift already over is
stored on its next read, from the settings in force then, which is the answer
it gives today, so upgrading changes nothing anybody can see.

Safe to run twice, and skipped when ``shifts`` does not exist (Pitfall #26).
Downgrade drops the column and the stored requirements with it; shifts then
go back to following the current settings on every read.
"""

from typing import Optional, Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "611204dcf8d1"
down_revision: Union[str, None] = "7a3c9e1d5b42"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "shifts"
COLUMN = "evaluation_requirements"


def _columns() -> Optional[set[str]]:
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return None
    return {c["name"] for c in inspector.get_columns(TABLE)}


def upgrade() -> None:
    columns = _columns()
    if columns is None or COLUMN in columns:
        return
    op.add_column(TABLE, sa.Column(COLUMN, sa.JSON(), nullable=True))


def downgrade() -> None:
    columns = _columns()
    if columns is None or COLUMN not in columns:
        return
    op.drop_column(TABLE, COLUMN)

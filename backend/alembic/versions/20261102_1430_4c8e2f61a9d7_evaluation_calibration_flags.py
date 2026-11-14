"""Calibration flags on an evaluation's calibration step

Revision ID: 4c8e2f61a9d7
Revises: 9d3a71c5e2b8
Create Date: 2026-11-02 14:30:00.000000

``evaluation_steps`` gains ``flagged_items`` (JSON, nullable): on a
calibration step, the keys of the evaluator's items the calibrator ticked for
the evaluator to revisit (owner decision 2026-11-02: ticks only, no notes,
shown to the member once the evaluation is released).

Existing rows are left NULL, which reads as "nothing flagged": no calibration
recorded before this revision flagged anything, because there was no way to
(CLAUDE.md pitfall #35). Safe to run twice, and skipped when ``create_all``
has not built the table yet. The downgrade drops the column and the flags in
it.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "4c8e2f61a9d7"
down_revision: Union[str, None] = "9d3a71c5e2b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "evaluation_steps"
COLUMN = "flagged_items"


def _inspector():
    return sa.inspect(op.get_bind())


def _has_column() -> bool:
    inspector = _inspector()
    if TABLE not in inspector.get_table_names():
        return True  # nothing to do either way; create_all builds it whole
    return any(c["name"] == COLUMN for c in inspector.get_columns(TABLE))


def upgrade() -> None:
    if not _has_column():
        op.add_column(TABLE, sa.Column(COLUMN, sa.JSON(), nullable=True))


def downgrade() -> None:
    inspector = _inspector()
    if TABLE in inspector.get_table_names() and any(
        c["name"] == COLUMN for c in inspector.get_columns(TABLE)
    ):
        op.drop_column(TABLE, COLUMN)

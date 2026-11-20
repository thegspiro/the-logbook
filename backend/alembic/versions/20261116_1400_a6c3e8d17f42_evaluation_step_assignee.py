"""A named assignee on an evaluation's approval or calibration step

Revision ID: a6c3e8d17f42
Revises: a541e82fef9f
Create Date: 2026-11-16 14:00:00.000000

``evaluation_steps`` gains ``assignee_id`` (``String(36)``, nullable, foreign
key to ``users.id`` with ``ON DELETE SET NULL``). On an approval or
calibration step it names the one person a manager chose to act on that
step, in place of the step's position holders (or the ``evaluations.view_all``
holders, for calibration). Owner decision 2026-11-16 (ADV2-4): the evaluator
may no longer approve or calibrate their own evaluation, so a department
whose only holder of the approval position wrote it needs a way to name
someone else.

Existing rows are left NULL, which reads as "the workflow's actor decides",
exactly how every step was resolved before this revision (CLAUDE.md pitfall
#35). The index comes before the foreign key so MySQL does not build one of
its own for it. Safe to run twice, and skipped when ``create_all`` has not
built the table yet. The downgrade drops the foreign key, the index and the
column, and with them every assignment; each such step falls back to its
position holders.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a6c3e8d17f42"
down_revision: Union[str, None] = "a541e82fef9f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "evaluation_steps"
COLUMN = "assignee_id"
INDEX = "ix_evaluation_steps_assignee_id"
FOREIGN_KEY = "fk_evaluation_steps_assignee_id_users"


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table() -> bool:
    return TABLE in _inspector().get_table_names()


def _has_column() -> bool:
    return any(c["name"] == COLUMN for c in _inspector().get_columns(TABLE))


def upgrade() -> None:
    if not _has_table() or _has_column():
        return
    op.add_column(TABLE, sa.Column(COLUMN, sa.String(36), nullable=True))
    op.create_index(INDEX, TABLE, [COLUMN])
    op.create_foreign_key(
        FOREIGN_KEY, TABLE, "users", [COLUMN], ["id"], ondelete="SET NULL"
    )


def downgrade() -> None:
    if not _has_table() or not _has_column():
        return
    inspector = _inspector()
    for fk in inspector.get_foreign_keys(TABLE):
        if fk.get("constrained_columns") == [COLUMN] and fk.get("name"):
            op.drop_constraint(fk["name"], TABLE, type_="foreignkey")
    if INDEX in {ix["name"] for ix in inspector.get_indexes(TABLE)}:
        op.drop_index(INDEX, TABLE)
    op.drop_column(TABLE, COLUMN)

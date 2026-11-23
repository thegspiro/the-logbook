"""Events: what happened at an outreach event, recorded when it closes

Revision ID: d1dfb6c68e9b
Revises: 9b73e3dcaec7
Create Date: 2026-11-21 03:58:00.000000

Owner decision, 2026-11-20: when an outreach event closes, the department
records how it went, which apparatus attended, what was handed out and whether
photos were taken with the host's consent. Four nullable columns on ``events``:

* ``outreach_outcome_note`` — free text: how it went, follow-ups;
* ``outreach_apparatus_ids`` — JSON list of apparatus ids (either apparatus
  table, checked in-org when saved);
* ``outreach_materials`` — JSON ``[{"item": str, "quantity": int}]``, one entry
  per item, settled on save (pitfall #20);
* ``outreach_photos`` — ``none`` (no photos), ``consented`` or
  ``not_consented``; NULL means not recorded.

Existing rows: all four are added nullable and stay NULL — nothing was
recorded before — so nothing is rewritten and nothing can fail on them. Safe to
run twice: a column already there is left alone. A table only ``create_all``
builds (CLAUDE.md pitfall #26) is skipped; it is built from the model.

The downgrade drops the four columns and with them anything recorded in them;
take the database backup first if that matters (docs/UPGRADING.md).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d1dfb6c68e9b"
down_revision: Union[str, None] = "9b73e3dcaec7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "events"
COLUMNS = (
    ("outreach_outcome_note", sa.Text()),
    ("outreach_apparatus_ids", sa.JSON()),
    ("outreach_materials", sa.JSON()),
    ("outreach_photos", sa.String(20)),
)


def _columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(TABLE)}


def upgrade() -> None:
    columns = _columns()
    if not columns:
        return
    for name, type_ in COLUMNS:
        if name not in columns:
            op.add_column(TABLE, sa.Column(name, type_, nullable=True))


def downgrade() -> None:
    columns = _columns()
    for name, _type in COLUMNS:
        if name in columns:
            op.drop_column(TABLE, name)

"""Events: an outreach event created directly can open a volunteer signup sheet

Revision ID: 9b73e3dcaec7
Revises: e016062a4127
Create Date: 2026-11-21 03:19:00.000000

Owner decision, 2026-11-20: an outreach event an officer creates directly,
without a public request behind it, can open the same role-based signup sheet
a request can. Until now the sheet's link and its roles lived only on
``event_requests``. Two nullable columns on ``events`` carry the same for an
event:

* ``staffing_shift_id`` — the signup sheet (a shift), ``ON DELETE SET NULL``
  so deleting the shift leaves the event standing without a sheet;
* ``staffing_roles`` — what the event needs, by role, in the canonical
  ``[{"role": str, "count": int}]`` shape (``app/utils/outreach_roles``).

Existing rows: both columns are added nullable and stay NULL — no event has a
sheet yet — so nothing is rewritten and no constraint can fail on them. Safe to
run twice: a column already there is left alone. A table only ``create_all``
builds (CLAUDE.md pitfall #26) is skipped; it is built from the model.

The downgrade drops both columns, and with them the link from any event that
had opened a sheet. The sheets themselves (shifts) and their signups remain on
the schedule; only the event no longer knows they belong to it.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9b73e3dcaec7"
down_revision: Union[str, None] = "e016062a4127"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "events"
FK_NAME = "fk_events_staffing_shift_id_shifts"


def _columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(TABLE)}


def _shifts_exists() -> bool:
    return "shifts" in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    columns = _columns()
    if not columns:
        return
    if "staffing_shift_id" not in columns:
        op.add_column(
            TABLE, sa.Column("staffing_shift_id", sa.String(36), nullable=True)
        )
        if _shifts_exists():
            op.create_foreign_key(
                FK_NAME,
                TABLE,
                "shifts",
                ["staffing_shift_id"],
                ["id"],
                ondelete="SET NULL",
            )
    if "staffing_roles" not in columns:
        op.add_column(TABLE, sa.Column("staffing_roles", sa.JSON(), nullable=True))


def downgrade() -> None:
    columns = _columns()
    if "staffing_shift_id" in columns:
        inspector = sa.inspect(op.get_bind())
        names = {fk.get("name") for fk in inspector.get_foreign_keys(TABLE)}
        if FK_NAME in names:
            op.drop_constraint(FK_NAME, TABLE, type_="foreignkey")
        op.drop_column(TABLE, "staffing_shift_id")
    if "staffing_roles" in columns:
        op.drop_column(TABLE, "staffing_roles")

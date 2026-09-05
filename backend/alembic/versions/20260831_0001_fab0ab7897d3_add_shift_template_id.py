"""Add shifts.template_id

A shift template names the equipment checklists its shifts carry (see
``shift_template_equipment_checks``). Resolving those at check time means
knowing which template a shift came from — and until now nothing recorded it:
a shift *copies* the template's colour, positions, min_staffing and apparatus
and keeps no reference back.

**No backfill is possible.** There is no column on an existing shift that could
identify its originating template; the copied fields are not unique to one.
Existing shifts therefore carry NULL and fall back to apparatus-based checklist
resolution, which is exactly the behaviour they have today, so nothing changes
for them.

Guarded on the table existing, defensively rather than out of necessity:
``shifts`` IS created by the migration chain — 20260122_0015 creates it
outright, which makes that a required ancestor of this revision, so the table
is present by the time this runs. An earlier version of this paragraph claimed
the opposite, which is the false positive CLAUDE.md pitfall #26 records being
reverted after an empirical ``alembic upgrade head`` against an empty database.
The guard is kept because it costs one reflection and cannot be wrong, but it
is not load-bearing, and it is not the pattern to copy for a genuinely
create_all-only table.

Revision ID: 20260831_0001
Revises: 20260830_0002
Create Date: 2026-08-31 00:01:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "fab0ab7897d3"
down_revision = "7e2f11397849"
branch_labels = None
depends_on = None

_TABLE = "shifts"
_COLUMN = "template_id"
_FK = "fk_shifts_template_id_shift_templates"


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in _inspector().get_columns(table)}


def upgrade() -> None:
    if not _has_table(_TABLE) or _has_column(_TABLE, _COLUMN):
        return
    op.add_column(_TABLE, sa.Column(_COLUMN, sa.String(36), nullable=True))
    op.create_index("idx_shift_template_id", _TABLE, [_COLUMN])
    # The FK only makes sense once shift_templates exists. It is created by
    # 20260214_2200, so on any database that has run migrations it does — but
    # guard anyway rather than assume an ordering a future merge could change.
    if _has_table("shift_templates"):
        op.create_foreign_key(
            _FK, _TABLE, "shift_templates", [_COLUMN], ["id"], ondelete="SET NULL"
        )


def downgrade() -> None:
    if not _has_table(_TABLE) or not _has_column(_TABLE, _COLUMN):
        return
    fks = {fk["name"] for fk in _inspector().get_foreign_keys(_TABLE)}
    if _FK in fks:
        op.drop_constraint(_FK, _TABLE, type_="foreignkey")
    indexes = {ix["name"] for ix in _inspector().get_indexes(_TABLE)}
    if "idx_shift_template_id" in indexes:
        op.drop_index("idx_shift_template_id", table_name=_TABLE)
    op.drop_column(_TABLE, _COLUMN)

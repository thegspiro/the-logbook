"""Drop the foreign key on shift_equipment_checks.apparatus_id

Submitting an equipment check for a shift always failed with a 500 when that
shift had an apparatus assigned:

    (1452, 'Cannot add or update a child row: a foreign key constraint fails
     (`shift_equipment_checks`, CONSTRAINT
     `fk_shift_equipment_checks_apparatus_id_apparatus`
     FOREIGN KEY (`apparatus_id`) REFERENCES `apparatus` (`id`)))

There are two apparatus tables. ``Shift.apparatus_id`` is a bare ``String(36)``
with no foreign key — commented "Link to apparatus (future)" — and in practice
holds a scheduling ``BasicApparatus`` id, which is what ``create_shift`` checks
it against. ``ShiftEquipmentCheck.apparatus_id`` was declared with a real
foreign key to ``apparatus.id``, and ``create_shift_check`` copies one straight
into the other, so the id never resolved.

The reference is now untyped on both sides, matching how the value is actually
produced. This does not reconcile the two apparatus tables — that remains open —
it stops the mismatch from breaking the daily equipment check, which is a core
workflow in the shift guides.

Revision ID: 20260808_0001
Revises: 20260807_0009
Create Date: 2026-08-08 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260808_0001"
down_revision = "20260807_0009"
branch_labels = None
depends_on = None

TABLE = "shift_equipment_checks"
COLUMN = "apparatus_id"


def _apparatus_fk_name(inspector) -> str | None:
    """Find the constraint by the column it covers, not by its name.

    Fresh installs get the name SQLAlchemy's naming convention produces;
    databases built before that convention landed may carry a different one.
    """
    for fk in inspector.get_foreign_keys(TABLE):
        if (
            fk.get("constrained_columns") == [COLUMN]
            and fk.get("referred_table") == "apparatus"
        ):
            return fk.get("name")
    return None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(TABLE):
        return
    name = _apparatus_fk_name(inspector)
    if name:
        op.drop_constraint(name, TABLE, type_="foreignkey")


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(TABLE):
        return
    if _apparatus_fk_name(inspector):
        return
    op.create_foreign_key(
        "fk_shift_equipment_checks_apparatus_id_apparatus",
        TABLE,
        "apparatus",
        [COLUMN],
        ["id"],
        ondelete="SET NULL",
    )

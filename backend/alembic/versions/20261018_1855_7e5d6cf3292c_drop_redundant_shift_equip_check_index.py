"""Drop the redundant (shift_id, template_id) index on shift_equipment_checks.

Revision ID: 7e5d6cf3292c
Revises: 89723c04ae94
Create Date: 2026-10-18 18:55:23.008355

``idx_shift_equip_check_shift_tmpl`` (20260404_0400) became a duplicate when
a17c4e9d2b61 added ``uq_shift_equipment_check_shift_template`` on the same
columns in the same order: the unique constraint is backed by its own index,
so the plain one serves no read and costs a write on every submission.

The ``shift_id`` foreign key still has a leading-column index after the drop
(the unique constraint, and ``idx_shift_equip_check_shift_timing``), so MySQL
does not refuse it with error 1553.

Both directions check for the index first, so a database that never had it, or
already lost it, upgrades and downgrades cleanly.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7e5d6cf3292c"
down_revision: Union[str, None] = "89723c04ae94"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "shift_equipment_checks"
_INDEX = "idx_shift_equip_check_shift_tmpl"


def _has_index(name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(_TABLE):
        return False
    return name in {ix.get("name") for ix in inspector.get_indexes(_TABLE)}


def upgrade() -> None:
    if _has_index(_INDEX):
        op.drop_index(_INDEX, table_name=_TABLE)


def downgrade() -> None:
    if sa.inspect(op.get_bind()).has_table(_TABLE) and not _has_index(_INDEX):
        op.create_index(_INDEX, _TABLE, ["shift_id", "template_id"])

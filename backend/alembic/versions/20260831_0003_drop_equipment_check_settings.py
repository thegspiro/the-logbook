"""Drop scheduling_module_configs.equipment_check_settings

The column held four checklist switches — ``enabled``, ``requireSignature``,
``defaultExpirationWarningDays`` and ``blockShiftStartOnFail`` — that were
stored, echoed back by the API and rendered as live controls in the shift
settings panel, and read by **no code at all**. An officer could switch on
"Block shift start when required items fail", be told it saved, and have
nothing happen. Equipment checklists now belong to the Inventory module, and
the checklist settings that *are* wired live in
``organizations.settings["shift_reports"]["checklist_timing"]``.

Irreversible in the sense that matters: ``downgrade`` restores the column but
not its contents. That loses nothing a department can notice, because no code
path ever consulted the values — but it is worth stating rather than leaving a
reader to assume the downgrade round-trips.

Guarded on the table *and* the column existing. Fresh installs come up through
``create_all`` + stamp-head rather than this chain (CLAUDE.md pitfall #26), and
``scripts/repair_schema.py`` builds from the models, so a database can legitimately
reach this revision having never had the column.
"""

import sqlalchemy as sa
from alembic import op

revision = "20260831_0003"
down_revision = "20260831_0002"
branch_labels = None
depends_on = None

_TABLE = "scheduling_module_configs"
_COLUMN = "equipment_check_settings"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    if not _has_table(table):
        return False
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    if _has_column(_TABLE, _COLUMN):
        op.drop_column(_TABLE, _COLUMN)


def downgrade() -> None:
    # Both halves matter: the table may not exist at all on a database that
    # never ran this chain, and the column may already be back on one that did
    # not get as far as the drop.
    if _has_table(_TABLE) and not _has_column(_TABLE, _COLUMN):
        op.add_column(_TABLE, sa.Column(_COLUMN, sa.JSON(), nullable=True))

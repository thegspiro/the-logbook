"""Add locations.nfc_badge_check_in_enabled.

Whether a room's public kiosk (``/display/{code}``) accepts member ID card
taps. A tap there records attendance with nobody signed in, so the switch
defaults to **off** for every room, existing and new, and a department turns it
on room by room where a reader is mounted. ``server_default`` writes that off
state onto the rows already stored, so no existing kiosk starts accepting
taps on upgrade.

Guarded on the table and on the column, so a re-run, or a database whose
column ``repair_schema`` or ``create_all`` already added from the model, is a
no-op rather than a duplicate-column error. ``locations`` is built by the
migration chain (20260120_0013), so the table guard is defensive only.

Downgrade drops the column, which loses only which rooms had badge taps on.

Revision ID: 040ae44ad286
Revises: 5bed4c485d2f
Create Date: 2026-10-03 01:42:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "040ae44ad286"
down_revision: Union[str, None] = "5bed4c485d2f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "locations"
_COLUMN = "nfc_badge_check_in_enabled"


def _has_column() -> bool:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        return False
    return any(c["name"] == _COLUMN for c in inspector.get_columns(_TABLE))


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names() or _has_column():
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


def downgrade() -> None:
    if _has_column():
        op.drop_column(_TABLE, _COLUMN)

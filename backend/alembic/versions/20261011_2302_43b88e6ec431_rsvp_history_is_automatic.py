"""Add rsvp_history.is_automatic.

Marks an RSVP history row written by the system rather than by a person — today
only an automatic waitlist promotion (W19-3). Without it the row would have to
carry an empty ``changed_by``, which the model defines as "the member changed
it themselves", and the event's RSVP Activity would credit the member with a
move they never made. ``server_default`` writes false onto the rows already
stored, which is accurate: every existing row was a member's or an officer's
change, since the system wrote none.

``rsvp_history`` is created by ``create_all`` and by no migration, so the step
is guarded on the table as well as the column: on a database that has not
started the app yet it is skipped, and the table ``create_all`` builds later
carries the column from the model. A re-run, or a database where
``repair_schema`` already added it, is a no-op.

Downgrade drops the column, which loses only which history rows were automatic;
the rows themselves stay.

Revision ID: 43b88e6ec431
Revises: 3c9c5025a380
Create Date: 2026-10-11 23:02:31.865508
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "43b88e6ec431"
down_revision: Union[str, None] = "3c9c5025a380"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "rsvp_history"
_COLUMN = "is_automatic"


def _has_table() -> bool:
    return _TABLE in sa.inspect(op.get_bind()).get_table_names()


def _has_column() -> bool:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        return False
    return any(c["name"] == _COLUMN for c in inspector.get_columns(_TABLE))


def upgrade() -> None:
    if not _has_table() or _has_column():
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

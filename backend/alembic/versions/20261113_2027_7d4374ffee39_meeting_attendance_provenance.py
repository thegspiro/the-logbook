"""Where a meeting attendance record came from

Adds three nullable columns to ``meeting_attendees`` so the Meeting
Attendance page can show, for each of a member's meetings, when they checked
in, who recorded it and how:

- ``checked_in_at``: the moment of a real check-in (an event's); never a
  secretary's entry, which has no such moment.
- ``recorded_by``: the user who wrote the record (SET NULL when they are
  deleted, so a departed secretary does not take attendance history with
  them).
- ``recorded_via``: manual, event_check_in, event_rsvp, waiver or
  waiver_request.

Additive and nullable. Existing rows are left NULL -- that information was
never recorded, and nothing here can recover it -- so they read as "not
recorded" and no attendance figure or voting decision changes. The downgrade
drops the foreign key and the three columns, losing what was recorded since.

``meeting_attendees`` is built by ``create_all``, not by any migration, so
every step is guarded on the table existing (pitfall #26): a table built
later is built from the model, which already declares the columns.

Revision ID: 7d4374ffee39
Revises: e6f00308856d
Create Date: 2026-11-13 20:27:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7d4374ffee39"
down_revision: Union[str, None] = "e6f00308856d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "meeting_attendees"
_FK = "fk_meeting_attendees_recorded_by_users"


def _columns() -> set:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(_TABLE)}


def _foreign_keys() -> set:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        return set()
    return {fk["name"] for fk in inspector.get_foreign_keys(_TABLE) if fk.get("name")}


def upgrade() -> None:
    columns = _columns()
    # No table: create_all builds it later from the model, columns included.
    if not columns:
        return
    if "checked_in_at" not in columns:
        op.add_column(
            _TABLE,
            sa.Column("checked_in_at", sa.DateTime(timezone=True), nullable=True),
        )
    if "recorded_by" not in columns:
        op.add_column(_TABLE, sa.Column("recorded_by", sa.String(36), nullable=True))
    if "recorded_via" not in columns:
        op.add_column(_TABLE, sa.Column("recorded_via", sa.String(20), nullable=True))
    if _FK not in _foreign_keys():
        op.create_foreign_key(
            _FK, _TABLE, "users", ["recorded_by"], ["id"], ondelete="SET NULL"
        )


def downgrade() -> None:
    if _FK in _foreign_keys():
        op.drop_constraint(_FK, _TABLE, type_="foreignkey")
    columns = _columns()
    for column in ("recorded_via", "recorded_by", "checked_in_at"):
        if column in columns:
            op.drop_column(_TABLE, column)

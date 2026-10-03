"""Add events.organizer_id and events.alternate_organizer_id.

Revision ID: 90070d4a2f6f
Revises: f73b449bdb8b
Create Date: 2026-10-03 01:36:00.000000

Attendance requests went to an event's creator and, when that failed, to every
holder of events.manage. These two columns name who actually runs the event so
the requests — and the series-end reminder — go to them, and so the pair can be
handed over when somebody else takes on a recurring event.

**Backfill.** ``organizer_id`` is set to ``created_by`` on every existing row,
which is exactly who attendance requests reached before this revision, so no
installation changes behaviour until somebody transfers an event. The alternate
starts empty.

Each step is guarded so a database that already carries the columns (one built
by ``create_all()`` from the models) is left as it is; the backfill only fills
rows whose organizer is still empty, so a re-run never overwrites a transfer.

**Downgrade** drops both columns. Any transfer made since is lost; attendance
requests then fall back to the creator, as they did before.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "90070d4a2f6f"
down_revision: Union[str, None] = "f73b449bdb8b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "events"
COLUMNS = (
    ("organizer_id", "fk_events_organizer_id_users", "ix_events_organizer_id"),
    (
        "alternate_organizer_id",
        "fk_events_alternate_organizer_id_users",
        "ix_events_alternate_organizer_id",
    ),
)


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in _inspector().get_columns(table)}


def _has_index(table: str, name: str) -> bool:
    return name in {i["name"] for i in _inspector().get_indexes(table)}


def _foreign_key_names(table: str, column: str) -> list:
    return [
        fk["name"]
        for fk in _inspector().get_foreign_keys(table)
        if fk.get("name") and fk.get("constrained_columns") == [column]
    ]


def upgrade() -> None:
    if not _has_table(TABLE):
        return

    for column, fk_name, index_name in COLUMNS:
        if not _has_column(TABLE, column):
            op.add_column(TABLE, sa.Column(column, sa.String(36), nullable=True))
        if not _foreign_key_names(TABLE, column):
            op.create_foreign_key(
                fk_name, TABLE, "users", [column], ["id"], ondelete="SET NULL"
            )
        if not _has_index(TABLE, index_name):
            op.create_index(index_name, TABLE, [column])

    op.execute(
        sa.text(
            "UPDATE events SET organizer_id = created_by "
            "WHERE organizer_id IS NULL AND created_by IS NOT NULL"
        )
    )


def downgrade() -> None:
    if not _has_table(TABLE):
        return

    for column, _fk_name, index_name in reversed(COLUMNS):
        if not _has_column(TABLE, column):
            continue
        # The foreign key goes first: MySQL refuses to drop an index a
        # constraint still depends on.
        for name in _foreign_key_names(TABLE, column):
            op.drop_constraint(name, TABLE, type_="foreignkey")
        if _has_index(TABLE, index_name):
            op.drop_index(index_name, table_name=TABLE)
        op.drop_column(TABLE, column)

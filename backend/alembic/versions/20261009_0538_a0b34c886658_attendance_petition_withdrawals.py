"""Keep withdrawn attendance requests, and count the withdrawals.

Revision ID: a0b34c886658
Revises: 5c8be05f2f0f
Create Date: 2026-10-09 05:38:00

A withdrawn request used to be deleted, which left nothing to count, so a
member could withdraw and ask again without limit and re-notify the organizer
each time. Withdrawing now marks the row ``withdrawn`` and asking again reuses
it, carrying ``withdrawal_count``; the service caps it.

- ``status`` gains ``withdrawn``. Existing rows are untouched: none can hold it.
- ``withdrawal_count`` is added, ``NOT NULL DEFAULT 0``. Requests withdrawn
  before this revision were deleted, so nobody starts with a count.

**Downgrade** deletes every ``withdrawn`` row before narrowing the enum (the
previous release deleted them at withdrawal, so that is the state it expects),
then drops the counter. Pending, approved and declined requests survive.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a0b34c886658"
down_revision: Union[str, None] = "5c8be05f2f0f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "event_attendance_petitions"
ENUM_NAME = "attendancepetitionstatus"
OLD_VALUES = ("pending", "approved", "rejected")
NEW_VALUES = OLD_VALUES + ("withdrawn",)


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _set_status_values(values: Sequence[str]) -> None:
    op.alter_column(
        TABLE,
        "status",
        existing_type=sa.Enum(*OLD_VALUES, name=ENUM_NAME),
        type_=sa.Enum(*values, name=ENUM_NAME),
        existing_nullable=False,
        existing_server_default="pending",
    )


def upgrade() -> None:
    # Guarded for an installation that built the table with create_all from
    # models that already declare both changes.
    if not _has_table(TABLE):
        return
    _set_status_values(NEW_VALUES)
    if not _has_column(TABLE, "withdrawal_count"):
        op.add_column(
            TABLE,
            sa.Column(
                "withdrawal_count",
                sa.Integer(),
                nullable=False,
                server_default="0",
            ),
        )


def downgrade() -> None:
    if not _has_table(TABLE):
        return
    op.execute(f"DELETE FROM {TABLE} WHERE status = 'withdrawn'")
    _set_status_values(OLD_VALUES)
    if _has_column(TABLE, "withdrawal_count"):
        op.drop_column(TABLE, "withdrawal_count")

"""When a member became their type, and a per-member voting-wait override

Voting waiting periods are set per member type ("administrative members may
vote a year after becoming administrative") and count from when the member
became that type. Five columns on ``users``:

- ``member_class_since`` / ``member_status_since`` — when the member's class /
  status became what it is now. From this release ``_reconcile_membership``
  stamps them on every write path.
- ``voting_wait_from`` — a secretary's corrected start date for the wait.
- ``voting_wait_waived`` — a secretary's waiver of the wait (NOT NULL, server
  default false, so every existing member reads as not waived).
- ``voting_wait_override_reason`` — why either override was set.

**The backfill is a best guess and cannot be reversed.** Nothing before this
release recorded when a member's class or status changed, so existing rows get:

- ``member_status_since`` = ``membership_type_changed_at`` (the last tier
  change, written by the tier endpoint and auto-advance) when there is one,
  else the hire date;
- ``member_class_since`` = the hire date.

A member with neither date is left NULL, which the wait reads as "start of the
current stint, else no wait" — a missing record is not evidence of a recent
change. Where the guess is wrong (a member made regular from their profile, for
instance, whose change was never timestamped), a secretary sets
``voting_wait_from`` on the member's profile. The downgrade drops all five
columns; the guessed dates are not reconstructed on a later upgrade beyond
running this backfill again.

Revision ID: c7e2a91f4d36
Revises: b3d58e0c71a4
Create Date: 2026-10-29 17:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c7e2a91f4d36"
down_revision: Union[str, None] = "b3d58e0c71a4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "users"


def _new_columns() -> list:
    """Fresh Column objects: one may be attached to a table only once."""
    return [
        sa.Column("member_class_since", sa.DateTime(timezone=True), nullable=True),
        sa.Column("member_status_since", sa.DateTime(timezone=True), nullable=True),
        sa.Column("voting_wait_from", sa.Date(), nullable=True),
        sa.Column(
            "voting_wait_waived",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("voting_wait_override_reason", sa.String(500), nullable=True),
    ]


def _columns() -> set:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(_TABLE)}


def upgrade() -> None:
    existing = _columns()
    # No table: create_all builds it later from the model, columns included.
    if not existing:
        return
    added_since = False
    for column in _new_columns():
        if column.name not in existing:
            op.add_column(_TABLE, column)
            added_since = added_since or column.name.endswith("_since")
    # Backfill only when the stamps were just created: a re-run must not
    # overwrite dates the application has stamped since.
    if added_since:
        op.execute(
            sa.text(
                "UPDATE users SET "
                "member_status_since = COALESCE(membership_type_changed_at, hire_date), "
                "member_class_since = hire_date "
                "WHERE member_status_since IS NULL AND member_class_since IS NULL"
            )
        )


def downgrade() -> None:
    existing = _columns()
    for column in reversed(_new_columns()):
        if column.name in existing:
            op.drop_column(_TABLE, column.name)

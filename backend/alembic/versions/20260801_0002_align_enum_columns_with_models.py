"""Align ENUM columns with their model enums

Two ENUM columns gained values in the models after their creation migrations
were written, and no migration ever widened the database ENUMs. Deployments
that materialized tables via create_all() already have the full value sets;
chain-built databases reject the newer values (error 1265, data truncated):

- event_rsvps.status: RSVPStatus gained WAITLISTED (max-attendee waitlist)
- inventory_notification_queue.action_type: InventoryActionType gained
  RETIRED (write-off / retirement notifications)

Appending values to a MySQL ENUM is an in-place metadata change.

Revision ID: 20260801_0002
Revises: 20260801_0001
Create Date: 2026-08-01 00:02:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "20260801_0002"
down_revision = "20260801_0001"
branch_labels = None
depends_on = None

_RSVP_FULL = sa.Enum("going", "not_going", "maybe", "waitlisted", name="rsvpstatus")
_RSVP_OLD = sa.Enum("going", "not_going", "maybe", name="rsvpstatus")

_ACTION_FULL = sa.Enum(
    "assigned",
    "unassigned",
    "issued",
    "returned",
    "checked_out",
    "checked_in",
    "retired",
    name="inventoryactiontype",
)
_ACTION_OLD = sa.Enum(
    "assigned",
    "unassigned",
    "issued",
    "returned",
    "checked_out",
    "checked_in",
    name="inventoryactiontype",
)


def upgrade() -> None:
    op.alter_column(
        "event_rsvps",
        "status",
        type_=_RSVP_FULL,
        existing_type=_RSVP_OLD,
        existing_nullable=False,
        existing_server_default="going",
    )
    op.alter_column(
        "inventory_notification_queue",
        "action_type",
        type_=_ACTION_FULL,
        existing_type=_ACTION_OLD,
        existing_nullable=False,
    )


def downgrade() -> None:
    # Fold the newer values into safe legacy ones before narrowing the ENUMs.
    op.execute("UPDATE event_rsvps SET status = 'maybe' WHERE status = 'waitlisted'")
    op.alter_column(
        "event_rsvps",
        "status",
        type_=_RSVP_OLD,
        existing_type=_RSVP_FULL,
        existing_nullable=False,
        existing_server_default="going",
    )
    op.execute("DELETE FROM inventory_notification_queue WHERE action_type = 'retired'")
    op.alter_column(
        "inventory_notification_queue",
        "action_type",
        type_=_ACTION_OLD,
        existing_type=_ACTION_FULL,
        existing_nullable=False,
    )
